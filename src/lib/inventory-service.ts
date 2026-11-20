"use client";

import { supabase } from "@/lib/supabase";
import { db, LocalOrder } from "@/lib/db";
import { OrderItem } from "@/types/database";
import { v4 as uuidv4 } from "uuid";
import { posBus } from "@/lib/broadcast-bus";

/**
 * Offline-First Real-World Inventory Engine:
 * 1. Caches inventory and recipes locally in Dexie for instant 0ms offline calculations.
 * 2. Deducts local Dexie stock immediately even when internet is completely disconnected.
 * 3. Logs pending deductions in Dexie ledger to sync seamlessly to Supabase when reconnected.
 * 4. Restocks / increments ingredients back into raw_inventory when an order is cancelled / voided.
 */

interface DeductionMap {
  [inventoryItemId: string]: number;
}

/**
 * ARCHITECTURE MANDATE (Single Writer):
 * Local Dexie is the ONLY authoritative source of truth.
 * Supabase does not touch stock; downstream pulls that overwrite local data are disabled.
 */
export async function syncInventoryDefinitionsFromSupabase() {
  return;
}

// Memory cache for expensive lookup tables (refreshed every 60s)
const lookupCache = {
  recipes: null as any[] | null,
  dealComponents: null as any[] | null,
  modifiers: null as any[] | null,
  rawInventory: null as any[] | null,
  lastFetch: 0
};

export async function calculateItemsInventoryRequirements(items: OrderItem[]): Promise<DeductionMap> {
  const deductions: DeductionMap = {};

  if (!items || items.length === 0) return deductions;

  try {
    const now = Date.now();
    // Cache for 60 seconds to prevent hammering Dexie on frequent cart operations
    if (!lookupCache.recipes || now - lookupCache.lastFetch > 60000) {
      lookupCache.recipes = await db.recipes.toArray();
      lookupCache.dealComponents = await db.deal_components.toArray();
      lookupCache.modifiers = await db.modifiers.toArray();
      lookupCache.rawInventory = await db.raw_inventory.toArray();
      lookupCache.lastFetch = now;
    }

    let recipes = lookupCache.recipes!;
    let dealComponents = lookupCache.dealComponents!;
    let modifiers = lookupCache.modifiers!;


    const addDeduction = (invId: string, qty: number) => {
      if (!invId || qty <= 0) return;
      deductions[invId] = (deductions[invId] || 0) + qty;
    };

    items.forEach(item => {
      const itemQty = Number(item.quantity || 1);

      // A. Standard Menu Item Recipes
      const itemRecipes = (recipes || []).filter(r => r.menu_item_id === item.menu_item_id);
      if (itemRecipes.length > 0) {
        itemRecipes.forEach(r => {
          addDeduction(r.inventory_item_id, Number(r.quantity_deducted) * itemQty);
        });
      } else {
        // Direct retail item (e.g. drinks, water, juice, canned items)
        const rawItems = lookupCache.rawInventory || [];
        const directMatch = rawItems.find(inv => 
          inv.id === item.menu_item_id || 
          (inv.name && item.item_name && inv.name.trim().toLowerCase() === item.item_name.trim().toLowerCase())
        );
        if (directMatch) {
          addDeduction(directMatch.id, itemQty);
        }
      }

      // B. Deals Components Recipes
      let swaps: any[] = [];
      if (Array.isArray(item.deal_swaps_json)) {
        swaps = item.deal_swaps_json;
      } else if (typeof item.deal_swaps_json === 'string') {
        try { swaps = JSON.parse(item.deal_swaps_json); } catch { swaps = []; }
      }
      const hasCustomizedDealItems = swaps.some((s: any) => s && s.menu_item_id);

      if (hasCustomizedDealItems) {
        // Deduct inventory for each customized constituent item in the deal
        swaps.forEach((comp: any) => {
          if (!comp || !comp.menu_item_id) return;
          const compQty = Number(comp.quantity || 1) * itemQty;

          // 1. Deduct recipe ingredients for the child menu item
          const childRecipes = (recipes || []).filter(r => r.menu_item_id === comp.menu_item_id);
          childRecipes.forEach(r => {
            addDeduction(r.inventory_item_id, Number(r.quantity_deducted) * compQty);
          });

          // 2. Deduct inventory for any modifiers attached to this constituent item
          if (comp.modifiers && Array.isArray(comp.modifiers)) {
            comp.modifiers.forEach((mod: any) => {
              const modDef = (modifiers || []).find(m => m.id === mod.modifier_id || m.name.toLowerCase() === mod.name.toLowerCase());
              if (modDef && modDef.inventory_item_id && modDef.quantity_deducted) {
                addDeduction(modDef.inventory_item_id, Number(modDef.quantity_deducted) * (Number(mod.qty) || 1) * compQty);
              }
            });
          }
        });
      } else {
        // Fallback for deals without customized swaps: use deal_components from DB
        const deals = (dealComponents || []).filter(dc => dc.deal_id === item.menu_item_id && dc.menu_item_id);
        deals.forEach(dc => {
          const childRecipes = (recipes || []).filter(r => r.menu_item_id === dc.menu_item_id);
          if (childRecipes.length > 0) {
            childRecipes.forEach(r => {
              addDeduction(r.inventory_item_id, Number(r.quantity_deducted) * Number(dc.quantity) * itemQty);
            });
          } else {
            // Direct retail item in deal (e.g. Cola Next inside DOSTI deal)
            const rawItems = lookupCache.rawInventory || [];
            const directMatch = rawItems.find(inv => inv.id === dc.menu_item_id);
            if (directMatch) {
              addDeduction(directMatch.id, Number(dc.quantity || 1) * itemQty);
            }
          }
        });
      }

      // C. Modifiers / Add-ons Deductions (Top-Level)
      if (item.modifiers_json && item.modifiers_json.length > 0) {
        item.modifiers_json.forEach((mod: any) => {
          const modDef = (modifiers || []).find(m => m.id === mod.modifier_id || m.name.toLowerCase() === mod.name.toLowerCase());
          if (modDef && modDef.inventory_item_id && modDef.quantity_deducted) {
            addDeduction(modDef.inventory_item_id, Number(modDef.quantity_deducted) * (Number(mod.qty) || 1) * itemQty);
          }
        });
      }
    });
  } catch (err) {
    console.error("Error calculating inventory requirements:", err);
  }

  return deductions;
}

export interface CostLookupData {
  recipes: any[];
  dealComponents: any[];
  modifiers: any[];
  rawInventoryMap: Map<string, any>;
  menuItemsMap: Map<string, any>;
}

export async function loadCostLookupData(): Promise<CostLookupData> {
  const [recipes, dealComponents, modifiers, rawInventory, menuItems] = await Promise.all([
    db.recipes.toArray(),
    db.deal_components.toArray(),
    db.modifiers.toArray(),
    db.raw_inventory.toArray(),
    db.menu_items.toArray()
  ]);

  const rawInventoryMap = new Map<string, any>(rawInventory.map(r => [r.id, r]));
  const menuItemsMap = new Map<string, any>(menuItems.map(m => [m.id, m]));

  return {
    recipes,
    dealComponents,
    modifiers,
    rawInventoryMap,
    menuItemsMap
  };
}

export function computeItemCogsFromLookup(item: OrderItem, lookup: CostLookupData): number {
  if (item.cogs_total !== undefined && item.cogs_total !== null && item.cogs_total > 0) {
    return Number(item.cogs_total);
  }

  const itemQty = Number(item.quantity || 1);
  let totalCost = 0;

  // A. Standard Menu Item Recipes
  const itemRecipes = (lookup.recipes || []).filter(r => r.menu_item_id === item.menu_item_id);
  if (itemRecipes.length > 0) {
    itemRecipes.forEach(r => {
      const raw = lookup.rawInventoryMap.get(r.inventory_item_id);
      const unitCost = Number(raw?.cost_per_unit || 0);
      totalCost += Number(r.quantity_deducted || 0) * unitCost * itemQty;
    });
  } else {
    // Direct retail item match by ID or Name
    let directMatch = lookup.rawInventoryMap.get(item.menu_item_id);
    if (!directMatch && item.item_name) {
      const lower = item.item_name.trim().toLowerCase();
      lookup.rawInventoryMap.forEach((raw) => {
        if (!directMatch && raw.name && raw.name.trim().toLowerCase() === lower) {
          directMatch = raw;
        }
      });
    }
    if (directMatch) {
      totalCost += Number(directMatch.cost_per_unit || 0) * itemQty;
    }
  }

  // Include direct cooking overhead cost if configured on this item
  const topMenuItem = lookup.menuItemsMap.get(item.menu_item_id);
  if (topMenuItem && topMenuItem.overhead_cost) {
    totalCost += Number(topMenuItem.overhead_cost) * itemQty;
  }

  // B. Deals components & customized swaps
  let swaps: any[] = [];
  if (Array.isArray(item.deal_swaps_json)) swaps = item.deal_swaps_json;
  else if (typeof item.deal_swaps_json === 'string') {
    try { swaps = JSON.parse(item.deal_swaps_json); } catch {}
  }

  const hasSwaps = swaps.some((s: any) => s && s.menu_item_id);
  if (hasSwaps) {
    swaps.forEach((comp: any) => {
      if (!comp || !comp.menu_item_id) return;
      const compQty = Number(comp.quantity || 1) * itemQty;
      const childRecipes = (lookup.recipes || []).filter(r => r.menu_item_id === comp.menu_item_id);
      childRecipes.forEach(r => {
        const raw = lookup.rawInventoryMap.get(r.inventory_item_id);
        totalCost += Number(r.quantity_deducted || 0) * Number(raw?.cost_per_unit || 0) * compQty;
      });
      const childMenu = lookup.menuItemsMap.get(comp.menu_item_id);
      if (childMenu && childMenu.overhead_cost) {
        totalCost += Number(childMenu.overhead_cost) * compQty;
      }
      if (comp.modifiers && Array.isArray(comp.modifiers)) {
        comp.modifiers.forEach((mod: any) => {
          const modDef = (lookup.modifiers || []).find(m => m.id === mod.modifier_id || (m.name && m.name.toLowerCase() === mod.name?.toLowerCase()));
          if (modDef && modDef.inventory_item_id) {
            const raw = lookup.rawInventoryMap.get(modDef.inventory_item_id);
            totalCost += Number(modDef.quantity_deducted || 0) * (Number(mod.qty) || 1) * compQty * Number(raw?.cost_per_unit || 0);
          }
        });
      }
    });
  } else {
    const deals = (lookup.dealComponents || []).filter(dc => dc.deal_id === item.menu_item_id && dc.menu_item_id);
    deals.forEach(dc => {
      const childRecipes = (lookup.recipes || []).filter(r => r.menu_item_id === dc.menu_item_id);
      if (childRecipes.length > 0) {
        childRecipes.forEach(r => {
          const raw = lookup.rawInventoryMap.get(r.inventory_item_id);
          totalCost += Number(r.quantity_deducted || 0) * Number(dc.quantity || 1) * itemQty * Number(raw?.cost_per_unit || 0);
        });
      } else {
        const raw = lookup.rawInventoryMap.get(dc.menu_item_id);
        if (raw) {
          totalCost += Number(dc.quantity || 1) * itemQty * Number(raw.cost_per_unit || 0);
        }
      }
      const childMenu = lookup.menuItemsMap.get(dc.menu_item_id);
      if (childMenu && childMenu.overhead_cost) {
        totalCost += Number(childMenu.overhead_cost) * Number(dc.quantity || 1) * itemQty;
      }
    });
  }

  // C. Modifiers / Add-ons on top-level item
  if (item.modifiers_json && item.modifiers_json.length > 0) {
    item.modifiers_json.forEach((mod: any) => {
      const modDef = (lookup.modifiers || []).find(m => m.id === mod.modifier_id || (m.name && m.name.toLowerCase() === mod.name?.toLowerCase()));
      if (modDef && modDef.inventory_item_id) {
        const raw = lookup.rawInventoryMap.get(modDef.inventory_item_id);
        totalCost += Number(modDef.quantity_deducted || 0) * (Number(mod.qty) || 1) * itemQty * Number(raw?.cost_per_unit || 0);
      }
    });
  }

  // Fallback to menu_items cost_price if totalCost is still 0
  if (totalCost === 0) {
    const menuItem = lookup.menuItemsMap.get(item.menu_item_id);
    if (menuItem && menuItem.cost_price) {
      totalCost = Number(menuItem.cost_price || 0) * itemQty;
    }
  }

  return Number(totalCost.toFixed(2));
}

/**
 * Automatically recalculates and syncs menu items' COGS and profit margins
 * when an ingredient is restocked with a blended unit price or edited.
 */
export async function recalculateAndSyncMenuItemCosts(changedIngredientId?: string): Promise<number> {
  try {
    lookupCache.lastFetch = 0;

    const [allRecipes, allRaw, allMenuItems] = await Promise.all([
      db.recipes.toArray(),
      db.raw_inventory.toArray(),
      db.menu_items.toArray()
    ]);

    const rawMap = new Map<string, number>(allRaw.map(r => [r.id, Number(r.cost_per_unit || 0)]));
    
    let menuItemsToUpdate = allMenuItems;
    if (changedIngredientId) {
      const linkedMenuIds = new Set(
        allRecipes
          .filter(r => r.inventory_item_id === changedIngredientId)
          .map(r => r.menu_item_id)
      );
      menuItemsToUpdate = allMenuItems.filter(m => linkedMenuIds.has(m.id));
    }

    let updatedCount = 0;
    for (const item of menuItemsToUpdate) {
      const itemRecipes = allRecipes.filter(r => r.menu_item_id === item.id);
      if (itemRecipes.length > 0) {
        let recipeCogs = 0;
        for (const r of itemRecipes) {
          const unitCost = rawMap.get(r.inventory_item_id) || 0;
          recipeCogs += Number(r.quantity_deducted || 1) * unitCost;
        }
        const totalCogs = Number((recipeCogs + Number(item.overhead_cost || 0)).toFixed(2));

        if (Number(item.cost_price || 0) !== totalCogs) {
          await db.menu_items.update(item.id, {
            cost_price: totalCogs,
            sync_status: 'PENDING'
          });
          updatedCount++;
        }
      }
    }

    posBus.publish('MENU_UPDATED', { payload: { reason: 'RECIPE_COGS_RECALCULATED', updatedCount } });
    return updatedCount;
  } catch (err) {
    console.warn("[InventoryService] Failed to recalculate menu item costs:", err);
    return 0;
  }
}

export async function populateOrderItemsCogs(items: OrderItem[]): Promise<OrderItem[]> {
  if (!items || items.length === 0) return items;
  const lookup = await loadCostLookupData();
  return items.map(item => ({
    ...item,
    cogs_total: computeItemCogsFromLookup(item, lookup)
  }));
}

export async function backfillOrdersCogs(): Promise<number> {
  try {
    const orders = await db.orders.toArray();
    const ordersNeedingBackfill = orders.filter(o => 
      Array.isArray(o.items) && o.items.some(it => it.cogs_total === undefined || it.cogs_total === null || it.cogs_total === 0)
    );
    if (ordersNeedingBackfill.length === 0) return 0;

    const lookup = await loadCostLookupData();
    let updatedCount = 0;

    for (const order of ordersNeedingBackfill) {
      let changed = false;
      const updatedItems = order.items.map(it => {
        if (it.cogs_total === undefined || it.cogs_total === null || it.cogs_total === 0) {
          const computed = computeItemCogsFromLookup(it, lookup);
          if (computed > 0) {
            changed = true;
            return {
              ...it,
              cogs_total: computed
            };
          }
        }
        return it;
      });

      if (changed) {
        await db.orders.update(order.id, { items: updatedItems });
        updatedCount++;
      }
    }
    return updatedCount;
  } catch (e) {
    console.warn("Backfill orders COGS note:", e);
    return 0;
  }
}

/**
 * Calculates the exact Cost of Goods Sold (COGS) for a single order item,
 * including standard recipes, customized deal components, and modifiers.
 */
export async function calculateItemCogs(item: OrderItem): Promise<number> {
  try {
    const lookup = await loadCostLookupData();
    return computeItemCogsFromLookup(item, lookup);
  } catch (err) {
    console.warn("Failed to calculate item COGS:", err);
    return 0;
  }
}

/**
 * Deduct inventory for items sent to kitchen (Offline-First)
 */
export async function deductOrderInventory(items: OrderItem[], orderId?: string): Promise<boolean> {
  const deductions = await calculateItemsInventoryRequirements(items);
  const entries = Object.entries(deductions);
  if (entries.length === 0) return true;

  try {
    for (const [invId, qtyNeeded] of entries) {
      // 1. Always deduct from local Dexie DB immediately (guarantees offline support & instant 0ms stock updates)
      const localInv = await db.raw_inventory.get(invId);
      if (localInv) {
        const localStock = Number(localInv.current_stock) - qtyNeeded;
        await db.raw_inventory.update(invId, { current_stock: localStock, sync_status: 'PENDING' });
        posBus.publish('STOCK_UPDATED', { itemId: invId, newStock: localStock });
      }

      // 2. Log deduction in Dexie inventory ledger with 'PENDING' for background worker (Zero UI blocking!)
      const logId = uuidv4();
      await db.inventory_logs.put({
        id: logId,
        order_id: orderId || undefined,
        inventory_item_id: invId,
        change_qty: -qtyNeeded,
        change_type: 'USAGE',
        reason: 'ORDER_PREP',
        created_at: new Date().toISOString(),
        sync_status: 'PENDING'
      });
    }
    return true;
  } catch (err) {
    console.error("Failed to deduct local inventory:", err);
    return false;
  }
}

/**
 * Restock inventory when an order is cancelled (Offline-First, Zero UI Blocking)
 */
export async function restockOrderInventory(items: OrderItem[], orderId?: string): Promise<boolean> {
  const deductions = await calculateItemsInventoryRequirements(items);
  const entries = Object.entries(deductions);
  if (entries.length === 0) return true;

  try {
    for (const [invId, qtyToRestore] of entries) {
      // 1. Always increment in local Dexie DB immediately & mark PENDING for upstream sync
      const localInv = await db.raw_inventory.get(invId);
      let localStock = qtyToRestore;
      if (localInv) {
        localStock = Number(localInv.current_stock || 0) + qtyToRestore;
        await db.raw_inventory.update(invId, { current_stock: localStock, sync_status: 'PENDING' });
        posBus.publish('STOCK_UPDATED', { itemId: invId, newStock: localStock });
      } else {
        console.warn(`[restockOrderInventory] Inventory item ${invId} not found in raw_inventory, skipping creation of phantom item.`);
        continue;
      }

      // 2. Log restock in Dexie inventory ledger for background worker
      const logId = uuidv4();
      await db.inventory_logs.put({
        id: logId,
        order_id: orderId || undefined,
        inventory_item_id: invId,
        change_qty: qtyToRestore,
        reason: 'ORDER_RESTOCK',
        created_at: new Date().toISOString(),
        sync_status: 'PENDING'
      });
    }
    return true;
  } catch (err) {
    console.error("Failed to restock local inventory:", err);
    return false;
  }
}

/**
 * Execute Checkout in ONE single atomic Dexie transaction:
 * - Atomically calculates next token number
 * - Writes order record
 * - Deducts raw inventory items
 * - Writes inventory usage logs
 * All or nothing. Zero network await.
 */
export async function executeCheckoutTransaction(
  orderPayload: Omit<LocalOrder, 'token_number'> & { token_number?: number }
): Promise<LocalOrder> {
  let createdOrder: LocalOrder | null = null;

  await db.transaction('rw', [
    db.orders, 
    db.raw_inventory, 
    db.inventory_logs, 
    db.recipes, 
    db.deal_components, 
    db.modifiers,
    db.menu_items
  ], async () => {
    // 1. Atomically resolve next token number if not already assigned
    let tokenNumber = orderPayload.token_number;
    if (!tokenNumber) {
      const today = new Date().toISOString().split('T')[0];
      const todaysOrders = await db.orders
        .where('created_at')
        .startsWith(today)
        .toArray();
      const maxToken = todaysOrders.length > 0 ? Math.max(...todaysOrders.map(o => o.token_number || 0)) : 0;
      tokenNumber = maxToken + 1;
    }

    // 2. Compute ingredient requirements & exact item COGS
    const recipes = await db.recipes.toArray();
    const dealComponents = await db.deal_components.toArray();
    const modifiers = await db.modifiers.toArray();
    const rawInventoryList = await db.raw_inventory.toArray();
    const menuItemsList = await db.menu_items.toArray();

    const lookup: CostLookupData = {
      recipes,
      dealComponents,
      modifiers,
      rawInventoryMap: new Map(rawInventoryList.map(r => [r.id, r])),
      menuItemsMap: new Map(menuItemsList.map(m => [m.id, m]))
    };

    const rawItems = (orderPayload.items || []) as OrderItem[];
    const items: OrderItem[] = rawItems.map(item => ({
      ...item,
      cogs_total: computeItemCogsFromLookup(item, lookup)
    }));

    const orderToSave: LocalOrder = {
      ...orderPayload,
      token_number: tokenNumber,
      items,
      sync_status: 'PENDING'
    };

    const deductions: Record<string, number> = {};
    const addDeduction = (invId: string, qty: number) => {
      if (!invId || qty <= 0) return;
      deductions[invId] = (deductions[invId] || 0) + qty;
    };

    for (const item of items) {
      const itemQty = Number(item.quantity || 1);

      // A. Standard Menu Item Recipes
      const itemRecipes = recipes.filter(r => r.menu_item_id === item.menu_item_id);
      if (itemRecipes.length > 0) {
        itemRecipes.forEach(r => {
          addDeduction(r.inventory_item_id, Number(r.quantity_deducted) * itemQty);
        });
      } else {
        // Direct retail item (e.g. drinks, water bottles, beverages):
        const directMatch = rawInventoryList.find(inv => 
          inv.id === item.menu_item_id || 
          (inv.name && item.item_name && inv.name.trim().toLowerCase() === item.item_name.trim().toLowerCase())
        );
        if (directMatch) {
          addDeduction(directMatch.id, itemQty);
        }
      }

      // B. Deals components & customized swaps
      let swaps: any[] = [];
      if (Array.isArray(item.deal_swaps_json)) swaps = item.deal_swaps_json;
      else if (typeof item.deal_swaps_json === 'string') {
        try { swaps = JSON.parse(item.deal_swaps_json); } catch {}
      }
      const hasSwaps = swaps.some((s: any) => s && s.menu_item_id);
      if (hasSwaps) {
        swaps.forEach((comp: any) => {
          if (!comp || !comp.menu_item_id) return;
          const compQty = Number(comp.quantity || 1) * itemQty;
          const childRecipes = recipes.filter(r => r.menu_item_id === comp.menu_item_id);
          if (childRecipes.length > 0) {
            childRecipes.forEach(r => {
              addDeduction(r.inventory_item_id, Number(r.quantity_deducted) * compQty);
            });
          } else {
            const directMatch = rawInventoryList.find(inv => 
              inv.id === comp.menu_item_id || 
              (inv.name && comp.item_name && inv.name.trim().toLowerCase() === comp.item_name.trim().toLowerCase())
            );
            if (directMatch) addDeduction(directMatch.id, compQty);
          }

          if (comp.modifiers && Array.isArray(comp.modifiers)) {
            comp.modifiers.forEach((mod: any) => {
              const modDef = modifiers.find(m => m.id === mod.modifier_id || m.name?.toLowerCase() === mod.name?.toLowerCase());
              if (modDef && modDef.inventory_item_id && modDef.quantity_deducted) {
                addDeduction(modDef.inventory_item_id, Number(modDef.quantity_deducted) * (Number(mod.qty) || 1) * compQty);
              }
            });
          }
        });
      } else {
        // Standard deal components fallback (e.g. 1x Zinger, 1x Cola Next inside DOSTI deal)
        const deals = dealComponents.filter(dc => dc.deal_id === item.menu_item_id && dc.menu_item_id);
        deals.forEach(dc => {
          const compQty = Number(dc.quantity || 1) * itemQty;
          const childRecipes = recipes.filter(r => r.menu_item_id === dc.menu_item_id);
          if (childRecipes.length > 0) {
            childRecipes.forEach(r => {
              addDeduction(r.inventory_item_id, Number(r.quantity_deducted) * compQty);
            });
          } else {
            const directMatch = rawInventoryList.find(inv => inv.id === dc.menu_item_id);
            if (directMatch) addDeduction(directMatch.id, compQty);
          }
        });
      }

      // C. Modifiers
      if (item.modifiers_json && item.modifiers_json.length > 0) {
        item.modifiers_json.forEach((mod: any) => {
          const modDef = modifiers.find(m => m.id === mod.modifier_id || m.name?.toLowerCase() === mod.name?.toLowerCase());
          if (modDef && modDef.inventory_item_id && modDef.quantity_deducted) {
            addDeduction(modDef.inventory_item_id, Number(modDef.quantity_deducted) * (Number(mod.qty) || 1) * itemQty);
          }
        });
      }
    }

    // 3. Deduct stock & log audit
    for (const [invId, qtyNeeded] of Object.entries(deductions)) {
      const localInv = await db.raw_inventory.get(invId);
      if (localInv) {
        const localStock = Number(localInv.current_stock || 0) - qtyNeeded;
        await db.raw_inventory.update(invId, { 
          current_stock: localStock, 
          sync_status: 'PENDING' 
        });
      }

      const logId = uuidv4();
      await db.inventory_logs.put({
        id: logId,
        order_id: orderToSave.id,
        inventory_item_id: invId,
        change_qty: -qtyNeeded,
        change_type: 'USAGE',
        reason: `Order #${tokenNumber} (${orderToSave.order_type})`,
        created_at: new Date().toISOString(),
        sync_status: 'PENDING'
      });
    }

    // 4. Put order
    await db.orders.put(orderToSave);
    createdOrder = orderToSave;
  });

  posBus.publish('STOCK_UPDATED', { orderId: createdOrder!.id, tokenNumber: createdOrder!.token_number });
  posBus.publish('ORDER_CREATED', { orderId: createdOrder!.id, tokenNumber: createdOrder!.token_number, orderType: createdOrder!.order_type });

  return createdOrder!;
}

/**
 * Clean up phantom corrupted inventory items created by legacy void bug.
 */
export async function cleanupCorruptedInventoryItems(): Promise<number> {
  try {
    const all = await db.raw_inventory.toArray();
    let cleaned = 0;
    for (const item of all) {
      const isOverhead = 
        Boolean(item.is_overhead) ||
        (item.name && item.name.toLowerCase().startsWith('overhead')) ||
        (item.name && item.name.toLowerCase().startsWith('cooking overhead'));

      const isCorrupt = 
        item.name === 'Restocked Item' ||
        ((item.name && item.name.startsWith('Item ') && item.name.length <= 16) &&
        (item.cost_per_unit === undefined || item.cost_per_unit === null || isNaN(Number(item.cost_per_unit)) || Number(item.cost_per_unit) <= 0));

      if (isOverhead || isCorrupt) {
        await db.raw_inventory.delete(item.id);
        await db.recipes.where('inventory_item_id').equals(item.id).delete();
        cleaned++;
      }
    }
    return cleaned;
  } catch (err) {
    console.warn("Cleanup corrupted inventory items note:", err);
    return 0;
  }
}

/**
 * Cancel Order, restore ingredients, and record cancellation in ONE atomic Dexie transaction.
 * Features:
 * - Double-restock guard: checks if order has already been restocked before restoring
 * - Restores EXACT ingredients that were deducted during checkout via usage logs
 * - Never creates phantom inventory items with NaN cost
 * - Sets status CANCELLED and sync_status PENDING
 * - Zero network blocking
 */
export async function cancelAndRestockOrder(
  orderId: string, 
  reason: string = "Customer requested cancellation before prep"
): Promise<{ success: boolean; message: string }> {
  try {
    let orderTokenNumber = 0;

    await db.transaction('rw', [
      db.orders, 
      db.raw_inventory, 
      db.inventory_logs, 
      db.recipes,
      db.deal_components,
      db.modifiers
    ], async () => {
      const order = await db.orders.get(orderId);
      if (!order) {
        throw new Error("Order not found in local database.");
      }
      if (order.status === 'CANCELLED') {
        throw new Error("Order is already cancelled.");
      }

      // Foodpanda Payout Clearance Guard:
      // Orders cannot be voided once Foodpanda payout has been cleared and recorded
      const isFpOrder = order.order_type === 'FOODPANDA' || order.payment_method === 'FOODPANDA_RECEIVABLE';
      if (isFpOrder && (order.fp_payout_status === 'RECEIVED' || order.fp_payout_status === 'SETTLED')) {
        throw new Error("Cannot void order: Foodpanda payment has already been cleared and deposited.");
      }

      orderTokenNumber = order.token_number;

      // Double-restock guard: check if inventory_logs has already recorded a RESTOCK for this order
      const existingRestock = await db.inventory_logs
        .where('order_id')
        .equals(orderId)
        .and(l => l.change_type === 'RESTOCK' || Boolean(l.reason && l.reason.includes('voided')))
        .first();

      if (existingRestock) {
        throw new Error("Order has already been restocked.");
      }

      // Revert ingredients:
      // Gather all deduction logs recorded for this order (whether initial or amended add-ons)
      const previousUsageLogs = await db.inventory_logs
        .where('order_id')
        .equals(orderId)
        .and(l => (l.change_type === 'USAGE' || Number(l.change_qty) < 0) && l.change_type !== 'RESTOCK')
        .toArray();

      const deductions: Record<string, number> = {};
      const addRestock = (invId: string, qty: number) => {
        if (!invId || qty <= 0) return;
        deductions[invId] = (deductions[invId] || 0) + qty;
      };

      // 1. Sum up all recorded usage deductions from logs
      if (previousUsageLogs.length > 0) {
        previousUsageLogs.forEach(l => {
          addRestock(l.inventory_item_id, Math.abs(Number(l.change_qty || 0)));
        });
      }

      // 2. Cross-verify against complete order.items requirement:
      // If items were added/amended or logs were missing, ensure full requirement is covered
      const computed = await calculateItemsInventoryRequirements(order.items || []);
      Object.entries(computed).forEach(([id, qty]) => {
        const logged = deductions[id] || 0;
        if (qty > logged) {
          deductions[id] = qty;
        }
      });

      // Restock ingredients in Dexie & write logs
      for (const [invId, qtyToRestore] of Object.entries(deductions)) {
        const localInv = await db.raw_inventory.get(invId);
        if (localInv) {
          const newStock = Number(localInv.current_stock || 0) + qtyToRestore;
          await db.raw_inventory.update(invId, { 
            current_stock: newStock, 
            sync_status: 'PENDING' 
          });

          const logId = uuidv4();
          await db.inventory_logs.put({
            id: logId,
            order_id: orderId,
            inventory_item_id: invId,
            change_qty: qtyToRestore,
            change_type: 'RESTOCK',
            reason: `Order #${orderTokenNumber} voided: ${reason}`,
            created_at: new Date().toISOString(),
            sync_status: 'PENDING'
          });
        } else {
          console.warn(`[cancelAndRestockOrder] Skipping restock for non-existent inventory item: ${invId}`);
        }
      }

      // Mark order CANCELLED and deduct from Foodpanda cycle receivable
      await db.orders.update(orderId, {
        status: 'CANCELLED',
        fp_payout_status: isFpOrder ? 'VOIDED' : order.fp_payout_status,
        sync_status: 'PENDING'
      });
    });

    posBus.publish('STOCK_UPDATED', { orderId });
    posBus.publish('ORDER_CANCELLED', { orderId, tokenNumber: orderTokenNumber });
    return {
      success: true,
      message: `Order #${orderTokenNumber} cancelled & ingredients restocked successfully!`
    };
  } catch (err: any) {
    console.error("Error cancelling order:", err);
    return { success: false, message: err.message || "Failed to cancel order." };
  }
}
