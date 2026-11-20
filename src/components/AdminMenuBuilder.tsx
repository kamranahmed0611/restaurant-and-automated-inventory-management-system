"use client";

import React, { useState, useEffect } from "react";
import { modal } from "@/lib/modalStore";
import { db } from "@/lib/db";
import { posBus } from "@/lib/broadcast-bus";
import { isLaptopWriter } from "@/lib/device-mode";
import { cleanupCorruptedInventoryItems } from "@/lib/inventory-service";
import { trackAndSyncDeletion, syncOfflineOrders } from "@/lib/sync-engine";
import { supabase } from "@/lib/supabase";
import { useLiveQuery } from "dexie-react-hooks";
import { 
  Plus, Minus, X, ChefHat, Save, Trash2, Link as LinkIcon, 
  AlertCircle, Edit2, Search, ArrowLeft, CheckCircle2, DollarSign,
  Layers, Package, Sparkles, Eye, FolderPlus, Flame
} from "lucide-react";

interface AdminMenuBuilderProps {
  isActive?: boolean;
  refreshTrigger?: number;
}

export default function AdminMenuBuilder({ isActive, refreshTrigger }: AdminMenuBuilderProps = {}) {
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [rawInventory, setRawInventory] = useState<any[]>([]);
  const [allRecipes, setAllRecipes] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLaptop, setIsLaptop] = useState(false);

  // Live Reactive Dexie Queries - 100% Instant updates when adding ingredients in other tabs
  const liveRawInventory = useLiveQuery(() => db.raw_inventory.toArray(), []);
  const liveCategories = useLiveQuery(() => db.categories.orderBy('sort_order').toArray(), []);
  const liveMenuItems = useLiveQuery(() => db.menu_items.toArray(), []);
  const liveRecipes = useLiveQuery(() => db.recipes.toArray(), []);
  const liveModifiers = useLiveQuery(() => db.modifiers.toArray(), []);

  useEffect(() => {
    if (liveRawInventory && liveRawInventory.length > 0) {
      setRawInventory(liveRawInventory);
    }
  }, [liveRawInventory]);

  useEffect(() => {
    if (liveCategories && liveCategories.length > 0) {
      setCategories(liveCategories);
    }
  }, [liveCategories]);

  useEffect(() => {
    if (liveMenuItems && liveMenuItems.length > 0) {
      setMenuItems(liveMenuItems);
    }
  }, [liveMenuItems]);

  useEffect(() => {
    if (liveRecipes && liveRecipes.length > 0) {
      setAllRecipes(liveRecipes);
    }
  }, [liveRecipes]);

  useEffect(() => {
    if (liveModifiers && liveModifiers.length > 0) {
      setModifiersList(liveModifiers);
    }
  }, [liveModifiers]);

  // New Category Modal State
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [newCategoryNameInput, setNewCategoryNameInput] = useState('');
  const [categoryModalError, setCategoryModalError] = useState<string | null>(null);
  
  // Mobile Tab view: 'MENU' or 'RECIPE'
  const [mobileTab, setMobileTab] = useState<'MENU' | 'RECIPE'>('MENU');

  // Search & Category Filter
  const [menuSearch, setMenuSearch] = useState('');
  const [selectedCatFilter, setSelectedCatFilter] = useState('ALL');

  // Active Menu Item for Recipe BOM
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [activeRecipe, setActiveRecipe] = useState<any[]>([]);
  const [dealComponents, setDealComponents] = useState<any[]>([]);
  const [dealComponentMode, setDealComponentMode] = useState<'SPECIFIC' | 'CATEGORY'>('SPECIFIC');
  const [selectedDealItem, setSelectedDealItem] = useState('');
  const [selectedDealCategory, setSelectedDealCategory] = useState('');
  const [dealSlotTitle, setDealSlotTitle] = useState('');
  const [dealSpecificCatFilter, setDealSpecificCatFilter] = useState('ALL');
  const [dealItemQty, setDealItemQty] = useState<number>(1);

  const effectiveRawInventory = (liveRawInventory && liveRawInventory.length > 0) ? liveRawInventory : rawInventory;
  const effectiveRecipes = (liveRecipes && liveRecipes.length > 0) ? liveRecipes : allRecipes;
  const effectiveMenuItems = (liveMenuItems && liveMenuItems.length > 0) ? liveMenuItems : menuItems;

  // Reactive recipe price & BOM updater: refreshes active item immediately when stock/blended cost changes
  useEffect(() => {
    if (activeMenuId) {
      const currentRaw = (liveRawInventory && liveRawInventory.length > 0) ? liveRawInventory : rawInventory;
      const currentRec = (liveRecipes && liveRecipes.length > 0) ? liveRecipes : allRecipes;
      const currentMenu = (liveMenuItems && liveMenuItems.length > 0) ? liveMenuItems : menuItems;
      const recs = currentRec.filter(r => r.menu_item_id === activeMenuId);
      const updatedActiveRec = recs.map(r => ({
        ...r,
        raw_inventory: currentRaw.find(raw => raw.id === r.inventory_item_id)
      }));
      setActiveRecipe(updatedActiveRec);

      const item = currentMenu.find(m => m.id === activeMenuId);
      if (item) {
        let calculatedCost = 0;
        if (recs.length > 0) {
          calculatedCost = recs.reduce((sum, r) => {
            const raw = currentRaw.find(rawItem => rawItem.id === r.inventory_item_id);
            return sum + (Number(r.quantity_deducted || 1) * Number(raw?.cost_per_unit || 0));
          }, 0);
        } else {
          const rawMatch = currentRaw.find(rawItem => rawItem.name.trim().toLowerCase() === item.name.trim().toLowerCase());
          if (rawMatch && rawMatch.cost_per_unit) calculatedCost = Number(rawMatch.cost_per_unit);
        }
        setEditItemCostPrice(calculatedCost > 0 ? calculatedCost : (item.cost_price ? Number(item.cost_price) : ''));
      }
    }
  }, [liveRawInventory, liveRecipes, liveMenuItems, activeMenuId]);

  // Add Menu Item Modal
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [newItemType, setNewItemType] = useState<'PREPARED' | 'RETAIL_DRINK'>('PREPARED');
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemPrice, setNewItemPrice] = useState<number | ''>('');
  const [newItemCostPrice, setNewItemCostPrice] = useState<number | ''>('');
  const [newItemStock, setNewItemStock] = useState<number | ''>(24);
  const [newItemMinAlert, setNewItemMinAlert] = useState<number | ''>(5);
  const [newItemAllowsModifiers, setNewItemAllowsModifiers] = useState<boolean>(true);

  // Edit Menu Item Modal
  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [editItemName, setEditItemName] = useState('');
  const [editItemCategory, setEditItemCategory] = useState('');
  const [editItemPrice, setEditItemPrice] = useState<number | ''>('');
  const [editItemCostPrice, setEditItemCostPrice] = useState<number | ''>('');
  const [editItemAllowsModifiers, setEditItemAllowsModifiers] = useState<boolean>(true);

  // Cooking Overhead Inputs (Pure financial attribute on Menu Item, NOT an inventory row)
  const [newItemOverheadCost, setNewItemOverheadCost] = useState<number | ''>('');
  const [editItemOverheadCost, setEditItemOverheadCost] = useState<number | ''>('');

  // Modifiers / Add-ons Manager Modal State
  const [isManagingModifiers, setIsManagingModifiers] = useState(false);
  const [modifiersList, setModifiersList] = useState<any[]>([]);
  const [modName, setModName] = useState('');
  const [modPrice, setModPrice] = useState<number | ''>('');
  const [modInventoryId, setModInventoryId] = useState('');
  const [modDeductQty, setModDeductQty] = useState<number | ''>(1);
  const [editingModifierId, setEditingModifierId] = useState<string | null>(null);

  // Add Ingredient to Recipe
  const [selectedIngredient, setSelectedIngredient] = useState('');
  const [ingredientQty, setIngredientQty] = useState<number | ''>('');

  useEffect(() => {
    setIsLaptop(isLaptopWriter());
    fetchData();

    // Instant local posBus listener for ingredient additions, stock updates, menu changes
    const unsubBus = posBus.subscribe((msg: any) => {
      if ([
        'STOCK_UPDATED',
        'INVENTORY_DEDUCTED',
        'INVENTORY_RESTOCKED',
        'INVENTORY_UPDATED',
        'MENU_UPDATED',
        'ORDER_CREATED',
        'ORDER_COMPLETED',
        'MANUAL_REFRESH'
      ].includes(msg?.type)) {
        fetchData();
      }
    });

    return () => {
      unsubBus();
    };
  }, []);

  // Remote Cloud Realtime WebSockets: updates instantly on owner's phone when menu/recipes change
  useEffect(() => {
    if (isLaptopWriter()) return;

    const channel = supabase
      .channel('realtime_admin_menu')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'recipes' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, () => fetchData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_inventory' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (isActive) {
      fetchData();
      if (activeMenuId) {
        fetchRecipe(activeMenuId);
      }
    }
  }, [isActive]);

  useEffect(() => {
    if (refreshTrigger) {
      fetchData();
      if (activeMenuId) {
        fetchRecipe(activeMenuId);
      }
    }
  }, [refreshTrigger]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Phone / Remote Vercel: read from Supabase mirror (view-only)
      if (!isLaptopWriter()) {
        const [catsRes, menuRes, rawRes, recRes, modsRes] = await Promise.all([
          supabase.from('categories').select('*').order('sort_order'),
          supabase.from('menu_items').select('*').order('name'),
          supabase.from('raw_inventory').select('*').order('name'),
          supabase.from('recipes').select('*'),
          supabase.from('modifiers').select('*')
        ]);
        const cloudCats = catsRes.data || [];
        setCategories(cloudCats);
        if (cloudCats.length > 0) {
          setNewItemCategory(cloudCats[0].id);
        }
        setMenuItems(menuRes.data || []);
        setRawInventory(rawRes.data || []);
        setAllRecipes(recRes.data || []);
        setModifiersList(modsRes.data || []);
        setIsLoading(false);
        return;
      }

      // 1. Auto-cleanup any corrupted/legacy fake overhead items from Dexie so inventory valuation & raw BOM are clean
      await cleanupCorruptedInventoryItems().catch(() => {});

      // 2. Laptop reads ONLY from local Dexie (0ms local-first, single writer)
      const [localCats, localMenu, localRaw, localRec, localMods] = await Promise.all([
        db.categories.orderBy('sort_order').toArray(),
        db.menu_items.toArray(),
        db.raw_inventory.toArray(),
        db.recipes.toArray(),
        db.modifiers.toArray()
      ]);

      let resolvedCats = localCats;
      // If categories is empty, auto-seed default categories so user is never blocked!
      if (resolvedCats.length === 0) {
        const defaultCatNames = ['Burgers', 'Shawarma', 'Platter', 'Wraps', 'Fries', 'Deals', 'Drinks'];
        resolvedCats = defaultCatNames.map((name, idx) => ({
          id: `cat-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
          name,
          sort_order: idx + 1,
          sync_status: 'PENDING'
        }));
        await db.categories.bulkPut(resolvedCats);
      }

      // If modifiers is empty, auto-seed default modifiers linked to raw ingredients
      let resolvedMods = localMods;
      if (resolvedMods.length === 0) {
        const defaultMods = [
          { id: 'm1', name: 'Extra Cheese Slice', price: 70, quantity_deducted: 1 },
          { id: 'm2', name: 'Extra Pita Bread', price: 70, quantity_deducted: 1 },
          { id: 'm3', name: 'Crispy Chicken Addon', price: 190, quantity_deducted: 1 },
          { id: 's1', name: 'White Sauce', price: 70, quantity_deducted: 1 },
          { id: 's2', name: 'Red Chilli', price: 70, quantity_deducted: 1 },
          { id: 's3', name: 'Mayo Dip', price: 70, quantity_deducted: 1 },
          { id: 's4', name: 'Ranch Sauce', price: 70, quantity_deducted: 1 },
          { id: 's5', name: 'BBQ Sauce', price: 70, quantity_deducted: 1 },
        ];
        const seeded = defaultMods.map(m => {
          const rawMatch = localRaw.find(r => r.name.toLowerCase().includes(m.name.toLowerCase().replace('extra ', '').replace(' addon', '').replace(' dip', '')));
          return {
            ...m,
            inventory_item_id: rawMatch?.id,
            quantity_deducted: 1,
            is_active: true
          };
        });
        await db.modifiers.bulkPut(seeded);
        resolvedMods = seeded;
      }

      setCategories(resolvedCats);
      if (resolvedCats.length > 0) {
        setNewItemCategory(resolvedCats[0].id);
      }
      setMenuItems(localMenu);
      setRawInventory(localRaw);
      setAllRecipes(localRec);
      setModifiersList(resolvedMods);
      if (activeMenuId) {
        fetchRecipe(activeMenuId);
      }
    } catch (e) {
      console.warn("Menu builder load warning:", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAddCategoryModal = () => {
    if (!isLaptopWriter()) return;
    setNewCategoryNameInput('');
    setCategoryModalError(null);
    setIsCategoryModalOpen(true);
  };

  const handleConfirmAddCategory = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isLaptopWriter()) return;
    const trimmed = newCategoryNameInput.trim();
    if (!trimmed) {
      setCategoryModalError("Category name cannot be empty.");
      return;
    }
    const existing = categories.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      setNewItemCategory(existing.id);
      setEditItemCategory(existing.id);
      setIsCategoryModalOpen(false);
      modal.toast.info(`Selected existing category "${existing.name}".`);
      return;
    }
    const newCat = {
      id: `cat-${trimmed.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`,
      name: trimmed,
      sort_order: categories.length + 1,
      sync_status: 'PENDING'
    };
    await db.categories.put(newCat);
    setCategories(prev => [...prev, newCat]);
    setNewItemCategory(newCat.id);
    setEditItemCategory(newCat.id);
    posBus.publish('MENU_UPDATED', { categoryId: newCat.id });
    setIsCategoryModalOpen(false);
    modal.toast.success(`Category "${trimmed}" created!`);
  };

  // ==================== MODIFIERS / ADD-ONS HANDLERS ====================
  const handleOpenAddModifierModal = (mod?: any) => {
    if (!isLaptopWriter()) return;
    if (mod) {
      setEditingModifierId(mod.id);
      setModName(mod.name);
      setModPrice(mod.price);
      setModInventoryId(mod.inventory_item_id || '');
      setModDeductQty(mod.quantity_deducted || 1);
    } else {
      setEditingModifierId(null);
      setModName('');
      setModPrice('');
      setModInventoryId('');
      setModDeductQty(1);
    }
    setIsManagingModifiers(true);
  };

  const handleSaveModifier = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!isLaptopWriter()) return;
    if (!modName.trim() || Number(modPrice) < 0) {
      modal.warning("Incomplete Add-on", "Add-on name and customer selling price are required.");
      return;
    }
    const modId = editingModifierId || `mod-${Date.now()}`;
    const modifierRecord = {
      id: modId,
      name: modName.trim(),
      price: Number(modPrice),
      inventory_item_id: modInventoryId || undefined,
      quantity_deducted: Number(modDeductQty) || 1,
      is_active: true
    };
    await db.modifiers.put(modifierRecord);
    setModifiersList(prev => {
      const exists = prev.some(m => m.id === modId);
      return exists ? prev.map(m => m.id === modId ? modifierRecord : m) : [...prev, modifierRecord];
    });
    posBus.publish('MENU_UPDATED', {});
    setModName('');
    setModPrice('');
    setModInventoryId('');
    setModDeductQty(1);
    setEditingModifierId(null);
    modal.toast.success(`Add-on "${modifierRecord.name}" saved!`);
    setTimeout(() => syncOfflineOrders(), 50);
  };

  const handleDeleteModifier = async (id: string) => {
    if (!isLaptopWriter()) return;
    const mod = modifiersList.find(m => m.id === id);
    const ok = await modal.confirm({
      title: `Delete ${mod?.name || 'Add-on'}?`,
      message: "This add-on will be removed from POS cart modifier options.",
      confirmText: "Delete Add-on",
      isDanger: true
    });
    if (!ok) return;
    await trackAndSyncDeletion('modifiers', id);
    await db.modifiers.delete(id);
    setModifiersList(prev => prev.filter(m => m.id !== id));
    posBus.publish('MENU_UPDATED', {});
    modal.toast.success("Add-on deleted.");
    setTimeout(() => syncOfflineOrders(), 50);
  };

  const fetchRecipe = async (menuItemId: string) => {
    setActiveMenuId(menuItemId);
    setIsEditingDetails(false); 

    // Fresh lookup from live query / Dexie
    const currentRaw = (liveRawInventory && liveRawInventory.length > 0) ? liveRawInventory : await db.raw_inventory.toArray().catch(() => rawInventory);
    const currentRec = (liveRecipes && liveRecipes.length > 0) ? liveRecipes : await db.recipes.toArray().catch(() => allRecipes);

    const item = (liveMenuItems && liveMenuItems.length > 0 ? liveMenuItems : menuItems).find(m => m.id === menuItemId) || await db.menu_items.get(menuItemId).catch(() => null);
    if (item) {
      setEditItemName(item.name);
      setEditItemCategory(item.category_id);
      setEditItemPrice(item.price);
      setEditItemOverheadCost(item.overhead_cost !== undefined ? item.overhead_cost : '');
      setEditItemAllowsModifiers(item.allows_modifiers !== false);

      // Resolve current cost price for this item
      const directRec = currentRec.filter(r => r.menu_item_id === menuItemId);
      let calculatedCost = 0;
      if (directRec.length > 0) {
        calculatedCost = directRec.reduce((sum, r) => {
          const raw = currentRaw.find(rawItem => rawItem.id === r.inventory_item_id);
          return sum + (Number(r.quantity_deducted || 1) * Number(raw?.cost_per_unit || 0));
        }, 0);
      } else {
        const rawMatch = currentRaw.find(rawItem => rawItem.name.trim().toLowerCase() === item.name.trim().toLowerCase());
        if (rawMatch && rawMatch.cost_per_unit) calculatedCost = Number(rawMatch.cost_per_unit);
      }
      setEditItemCostPrice(calculatedCost > 0 ? calculatedCost : (item.cost_price ? Number(item.cost_price) : ''));
    }

    // Laptop: local Dexie BOM (0ms offline guarantee)
    const localDirectRec = currentRec
      .filter(r => r.menu_item_id === menuItemId)
      .map(r => ({
        ...r,
        raw_inventory: currentRaw.find(raw => raw.id === r.inventory_item_id)
      }));
    setActiveRecipe(localDirectRec);

    const localDeals = await db.deal_components.where('deal_id').equals(menuItemId).toArray();
    setDealComponents(localDeals);

    // On mobile, switch directly to the recipe tab
    setMobileTab('RECIPE');
  };

  const handleAddMenuItem = async () => {
    if (!isLaptopWriter()) return;
    if (!newItemName.trim() || Number(newItemPrice) <= 0 || !newItemCategory) {
      return modal.warning("Incomplete Item", "Valid name, category, and price are required.");
    }
    const catName = categories.find(c => c.id === newItemCategory)?.name;
    const isDeal = catName?.toLowerCase() === 'deals' || catName?.toLowerCase() === 'combos';
    const itemId = crypto.randomUUID();
    const createdItem = { 
      id: itemId,
      name: newItemName.trim(), 
      category_id: newItemCategory, 
      price: Number(newItemPrice), 
      overhead_cost: newItemOverheadCost !== '' ? Number(newItemOverheadCost) : 0,
      allows_modifiers: newItemAllowsModifiers,
      is_deal: isDeal,
      categories: { name: catName || 'General' }
    };
    
    // 1. Save to local Dexie immediately (0ms, guaranteed offline success)
    await db.menu_items.put({
      id: createdItem.id,
      category_id: createdItem.category_id,
      category_name: catName || 'General',
      name: createdItem.name,
      price: Number(createdItem.price),
      cost_price: newItemCostPrice !== '' ? Number(newItemCostPrice) : undefined,
      overhead_cost: createdItem.overhead_cost,
      allows_modifiers: createdItem.allows_modifiers,
      is_deal: isDeal,
      sync_status: 'PENDING'
    });

    setMenuItems(prev => [...prev, createdItem]);

    // If Retail / Drink with purchase cost price, automatically generate matching raw_inventory & 1-to-1 recipe BOM locally
    if (newItemType === 'RETAIL_DRINK' && newItemCostPrice !== '' && Number(newItemCostPrice) > 0) {
      const cost = Number(newItemCostPrice);
      const stock = Number(newItemStock || 0);
      const minAlert = Number(newItemMinAlert || 5);

      // Case-insensitive deduplication check: reuse existing raw_inventory item if present
      const existingRaw = await db.raw_inventory.toArray();
      const matched = existingRaw.find(r => r.name.trim().toLowerCase() === createdItem.name.trim().toLowerCase());
      const rawId = matched ? matched.id : crypto.randomUUID();

      const rawItem = {
        id: rawId,
        name: matched ? matched.name : createdItem.name,
        base_unit: 'can',
        unit: 'can',
        cost_per_unit: cost,
        current_stock: matched ? (matched.current_stock !== undefined ? matched.current_stock : stock) : stock,
        min_stock_alert: minAlert,
        sync_status: 'PENDING'
      };

      await db.raw_inventory.put(rawItem as any);
      await db.recipes.put({
        id: crypto.randomUUID(),
        menu_item_id: createdItem.id,
        inventory_item_id: rawId,
        quantity_deducted: 1,
        sync_status: 'PENDING'
      });
      if (matched) {
        setRawInventory(prev => prev.map(p => p.id === rawId ? rawItem : p));
      } else {
        setRawInventory(prev => [...prev, rawItem]);
      }
    }

    setIsAddingItem(false);
    setNewItemName(''); 
    setNewItemPrice('');
    setNewItemCostPrice('');
    setNewItemOverheadCost('');
    setNewItemAllowsModifiers(true);
    fetchRecipe(createdItem.id);
    modal.toast.success(`"${createdItem.name}" added to menu catalog.`);
    posBus.publish("MENU_UPDATED", {});
  };

  const handleUpdateMenuDetails = async () => {
    if (!isLaptopWriter() || !activeMenuId) return;
    const catName = categories.find(c => c.id === editItemCategory)?.name;
    const isDeal = catName?.toLowerCase() === 'deals' || catName?.toLowerCase() === 'combos';
    const overheadNum = editItemOverheadCost !== '' ? Number(editItemOverheadCost) : 0;
    const payload = { 
      name: editItemName.trim(), 
      category_id: editItemCategory, 
      price: Number(editItemPrice), 
      overhead_cost: overheadNum,
      allows_modifiers: editItemAllowsModifiers,
      is_deal: isDeal 
    };

    // 1. Update in local Dexie database immediately (0ms, 100% offline)
    await db.menu_items.update(activeMenuId, {
      name: payload.name,
      category_id: payload.category_id,
      category_name: catName || 'General',
      price: payload.price,
      overhead_cost: payload.overhead_cost,
      allows_modifiers: payload.allows_modifiers,
      is_deal: payload.is_deal,
      sync_status: 'PENDING'
    });

    setMenuItems(prev => prev.map(m => m.id === activeMenuId ? { ...m, ...payload, categories: { name: catName } } : m));

    // Update Purchase / Cost Price if changed
    if (editItemCostPrice !== '' && Number(editItemCostPrice) >= 0) {
      const newCost = Number(editItemCostPrice);
      try {
        if (activeRecipe.length === 1) {
          const singleRec = activeRecipe[0];
          await db.raw_inventory.update(singleRec.inventory_item_id, { cost_per_unit: newCost, sync_status: 'PENDING' });
          setRawInventory(prev => prev.map(r => r.id === singleRec.inventory_item_id ? { ...r, cost_per_unit: newCost } : r));
          setActiveRecipe(prev => prev.map(r => r.id === singleRec.id ? { ...r, raw_inventory: { ...r.raw_inventory, cost_per_unit: newCost } } : r));
        } else if (activeRecipe.length === 0) {
          // Check if an ingredient with this name already exists
          const existingRaw = await db.raw_inventory.toArray();
          const matched = existingRaw.find(r => r.name.trim().toLowerCase() === editItemName.trim().toLowerCase());
          const newRawId = matched ? matched.id : crypto.randomUUID();

          const newRaw = {
            id: newRawId,
            name: matched ? matched.name : editItemName.trim(),
            base_unit: 'can',
            unit: 'can',
            cost_per_unit: newCost,
            current_stock: matched ? (matched.current_stock || 0) : 0,
            min_stock_alert: 5,
            sync_status: 'PENDING'
          };
          await db.raw_inventory.put(newRaw as any);
          await db.recipes.put({
            id: crypto.randomUUID(),
            menu_item_id: activeMenuId,
            inventory_item_id: newRawId,
            quantity_deducted: 1,
            sync_status: 'PENDING'
          });
          setRawInventory(prev => {
            const has = prev.some(r => r.id === newRawId);
            return has ? prev.map(r => r.id === newRawId ? newRaw : r) : [...prev, newRaw];
          });
          fetchRecipe(activeMenuId);
        }
      } catch (costErr) {
        console.warn("Cost update notice:", costErr);
      }
    }

    setIsEditingDetails(false);
    modal.toast.success("Menu item details updated successfully.");
    posBus.publish("MENU_UPDATED", {});
  };

  const handleDeleteMenuItem = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!isLaptopWriter()) return;
    const itemToDelete = menuItems.find(m => m.id === id);
    const itemName = itemToDelete?.name || 'this menu item';
    
    const ok = await modal.confirm({
      title: `Delete ${itemName}?`,
      message: `Are you sure you want to delete "${itemName}"? This item, its BOM recipe mapping, and linked deal components will be removed from local database and queued for cloud sync.`,
      confirmText: "Delete Menu Item",
      isDanger: true
    });
    if (!ok) return;

    // 1. Delete from local Dexie immediately (offline guarantee)
    try {
      const linkedRecs = await db.recipes.where('menu_item_id').equals(id).toArray();
      for (const r of linkedRecs) {
        await trackAndSyncDeletion('recipes', r.id);
      }
      const linkedDeals = await db.deal_components.where('deal_id').equals(id).toArray();
      for (const d of linkedDeals) {
        await trackAndSyncDeletion('deal_components', d.id);
      }
      await trackAndSyncDeletion('menu_items', id);

      await db.recipes.where('menu_item_id').equals(id).delete();
      await db.deal_components.where('menu_item_id').equals(id).delete();
      await db.deal_components.where('deal_id').equals(id).delete();
      await db.menu_items.delete(id);
    } catch (dexErr) {
      console.warn("Dexie menu delete warning:", dexErr);
    }
    setMenuItems(prev => prev.filter(m => m.id !== id));
    posBus.publish("MENU_UPDATED", {});
    if (activeMenuId === id) { 
      setActiveMenuId(null); 
      setActiveRecipe([]); 
      setIsEditingDetails(false);
      setMobileTab('MENU');
    }

    modal.toast.success(`"${itemName}" deleted.`);
    setTimeout(() => syncOfflineOrders(), 50);
  };

  const handleAddRecipeIngredient = async () => {
    if (!isLaptopWriter()) return;
    if (!activeMenuId || !selectedIngredient || Number(ingredientQty) <= 0) return;
    
    const existing = activeRecipe.find(r => r.inventory_item_id === selectedIngredient);
    const rawMatch = effectiveRawInventory.find(i => i.id === selectedIngredient);

    if (existing) {
      const newQty = Number(existing.quantity_deducted) + Number(ingredientQty);
      // 1. Update in local Dexie first (0ms offline guarantee)
      await db.recipes.update(existing.id, { quantity_deducted: newQty, sync_status: 'PENDING' });
      setActiveRecipe(prev => prev.map(r => r.id === existing.id ? { ...r, quantity_deducted: newQty } : r));
      setAllRecipes(prev => prev.map(r => r.id === existing.id ? { ...r, quantity_deducted: newQty } : r));
      setSelectedIngredient('');
      setIngredientQty('');
      modal.toast.success("Recipe ingredient quantity updated.");
      return;
    }

    const newRecId = crypto.randomUUID();
    const payload = {
      id: newRecId,
      menu_item_id: activeMenuId,
      inventory_item_id: selectedIngredient,
      quantity_deducted: Number(ingredientQty),
      sync_status: 'PENDING' as const
    };

    // 1. Write to local Dexie immediately (0ms, offline guarantee)
    await db.recipes.put(payload);
    const fullRecObj = {
      ...payload,
      raw_inventory: rawMatch || null
    };

    setActiveRecipe([...activeRecipe, fullRecObj]);
    setAllRecipes(prev => [...prev, fullRecObj]);
    setSelectedIngredient('');
    setIngredientQty('');
    modal.toast.success("Ingredient linked to recipe.");
  };

  const handleUpdateRecipeQty = async (recipeId: string, delta: number) => {
    if (!isLaptopWriter()) return;
    const existing = activeRecipe.find(r => r.id === recipeId);
    if (!existing) return;
    const currentQty = Number(existing.quantity_deducted);
    const newQty = Math.max(0.1, +(currentQty + delta).toFixed(3));
    if (newQty === currentQty) return;

    // 1. Update in local Dexie immediately
    await db.recipes.update(recipeId, { quantity_deducted: newQty, sync_status: 'PENDING' });
    setActiveRecipe(prev => prev.map(r => r.id === recipeId ? { ...r, quantity_deducted: newQty } : r));
    setAllRecipes(prev => prev.map(r => r.id === recipeId ? { ...r, quantity_deducted: newQty } : r));
  };

  const handleRemoveRecipeIngredient = async (recipeId: string) => {
    if (!isLaptopWriter()) return;
    await trackAndSyncDeletion('recipes', recipeId);
    await db.recipes.delete(recipeId);
    setActiveRecipe(prev => prev.filter(r => r.id !== recipeId));
    setAllRecipes(prev => prev.filter(r => r.id !== recipeId));
    modal.toast.success("Ingredient removed from recipe.");
    setTimeout(() => syncOfflineOrders(), 50);
  };

  const handleAddDealItem = async () => {
    if (!isLaptopWriter()) return;
    if (!activeItemData || dealItemQty <= 0) return;

    if (dealComponentMode === 'SPECIFIC') {
      if (!selectedDealItem) {
        return modal.warning("Missing Item", "Please select a specific menu item to add.");
      }
      
      const existing = dealComponents.find(d => d.menu_item_id === selectedDealItem && d.deal_id === activeItemData.id);
      const childItem = effectiveMenuItems.find(m => m.id === selectedDealItem);

      if (existing) {
        const newQty = Number(existing.quantity) + Number(dealItemQty);
        await db.deal_components.update(existing.id, { quantity: newQty, sync_status: 'PENDING' } as any);
        setDealComponents(dealComponents.map(d => d.id === existing.id ? { ...d, quantity: newQty } : d));
        setSelectedDealItem('');
        setDealItemQty(1);
        modal.toast.success("Deal item quantity updated.");
        return;
      }

      const newDealComponentId = crypto.randomUUID();
      const localPayload = {
        id: newDealComponentId,
        deal_id: activeItemData.id,
        menu_item_id: selectedDealItem,
        quantity: dealItemQty
      };

      await db.deal_components.put(localPayload);
      const fullDisplayObj = {
        ...localPayload,
        child: childItem || null
      };

      setDealComponents([...dealComponents, fullDisplayObj]);
      setSelectedDealItem('');
      setDealItemQty(1);
      modal.toast.success("Deal component added.");
    } else {
      // Category Choice Slot
      if (!selectedDealCategory) {
        return modal.warning("Missing Category", "Please select a category for this deal choice slot.");
      }
      const cat = categories.find(c => c.id === selectedDealCategory);
      const catName = cat?.name || 'Category';
      const slotTitle = dealSlotTitle.trim() || (dealItemQty > 1 ? `Choose ${dealItemQty} from ${catName}` : `Choose 1 from ${catName}`);

      const newDealComponentId = crypto.randomUUID();
      const localPayload = { 
        id: newDealComponentId,
        deal_id: activeItemData.id, 
        category_id: selectedDealCategory, 
        slot_title: slotTitle,
        quantity: dealItemQty 
      };

      await db.deal_components.put(localPayload);
      const fullDisplayObj = {
        ...localPayload,
        category: cat || null
      };

      setDealComponents([...dealComponents, fullDisplayObj]);
      setSelectedDealCategory('');
      setDealSlotTitle('');
      setDealItemQty(1);
      modal.toast.success(`Category choice slot added to deal.`);
    }
  };

  const handleUpdateDealQty = async (dealId: string, delta: number) => {
    if (!isLaptopWriter()) return;
    const existing = dealComponents.find(d => d.id === dealId);
    if (!existing) return;
    const newQty = Math.max(1, Number(existing.quantity) + delta);
    if (newQty === existing.quantity) return;

    await db.deal_components.update(dealId, { quantity: newQty });
    setDealComponents(prev => prev.map(d => d.id === dealId ? { ...d, quantity: newQty } : d));
  };

  const handleRemoveDealItem = async (dealId: string) => {
    if (!isLaptopWriter()) return;
    await trackAndSyncDeletion('deal_components', dealId);
    await db.deal_components.delete(dealId);
    setDealComponents(dealComponents.filter(d => d.id !== dealId));
    modal.toast.success("Deal component removed.");
    setTimeout(() => syncOfflineOrders(), 50);
  };

  const activeItemData = effectiveMenuItems.find(m => m.id === activeMenuId);
  
  // Helper to compute a menu item's recipe food cost with robust rawInventory fallback
  const getItemRecipeCogs = (menuItemId: string): number => {
    const recs = menuItemId === activeMenuId ? activeRecipe : effectiveRecipes.filter(r => r.menu_item_id === menuItemId);
    let cost = recs.reduce((sum, r) => {
      const currentRaw = effectiveRawInventory.find(raw => raw.id === r.inventory_item_id) || r.raw_inventory;
      const rawCost = Number(currentRaw?.cost_per_unit ?? 0);
      return sum + (Number(r.quantity_deducted || 0) * rawCost);
    }, 0);

    const item = effectiveMenuItems.find(m => m.id === menuItemId);
    if (cost <= 0) {
      if (item) {
        if (item.cost_price && Number(item.cost_price) > 0) {
          cost = Number(item.cost_price);
        } else {
          const rawMatch = effectiveRawInventory.find(raw => raw.name.trim().toLowerCase() === item.name.trim().toLowerCase());
          if (rawMatch && rawMatch.cost_per_unit) {
            cost = Number(rawMatch.cost_per_unit);
          }
        }
      }
    }
    // Factor in standalone cooking overhead if not already linked as recipe ingredient
    if (item && item.overhead_cost) {
      const hasOverhead = recs.some(r => {
        const raw = effectiveRawInventory.find(rawItem => rawItem.id === r.inventory_item_id);
        return raw && (raw.is_overhead || raw.name?.toLowerCase().includes('overhead'));
      });
      if (!hasOverhead) {
        cost += Number(item.overhead_cost);
      }
    }
    return cost;
  };

  // Helper to get stats for a deal component
  const getDealComponentStats = (dc: any) => {
    const qty = Number(dc.quantity || 1);
    if (dc.menu_item_id) {
      const childItem = effectiveMenuItems.find(m => m.id === dc.menu_item_id);
      const childCogs = getItemRecipeCogs(dc.menu_item_id);
      const childRetail = Number(dc.child?.price || childItem?.price || 0);
      return {
        name: dc.child?.name || childItem?.name || 'Item',
        cogsPerUnit: childCogs,
        totalCogs: childCogs * qty,
        retailPricePerUnit: childRetail,
        totalRetailValue: childRetail * qty,
        isCategory: false
      };
    } else if (dc.category_id) {
      const catItems = effectiveMenuItems.filter(m => m.category_id === dc.category_id);
      const catName = categories.find(c => c.id === dc.category_id)?.name || 'Category';
      const avgCogs = catItems.length > 0 
        ? catItems.reduce((acc, m) => acc + getItemRecipeCogs(m.id), 0) / catItems.length 
        : 0;
      const avgRetail = catItems.length > 0
        ? catItems.reduce((acc, m) => acc + Number(m.price || 0), 0) / catItems.length
        : 0;
      return {
        name: dc.slot_title || `Choice from ${catName}`,
        cogsPerUnit: avgCogs,
        totalCogs: avgCogs * qty,
        retailPricePerUnit: avgRetail,
        totalRetailValue: avgRetail * qty,
        isCategory: true,
        itemCount: catItems.length
      };
    }
    return {
      name: 'Custom Component',
      cogsPerUnit: 0,
      totalCogs: 0,
      retailPricePerUnit: 0,
      totalRetailValue: 0,
      isCategory: false
    };
  };

  // Financial Calculations: direct BOM ingredients + deal components (if item is a deal or has deal components)
  let directCogs = activeRecipe.reduce((sum, r) => {
    const currentRaw = effectiveRawInventory.find(raw => raw.id === r.inventory_item_id) || r.raw_inventory;
    const rawCost = Number(currentRaw?.cost_per_unit ?? 0);
    return sum + (Number(r.quantity_deducted || 0) * rawCost);
  }, 0);

  // Fallback for direct retail items or standalone items without multi-ingredient recipe
  if (directCogs <= 0 && activeItemData && !activeItemData.is_deal) {
    if (editItemCostPrice !== '' && Number(editItemCostPrice) > 0) {
      directCogs = Number(editItemCostPrice);
    } else if (activeItemData.cost_price && Number(activeItemData.cost_price) > 0) {
      directCogs = Number(activeItemData.cost_price);
    } else {
      const rawMatch = effectiveRawInventory.find(raw => raw.name.trim().toLowerCase() === activeItemData.name.trim().toLowerCase());
      if (rawMatch && rawMatch.cost_per_unit) {
        directCogs = Number(rawMatch.cost_per_unit);
      }
    }
  }

  // Pure menu item attribute for cooking overhead (oil, sauces, gas per cook)
  const itemOverhead = Number(activeItemData?.overhead_cost || 0);

  let dealComponentsCogs = 0;
  let dealComponentsRetailValue = 0;

  if (activeItemData?.is_deal || dealComponents.length > 0) {
    dealComponents.forEach(dc => {
      const stats = getDealComponentStats(dc);
      dealComponentsCogs += stats.totalCogs;
      dealComponentsRetailValue += stats.totalRetailValue;
    });
  }

  const totalCogs = directCogs + itemOverhead + dealComponentsCogs;
  const sellPrice = Number(activeItemData?.price || 0);
  const grossProfit = sellPrice - totalCogs;
  const marginPct = sellPrice > 0 ? ((grossProfit / sellPrice) * 100).toFixed(1) : '0';
  const dealSavings = Math.max(0, dealComponentsRetailValue - sellPrice);
  const dealDiscountPct = dealComponentsRetailValue > 0 ? ((dealSavings / dealComponentsRetailValue) * 100).toFixed(0) : '0';

  // Filter Menu Items
  const filteredMenuItems = menuItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(menuSearch.toLowerCase());
    const matchesCat = selectedCatFilter === 'ALL' || item.category_id === selectedCatFilter;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="flex flex-col gap-4 relative pb-12 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* VIEW-ONLY PHONE BANNER */}
      {!isLaptop && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-amber-700 dark:text-amber-300">
          <Eye className="w-4 h-4 shrink-0" />
          <span>Read-only mirror — menu edits and recipe modifications must be made on laptop POS</span>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-orange-50 dark:bg-orange-950/60 text-orange-600 dark:text-orange-400 flex items-center justify-center p-2 shadow-xs shrink-0 border border-orange-200 dark:border-orange-800">
            <ChefHat className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight">Menu Builder &amp; Recipes</h2>
            <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">Configure POS menu items, link ingredient recipes (BOM), and monitor margins.</p>
          </div>
        </div>
        {isLaptop && (
          <div className="flex items-center gap-2">
            <button 
              onClick={() => handleOpenAddModifierModal()}
              className="bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-3 sm:py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 touch-manipulation cursor-pointer"
              title="Manage POS modifiers & customer add-ons"
            >
              <Sparkles className="w-4 h-4" /> ADD-ONS &amp; MODIFIERS
            </button>
            <button 
              onClick={() => setIsAddingItem(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 sm:py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 touch-manipulation cursor-pointer"
            >
              <Plus className="w-5 h-5" /> ADD NEW ITEM
            </button>
          </div>
        )}
      </div>

      {/* MOBILE SEGMENTED VIEW SWITCHER (block md:hidden) */}
      <div className="flex md:hidden bg-slate-200/80 dark:bg-slate-800 p-1 rounded-2xl gap-1">
        <button 
          onClick={() => setMobileTab('MENU')}
          className={`flex-1 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
            mobileTab === 'MENU' ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <ChefHat className="w-4 h-4" />
          Menu Items ({menuItems.length})
        </button>
        <button 
          onClick={() => setMobileTab('RECIPE')}
          className={`flex-1 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all cursor-pointer ${
            mobileTab === 'RECIPE' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-400 shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <LinkIcon className="w-4 h-4" />
          {activeItemData ? activeItemData.name : 'Recipe & Margins'}
        </button>
      </div>

      {/* ADD MENU ITEM MODAL (MOBILE BOTTOM-SHEET / DESKTOP CENTERED - LAPTOP ONLY) */}
      {isLaptop && isAddingItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <h3 className="font-black text-base sm:text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <ChefHat className="w-5 h-5 text-blue-600 dark:text-blue-400" /> Add Menu Item
              </h3>
              <button onClick={() => setIsAddingItem(false)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              {/* Product Type Toggle */}
              <div>
                <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                  Product Type
                </label>
                <div className="grid grid-cols-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-1 border border-slate-200 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => setNewItemType('PREPARED')}
                    className={`py-2 px-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      newItemType === 'PREPARED'
                        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <ChefHat className="w-3.5 h-3.5" /> Kitchen Prepared
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewItemType('RETAIL_DRINK');
                      const drinkCat = categories.find(c => /drink|beverage|retail|cold/i.test(c.name));
                      if (drinkCat) setNewItemCategory(drinkCat.id);
                    }}
                    className={`py-2 px-2 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      newItemType === 'RETAIL_DRINK'
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5" /> Drinks &amp; Retail Goods
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Item Name *</label>
                <input 
                  type="text" 
                  value={newItemName} 
                  onChange={e => setNewItemName(e.target.value)} 
                  placeholder={newItemType === 'RETAIL_DRINK' ? "e.g. Coca Cola Can 250ml" : "e.g. Muchacho Crunch Burger"} 
                  className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-blue-500 outline-none" 
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Category *</label>
                  <button
                    type="button"
                    onClick={handleOpenAddCategoryModal}
                    className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> New Category
                  </button>
                </div>
                <div className="relative">
                  <select 
                    value={newItemCategory} 
                    onChange={e => setNewItemCategory(e.target.value)} 
                    className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-blue-500 outline-none cursor-pointer"
                  >
                    {categories.length === 0 ? (
                      <option value="">No categories (Click + New Category)</option>
                    ) : (
                      categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                    )}
                  </select>
                </div>
              </div>

              {/* Dual Price Setup for Retail Goods & Drinks */}
              {newItemType === 'RETAIL_DRINK' ? (
                <div className="space-y-3 p-3.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-black text-blue-900 dark:text-blue-300 uppercase">
                        Purchase Price (Cost) *
                      </label>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Rs.</span>
                        <input 
                          type="number" 
                          inputMode="numeric"
                          value={newItemCostPrice} 
                          onChange={e => setNewItemCostPrice(e.target.value === '' ? '' : Number(e.target.value))} 
                          placeholder="90" 
                          className="w-full border-2 border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl pl-9 pr-2 py-2 text-base font-black focus:border-blue-500 outline-none" 
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-black text-blue-900 dark:text-blue-300 uppercase">
                        Selling Price (Retail) *
                      </label>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Rs.</span>
                        <input 
                          type="number" 
                          inputMode="numeric"
                          value={newItemPrice} 
                          onChange={e => setNewItemPrice(e.target.value === '' ? '' : Number(e.target.value))} 
                          placeholder="110" 
                          className="w-full border-2 border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl pl-9 pr-2 py-2 text-base font-black focus:border-blue-500 outline-none" 
                        />
                      </div>
                    </div>
                  </div>

                  {/* Live Profit Preview */}
                  {Number(newItemPrice) > 0 && Number(newItemCostPrice) > 0 && (
                    <div className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 text-xs font-bold">
                      <span className="text-slate-500 dark:text-slate-400">Estimated Unit Profit:</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-black">
                        Rs. {(Number(newItemPrice) - Number(newItemCostPrice)).toFixed(0)} ({(((Number(newItemPrice) - Number(newItemCostPrice)) / Number(newItemPrice)) * 100).toFixed(1)}% margin)
                      </span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400">Opening Stock</label>
                      <input 
                        type="number" 
                        value={newItemStock} 
                        onChange={e => setNewItemStock(e.target.value === '' ? '' : Number(e.target.value))} 
                        placeholder="24"
                        className="w-full mt-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400">Min Alert Stock</label>
                      <input 
                        type="number" 
                        value={newItemMinAlert} 
                        onChange={e => setNewItemMinAlert(e.target.value === '' ? '' : Number(e.target.value))} 
                        placeholder="5"
                        className="w-full mt-1 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Selling Price (Rs.) *</label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-2.5 text-sm font-bold text-slate-400">Rs.</span>
                    <input 
                      type="number" 
                      inputMode="numeric"
                      value={newItemPrice} 
                      onChange={e => setNewItemPrice(e.target.value === '' ? '' : Number(e.target.value))} 
                      placeholder="450" 
                      className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl pl-10 pr-3.5 py-2.5 text-lg font-black focus:border-blue-500 outline-none" 
                    />
                  </div>

                  <div className="mt-3">
                    <label className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase flex items-center gap-1.5">
                      <Flame className="w-3.5 h-3.5" /> Cooking Overhead (Rs.) [Optional]
                    </label>
                    <div className="relative mt-1">
                      <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">Rs.</span>
                      <input 
                        type="number" 
                        inputMode="numeric"
                        value={newItemOverheadCost} 
                        onChange={e => setNewItemOverheadCost(e.target.value === '' ? '' : Number(e.target.value))} 
                        placeholder="e.g. 25 (Oil, Sauces, Gas, Packaging)" 
                        className="w-full border-2 border-orange-200 dark:border-orange-900/60 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl pl-9 pr-3 py-2 text-sm font-bold focus:border-orange-500 outline-none" 
                      />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Hidden variable expense per cook (automatically tracks in COGS, recipe, and deals).
                    </p>
                  </div>
                </div>
              )}

              {/* Universal POS Add-ons & Modifiers Checkbox */}
              <div className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newItemAllowsModifiers}
                    onChange={e => setNewItemAllowsModifiers(e.target.checked)}
                    className="w-4 h-4 text-purple-600 rounded border-purple-300 focus:ring-purple-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-black text-purple-900 dark:text-purple-200 block">
                      Allow Add-ons &amp; Modifiers on POS
                    </span>
                    <span className="text-[10px] text-purple-700 dark:text-purple-300 block">
                      Enable universal modifiers (extra cheese, sauces, dips) for this item during checkout
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-2">
              <button 
                onClick={() => setIsAddingItem(false)}
                className="flex-1 py-3 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm cursor-pointer"
              >
                CANCEL
              </button>
              <button 
                onClick={handleAddMenuItem}
                className="flex-[2] py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm tracking-wide shadow-md active:scale-95 transition-all cursor-pointer"
              >
                SAVE ITEM
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT MENU ITEM MODAL (LAPTOP ONLY) */}
      {isLaptop && isEditingDetails && activeItemData && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <h3 className="font-black text-base sm:text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Edit2 className="w-5 h-5 text-blue-600 dark:text-blue-400" /> Edit Item Details
              </h3>
              <button onClick={() => setIsEditingDetails(false)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Item Name *</label>
                <input 
                  type="text" 
                  value={editItemName} 
                  onChange={e => setEditItemName(e.target.value)} 
                  className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-blue-500 outline-none" 
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Category *</label>
                  <button
                    type="button"
                    onClick={handleOpenAddCategoryModal}
                    className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> New Category
                  </button>
                </div>
                <div className="relative">
                  <select 
                    value={editItemCategory} 
                    onChange={e => setEditItemCategory(e.target.value)} 
                    className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-blue-500 outline-none cursor-pointer"
                  >
                    {categories.length === 0 ? (
                      <option value="">No categories (Click + New Category)</option>
                    ) : (
                      categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
                    )}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Purchase Price (Cost)</label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-2.5 text-sm font-bold text-slate-400">Rs.</span>
                    <input 
                      type="number" 
                      inputMode="numeric"
                      value={editItemCostPrice} 
                      onChange={e => setEditItemCostPrice(e.target.value === '' ? '' : Number(e.target.value))} 
                      placeholder="90" 
                      className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl pl-10 pr-3 py-2.5 text-base font-black focus:border-blue-500 outline-none" 
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Selling Price (Retail) *</label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-2.5 text-sm font-bold text-slate-400">Rs.</span>
                    <input 
                      type="number" 
                      inputMode="numeric"
                      value={editItemPrice} 
                      onChange={e => setEditItemPrice(e.target.value === '' ? '' : Number(e.target.value))} 
                      className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl pl-10 pr-3 py-2.5 text-base font-black focus:border-blue-500 outline-none" 
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5" /> Cooking Overhead (Rs.) [Oil, Sauces, Gas per Cook]
                </label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-2 text-xs font-bold text-slate-400">Rs.</span>
                  <input 
                    type="number" 
                    inputMode="numeric"
                    value={editItemOverheadCost} 
                    onChange={e => setEditItemOverheadCost(e.target.value === '' ? '' : Number(e.target.value))} 
                    placeholder="0" 
                    className="w-full border-2 border-orange-200 dark:border-orange-900/60 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl pl-9 pr-3 py-2 text-sm font-bold focus:border-orange-500 outline-none" 
                  />
                </div>
                <p className="text-[11px] text-slate-400 mt-1">
                  Variable overhead for this dish (included in BOM margin &amp; deal components).
                </p>
              </div>

              {Number(editItemPrice) > 0 && Number(editItemCostPrice) > 0 && (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-bold">
                  <span className="text-emerald-800 dark:text-emerald-300">Unit Profit:</span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-black">
                    Rs. {(Number(editItemPrice) - Number(editItemCostPrice)).toFixed(1)} ({(((Number(editItemPrice) - Number(editItemCostPrice)) / Number(editItemPrice)) * 100).toFixed(1)}% margin)
                  </span>
                </div>
              )}

              {/* Universal POS Add-ons & Modifiers Checkbox */}
              <div className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60">
                <label className="flex items-center gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={editItemAllowsModifiers}
                    onChange={e => setEditItemAllowsModifiers(e.target.checked)}
                    className="w-4 h-4 text-purple-600 rounded border-purple-300 focus:ring-purple-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-black text-purple-900 dark:text-purple-200 block">
                      Allow Add-ons &amp; Modifiers on POS
                    </span>
                    <span className="text-[10px] text-purple-700 dark:text-purple-300 block">
                      Enable universal modifiers (extra cheese, sauces, dips) for this item during checkout
                    </span>
                  </div>
                </label>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-2">
              <button 
                onClick={() => setIsEditingDetails(false)}
                className="flex-1 py-3 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm cursor-pointer"
              >
                CANCEL
              </button>
              <button 
                onClick={handleUpdateMenuDetails}
                className="flex-[2] py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm tracking-wide shadow-md active:scale-95 transition-all cursor-pointer"
              >
                SAVE CHANGES
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MAIN CONTAINER: Responsive grid (Stacked on mobile, 2-column flex on desktop) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-5 min-h-[70vh] w-full max-w-full min-w-0">
        {/* ==================== LEFT COLUMN: MENU ITEMS CATALOG ==================== */}
        <div className={`md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs flex flex-col overflow-hidden min-w-0 max-w-full ${
          mobileTab === 'RECIPE' ? 'hidden md:flex' : 'flex'
        }`}>
          {/* Menu Catalog Header */}
          <div className="p-3.5 sm:p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center p-1.5 border border-slate-200 dark:border-slate-700">
                  <Layers className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-slate-800 dark:text-slate-100 text-sm sm:text-base leading-tight">
                    Menu Catalog
                  </h3>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">Items &amp; Categories</p>
                </div>
              </div>
              <span className="text-xs font-bold text-slate-400 bg-slate-200/80 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                {filteredMenuItems.length}
              </span>
            </div>

            {/* Search Input */}
            <div className="flex items-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl">
              <Search className="w-4 h-4 text-slate-400 shrink-0" />
              <input 
                type="text" 
                value={menuSearch}
                onChange={e => setMenuSearch(e.target.value)}
                placeholder="Search menu..."
                className="w-full text-xs font-bold text-slate-800 dark:text-slate-100 outline-none bg-transparent placeholder:text-slate-400 dark:placeholder:text-slate-500"
              />
              {menuSearch && (
                <button onClick={() => setMenuSearch('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Category Filter Pills (Horizontal scrollable) */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs">
              <button
                onClick={() => setSelectedCatFilter('ALL')}
                className={`px-2.5 py-1 rounded-lg font-black shrink-0 transition-colors cursor-pointer ${
                  selectedCatFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'
                }`}
              >
                ALL
              </button>
              {categories.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCatFilter(c.id)}
                  className={`px-2.5 py-1 rounded-lg font-black shrink-0 transition-colors cursor-pointer ${
                    selectedCatFilter === c.id ? 'bg-blue-600 text-white' : 'bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-700'
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          {/* Menu Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 max-h-[60vh] md:max-h-[70vh]">
            {isLoading ? (
              <div className="p-8 text-center text-slate-400 font-bold text-sm">Loading menu items...</div>
            ) : filteredMenuItems.length === 0 ? (
              <div className="p-8 text-center text-slate-400 font-bold text-sm">No items found matching criteria.</div>
            ) : (
              filteredMenuItems.map(item => {
                const isSelected = activeMenuId === item.id;
                return (
                  <div 
                    key={item.id} 
                    onClick={() => fetchRecipe(item.id)}
                    className={`p-3.5 sm:p-4 cursor-pointer transition-colors flex items-center justify-between gap-3 ${
                      isSelected ? 'bg-blue-50/80 dark:bg-blue-950/40 border-l-4 border-blue-600 text-slate-900 dark:text-slate-100' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50 text-slate-800 dark:text-slate-200'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`font-black text-sm truncate ${isSelected ? 'text-blue-900 dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
                          {item.name}
                        </p>
                        {item.is_deal && (
                          <span className="text-[9px] font-black bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 px-1.5 py-0.5 rounded uppercase shrink-0">
                            DEAL
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded truncate">
                          {item.categories?.name || 'Uncategorized'}
                        </span>
                        <span className="text-xs font-black text-slate-700 dark:text-slate-300">
                          Rs. {item.price}
                        </span>
                      </div>
                    </div>

                    {isLaptop && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button 
                          onClick={(e) => handleDeleteMenuItem(item.id, e)} 
                          className="p-2 text-slate-300 dark:text-slate-600 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                          title="Delete Menu Item"
                        >
                          <Trash2 className="w-4 h-4"/>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ==================== RIGHT COLUMN: RECIPE & MARGINS ==================== */}
        <div className={`md:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs flex flex-col overflow-hidden min-w-0 max-w-full ${
          mobileTab === 'MENU' ? 'hidden md:flex' : 'flex'
        }`}>
          {activeMenuId && activeItemData ? (
            <>
              {/* Recipe Top Header */}
              <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/50 flex flex-col gap-3">
                {/* Mobile Back Button */}
                <div className="flex md:hidden items-center justify-between">
                  <button 
                    onClick={() => setMobileTab('MENU')}
                    className="flex items-center gap-1.5 text-xs font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 rounded-xl border border-blue-200 dark:border-blue-800 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to Menu Items
                  </button>
                  {isLaptop && (
                    <button 
                      onClick={() => setIsEditingDetails(true)}
                      className="flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 rounded-xl cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" /> Edit Price
                    </button>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg sm:text-2xl font-black text-slate-900 dark:text-white">{activeItemData.name}</h2>
                      {isLaptop && (
                        <button 
                          onClick={() => setIsEditingDetails(true)} 
                          className="hidden sm:inline-flex p-1.5 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 rounded-lg transition-colors cursor-pointer"
                          title="Edit Item Details"
                        >
                          <Edit2 className="w-4 h-4"/>
                        </button>
                      )}
                    </div>
                    <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <LinkIcon className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400"/> 
                      Recipe Mapping &amp; Automatic Stock Deduction (BOM)
                    </p>
                  </div>

                  {/* Financial KPI Cards - 5 Columns: Selling Price, Recipe Ingredients, Overhead, Total Food Cost & Margin */}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    <div 
                      onClick={isLaptop ? () => setIsEditingDetails(true) : undefined} 
                      className={`bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-center shadow-2xs ${
                        isLaptop ? 'hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer' : ''
                      } transition-colors`}
                      title={isLaptop ? "Click to edit selling price" : undefined}
                    >
                      <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Selling Price</p>
                      <p className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 mt-0.5">Rs. {sellPrice}</p>
                    </div>

                    <div 
                      className="bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl p-2 text-center shadow-2xs"
                      title="Sum of linked raw ingredients"
                    >
                      <p className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Recipe Cost</p>
                      <p className="text-sm sm:text-base font-black text-slate-700 dark:text-slate-300 mt-0.5">Rs. {directCogs.toFixed(1)}</p>
                    </div>

                    <div 
                      onClick={isLaptop ? () => setIsEditingDetails(true) : undefined}
                      className={`bg-orange-50/70 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900/50 rounded-xl p-2 text-center shadow-2xs transition-colors ${
                        isLaptop ? 'hover:border-orange-400 cursor-pointer' : ''
                      }`}
                      title={isLaptop ? "Click to edit cooking overhead (oil, sauces, gas)" : "Cooking overhead"}
                    >
                      <p className="text-[9px] font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">Overhead</p>
                      <p className="text-sm sm:text-base font-black text-orange-700 dark:text-orange-300 mt-0.5">Rs. {itemOverhead.toFixed(1)}</p>
                    </div>

                    <div 
                      className="bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-xl p-2 text-center shadow-2xs"
                      title="Total Food Cost (COGS) = Recipe Cost + Cooking Overhead"
                    >
                      <p className="text-[9px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider">Total COGS</p>
                      <p className="text-sm sm:text-base font-black text-red-700 dark:text-red-300 mt-0.5">Rs. {totalCogs.toFixed(1)}</p>
                    </div>

                    <div className={`col-span-2 sm:col-span-1 border rounded-xl p-2 text-center shadow-2xs ${
                      Number(marginPct) > 50 
                        ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50' 
                        : 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900/50'
                    }`}>
                      <p className={`text-[9px] font-bold uppercase tracking-wider ${
                        Number(marginPct) > 50 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'
                      }`}>Margin</p>
                      <p className={`text-sm sm:text-base font-black mt-0.5 ${
                        Number(marginPct) > 50 ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'
                      }`}>{marginPct}%</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recipe Body: Add Ingredient + BOM List */}
              <div className="flex-1 p-4 sm:p-6 overflow-y-auto space-y-5">
                {/* Link Raw Ingredient Form (Laptop Only) */}
                {isLaptop ? (
                  <div className="bg-slate-50 dark:bg-slate-800/40 p-3.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-end gap-3 shadow-2xs">
                    <div className="flex-1">
                      <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Select Raw Ingredient
                      </label>
                      <select 
                        value={selectedIngredient} 
                        onChange={e => setSelectedIngredient(e.target.value)} 
                        className="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mt-1 border-2 border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-bold focus:border-blue-500 outline-none cursor-pointer"
                      >
                        <option value="">Select ingredient to deduct...</option>
                        {effectiveRawInventory
                          .filter(inv => !inv.is_overhead && !inv.name?.toLowerCase().startsWith('overhead') && !inv.name?.toLowerCase().startsWith('cooking overhead'))
                          .map(inv => (
                            <option key={inv.id} value={inv.id}>
                              {inv.name} (Live: {Number(inv.current_stock).toFixed(0)} {inv.base_unit})
                            </option>
                        ))}
                      </select>
                    </div>

                    <div className="w-full sm:w-44">
                      <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        Deduct Qty per order
                      </label>
                      <div className="relative mt-1">
                        <input 
                          type="number" 
                          inputMode="decimal"
                          value={ingredientQty} 
                          onChange={e => setIngredientQty(e.target.value === '' ? '' : Number(e.target.value))} 
                          className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2.5 text-sm font-black focus:border-blue-500 outline-none" 
                          placeholder="1" 
                        />
                        <span className="absolute right-3 top-2.5 text-xs font-bold text-slate-400">
                          {effectiveRawInventory.find(i => i.id === selectedIngredient)?.base_unit || 'Units'}
                        </span>
                      </div>
                    </div>

                    <button 
                      onClick={handleAddRecipeIngredient} 
                      disabled={!selectedIngredient || Number(ingredientQty) <= 0} 
                      className="w-full sm:w-auto bg-slate-900 hover:bg-black dark:bg-blue-600 dark:hover:bg-blue-700 text-white font-black text-xs tracking-wider px-5 py-3 rounded-xl transition-colors disabled:opacity-50 shadow-md active:scale-95 touch-manipulation cursor-pointer shrink-0 uppercase"
                    >
                      + ADD TO RECIPE
                    </button>
                  </div>
                ) : (
                  <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-500 dark:text-slate-400 text-center">
                    Recipe Ingredients &amp; Cost Components (Read-Only Cloud Mirror)
                  </div>
                )}

                {/* Bill of Materials (BOM) Section */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <h4 className="font-black text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                      <span>Recipe Components ({activeRecipe.length})</span>
                      <span className="text-slate-400 font-bold lowercase hidden sm:inline">auto-deducted at checkout</span>
                    </h4>
                  </div>

                  {activeRecipe.length === 0 ? (
                    <div className="p-6 sm:p-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center flex flex-col items-center">
                      <AlertCircle className="w-8 h-8 text-slate-300 dark:text-slate-600 mb-2"/>
                      <p className="font-black text-sm text-slate-600 dark:text-slate-300">No ingredients linked yet.</p>
                      <p className="text-xs text-slate-400 mt-0.5">When cashier sells this item, no stock will be deducted until you link ingredients above.</p>
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-2xs divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                      {activeRecipe.map((r) => {
                        const raw = effectiveRawInventory.find(rawItem => rawItem.id === r.inventory_item_id) || r.raw_inventory;
                        const cost = Number(r.quantity_deducted || 1) * Number(raw?.cost_per_unit || 0);
                        const isLow = Number(raw?.current_stock || 0) <= (raw?.min_stock_alert || 0);
                        return (
                          <div key={r.id} className="p-3 sm:p-4 flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="font-black text-sm text-slate-900 dark:text-slate-100 truncate">{raw?.name}</p>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-xs">
                                <span className={`font-bold ${isLow ? 'text-red-600 dark:text-red-400' : 'text-slate-400'}`}>
                                  Live Stock: {Number(raw?.current_stock || 0).toFixed(0)} {raw?.base_unit}
                                </span>
                                <span className="text-slate-300 dark:text-slate-700">•</span>
                                <span className="font-bold text-red-600 dark:text-red-400">
                                  Cost: Rs. {cost.toFixed(2)}
                                </span>
                              </div>
                            </div>

                            {/* Touch Increment/Decrement steppers */}
                            {isLaptop ? (
                              <div className="flex items-center gap-2 shrink-0">
                                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
                                  <button
                                    onClick={() => handleUpdateRecipeQty(r.id, -1)}
                                    disabled={Number(r.quantity_deducted) <= 1}
                                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 flex items-center justify-center font-black text-xs transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
                                    title="Decrease quantity"
                                  >
                                    <Minus className="w-4 h-4" />
                                  </button>
                                  <span className="text-xs font-black text-blue-700 dark:text-blue-400 px-2 min-w-[48px] text-center">
                                    {r.quantity_deducted} {raw?.base_unit}
                                  </span>
                                  <button
                                    onClick={() => handleUpdateRecipeQty(r.id, 1)}
                                    className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 flex items-center justify-center font-black text-xs transition-all active:scale-95 cursor-pointer"
                                    title="Increase quantity"
                                  >
                                    <Plus className="w-4 h-4" />
                                  </button>
                                </div>

                                <button 
                                  onClick={() => handleRemoveRecipeIngredient(r.id)} 
                                  className="p-2 text-slate-300 dark:text-slate-600 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                                  title="Remove Ingredient"
                                >
                                  <Trash2 className="w-4 h-4"/>
                                </button>
                              </div>
                            ) : (
                              <div className="shrink-0 text-xs font-black text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                                {r.quantity_deducted} {raw?.base_unit}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* DEAL COMPONENTS BUILDER (IF DEAL / COMBO) */}
                {activeItemData.is_deal && (
                  <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                    <div>
                      <h4 className="font-black text-xs text-purple-800 dark:text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="w-4 h-4"/> Deal &amp; Combo Components Builder
                      </h4>
                      <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                        Configure this deal with specific menu items or flexible whole-category choice slots (e.g. choose 1 burger, choose 1 drink).
                      </p>
                    </div>

                    {/* Mode Selector & Form for Adding Component (Counter Only) */}
                    {isLaptop && (
                      <>
                        <div className="flex bg-purple-100/80 dark:bg-purple-950/60 p-1 rounded-xl gap-1 border border-purple-200 dark:border-purple-800">
                          <button
                            type="button"
                            onClick={() => setDealComponentMode('SPECIFIC')}
                            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-black transition-all cursor-pointer ${
                              dealComponentMode === 'SPECIFIC'
                                ? 'bg-purple-700 text-white shadow-xs'
                                : 'text-purple-800 dark:text-purple-300 hover:bg-purple-200/50 dark:hover:bg-purple-900/40'
                            }`}
                          >
                            Specific Menu Item
                          </button>
                          <button
                            type="button"
                            onClick={() => setDealComponentMode('CATEGORY')}
                            className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-black transition-all cursor-pointer ${
                              dealComponentMode === 'CATEGORY'
                                ? 'bg-purple-700 text-white shadow-xs'
                                : 'text-purple-800 dark:text-purple-300 hover:bg-purple-200/50 dark:hover:bg-purple-900/40'
                            }`}
                          >
                            Whole Category Choice Slot
                          </button>
                        </div>

                        {/* Form for Adding Component */}
                        {dealComponentMode === 'SPECIFIC' ? (
                          <div className="bg-purple-50/70 dark:bg-purple-950/30 p-3.5 rounded-2xl border border-purple-200 dark:border-purple-800/60 flex flex-col sm:flex-row sm:items-end gap-3 shadow-2xs">
                            {/* Optional Category Filter */}
                            <div className="w-full sm:w-44">
                              <label className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                                Filter Category
                              </label>
                              <select
                                value={dealSpecificCatFilter}
                                onChange={e => setDealSpecificCatFilter(e.target.value)}
                                className="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mt-1 border-2 border-purple-200 dark:border-purple-800 rounded-xl px-2.5 py-2 text-xs font-bold focus:border-purple-500 outline-none cursor-pointer"
                              >
                                <option value="ALL">All Categories</option>
                                {categories.filter(c => c.name.toLowerCase() !== 'deals').map(c => (
                                  <option key={c.id} value={c.id}>{c.name}</option>
                                ))}
                              </select>
                            </div>

                            {/* Menu Item Dropdown */}
                            <div className="flex-1">
                              <label className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                                Select Menu Item
                              </label>
                              <select 
                                value={selectedDealItem} 
                                onChange={e => setSelectedDealItem(e.target.value)} 
                                className="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mt-1 border-2 border-purple-200 dark:border-purple-800 rounded-xl px-3 py-2 text-xs sm:text-sm font-bold focus:border-purple-500 outline-none cursor-pointer"
                              >
                                <option value="">Select menu item...</option>
                                {menuItems
                                  .filter(m => m.id !== activeItemData.id)
                                  .filter(m => dealSpecificCatFilter === 'ALL' || m.category_id === dealSpecificCatFilter)
                                  .map(m => (
                                    <option key={m.id} value={m.id}>{m.name} (Rs. {m.price})</option>
                                  ))}
                              </select>
                            </div>

                            <div className="w-full sm:w-24">
                              <label className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                                Quantity
                              </label>
                              <input 
                                type="number" 
                                inputMode="numeric"
                                min="1"
                                value={dealItemQty} 
                                onChange={e => setDealItemQty(Math.max(1, Number(e.target.value)))} 
                                className="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mt-1 border-2 border-purple-200 dark:border-purple-800 rounded-xl px-3 py-2 text-sm font-black focus:border-purple-500 outline-none" 
                                placeholder="1" 
                              />
                            </div>

                            <button 
                              onClick={handleAddDealItem} 
                              disabled={!selectedDealItem || dealItemQty <= 0} 
                              className="w-full sm:w-auto bg-purple-600 text-white font-black text-xs tracking-wider px-5 py-2.5 rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 shadow-md active:scale-95 touch-manipulation cursor-pointer uppercase"
                            >
                              + ADD ITEM
                            </button>
                          </div>
                        ) : (
                          <div className="bg-purple-50/70 dark:bg-purple-950/30 p-3.5 rounded-2xl border border-purple-200 dark:border-purple-800/60 flex flex-col sm:flex-row sm:items-end gap-3 shadow-2xs">
                            {/* Select Category */}
                            <div className="flex-1">
                              <label className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                                Choose Category For Slot
                              </label>
                              <select
                                value={selectedDealCategory}
                                onChange={e => {
                                  setSelectedDealCategory(e.target.value);
                                  const cat = categories.find(c => c.id === e.target.value);
                                  if (cat && !dealSlotTitle) {
                                    setDealSlotTitle(`Choose 1 from ${cat.name}`);
                                  }
                                }}
                                className="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mt-1 border-2 border-purple-200 dark:border-purple-800 rounded-xl px-3 py-2 text-xs sm:text-sm font-bold focus:border-purple-500 outline-none cursor-pointer"
                              >
                                <option value="">Select category...</option>
                                {categories
                                  .filter(c => c.name.toLowerCase() !== 'deals')
                                  .map(c => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                              </select>
                            </div>

                            {/* Slot Title */}
                            <div className="flex-1">
                              <label className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                                Slot Title / Prompt
                              </label>
                              <input
                                type="text"
                                value={dealSlotTitle}
                                onChange={e => setDealSlotTitle(e.target.value)}
                                placeholder="e.g. Choose Any Burger"
                                className="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mt-1 border-2 border-purple-200 dark:border-purple-800 rounded-xl px-3 py-2 text-xs sm:text-sm font-bold focus:border-purple-500 outline-none"
                              />
                            </div>

                            <div className="w-full sm:w-24">
                              <label className="text-[10px] font-black text-purple-700 dark:text-purple-300 uppercase tracking-wider">
                                Quantity
                              </label>
                              <input 
                                type="number" 
                                inputMode="numeric"
                                min="1"
                                value={dealItemQty} 
                                onChange={e => setDealItemQty(Math.max(1, Number(e.target.value)))} 
                                className="w-full bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 mt-1 border-2 border-purple-200 dark:border-purple-800 rounded-xl px-3 py-2 text-sm font-black focus:border-purple-500 outline-none" 
                                placeholder="1" 
                              />
                            </div>

                            <button 
                              onClick={handleAddDealItem} 
                              disabled={!selectedDealCategory || dealItemQty <= 0} 
                              className="w-full sm:w-auto bg-purple-600 text-white font-black text-xs tracking-wider px-5 py-2.5 rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 shadow-md active:scale-95 touch-manipulation cursor-pointer uppercase"
                            >
                              + ADD SLOT
                            </button>
                          </div>
                        )}
                      </>
                    )}

                    {/* Deal Components List */}
                    {dealComponents.length > 0 && (
                      <div className="space-y-4">
                        <div className="border border-purple-200 dark:border-purple-800 rounded-2xl overflow-hidden shadow-2xs divide-y divide-purple-100 dark:divide-purple-900/50 bg-white dark:bg-slate-900">
                          {dealComponents.map(dc => {
                            const isCategory = Boolean(dc.category_id && !dc.menu_item_id);
                            const compStats = getDealComponentStats(dc);
                            return (
                              <div key={dc.id} className="p-3 flex items-center justify-between gap-2 hover:bg-purple-50/40 dark:hover:bg-purple-950/20">
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    {isCategory ? (
                                      <span className="text-[9px] font-black tracking-wider uppercase bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 px-1.5 py-0.5 rounded">
                                        CATEGORY CHOICE
                                      </span>
                                    ) : (
                                      <span className="text-[9px] font-black tracking-wider uppercase bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800 px-1.5 py-0.5 rounded">
                                        SPECIFIC ITEM
                                      </span>
                                    )}
                                    <p className="font-black text-sm text-slate-800 dark:text-slate-100 truncate">
                                      {compStats.name}
                                    </p>
                                  </div>
                                  
                                  {/* Component Cost & Retail Value Stats */}
                                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
                                    <span className="font-bold text-red-600 dark:text-red-400">
                                      {isCategory ? 'Avg Food Cost:' : 'Food Cost:'} Rs. {compStats.cogsPerUnit.toFixed(1)}
                                    </span>
                                    <span className="text-slate-300 dark:text-slate-700">•</span>
                                    <span className="font-semibold text-slate-500 dark:text-slate-400">
                                      {isCategory ? 'Avg Menu Price:' : 'Menu Price:'} Rs. {compStats.retailPricePerUnit}
                                    </span>
                                    <span className="text-slate-300 dark:text-slate-700">•</span>
                                    <span className="font-black text-purple-700 dark:text-purple-300">
                                      Subtotal Cost: Rs. {compStats.totalCogs.toFixed(1)}
                                    </span>
                                  </div>

                                  {isCategory && (
                                    <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 mt-0.5">
                                      Available choices: any product in <span className="font-bold text-slate-600 dark:text-slate-300">{dc.category?.name || 'category'}</span> ({compStats.itemCount || 0} items)
                                    </p>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {isLaptop ? (
                                    <>
                                      <div className="flex items-center bg-purple-50 dark:bg-purple-950/60 p-0.5 rounded-xl border border-purple-200 dark:border-purple-800">
                                        <button
                                          onClick={() => handleUpdateDealQty(dc.id, -1)}
                                          disabled={Number(dc.quantity) <= 1}
                                          className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 flex items-center justify-center font-black text-xs disabled:opacity-40 cursor-pointer"
                                        >
                                          <Minus className="w-3.5 h-3.5" />
                                        </button>
                                        <span className="text-xs font-black text-purple-800 dark:text-purple-300 px-2 min-w-[36px] text-center">
                                          {dc.quantity}x
                                        </span>
                                        <button
                                          onClick={() => handleUpdateDealQty(dc.id, 1)}
                                          className="w-8 h-8 rounded-lg bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 flex items-center justify-center font-black text-xs cursor-pointer"
                                        >
                                          <Plus className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                      <button 
                                        onClick={() => handleRemoveDealItem(dc.id)} 
                                        className="p-2 text-slate-300 dark:text-slate-600 hover:text-red-600 dark:hover:text-red-400 rounded-lg cursor-pointer"
                                        title="Delete component"
                                      >
                                        <Trash2 className="w-4 h-4"/>
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-xs font-black bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300 px-2.5 py-1 rounded-lg border border-purple-200 dark:border-purple-800">
                                      {dc.quantity}x
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Deal Economics & Profitability Summary Card */}
                        <div className="bg-gradient-to-br from-purple-50 via-indigo-50/60 to-slate-50 dark:from-purple-950/40 dark:via-indigo-950/30 dark:to-slate-900/40 p-4 rounded-2xl border-2 border-purple-200 dark:border-purple-800/70 shadow-xs space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-black tracking-wider uppercase text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                              Deal Economics &amp; Margin Summary
                            </span>
                            <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full border ${
                              Number(marginPct) >= 50 
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700' 
                                : Number(marginPct) >= 35
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-700'
                                : 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-700'
                            }`}>
                              {Number(marginPct) >= 50 ? 'Strong Margin' : Number(marginPct) >= 35 ? 'Moderate Margin' : 'Low Margin Alert'}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                            <div className="bg-white/90 dark:bg-slate-800/90 p-2.5 rounded-xl border border-purple-100 dark:border-purple-900/40 shadow-2xs">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">A la carte Value</p>
                              <p className="text-sm sm:text-base font-black text-slate-700 dark:text-slate-200">Rs. {dealComponentsRetailValue}</p>
                            </div>
                            <div className="bg-white/90 dark:bg-slate-800/90 p-2.5 rounded-xl border border-purple-100 dark:border-purple-900/40 shadow-2xs">
                              <p className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">Deal Price</p>
                              <p className="text-sm sm:text-base font-black text-purple-700 dark:text-purple-300">Rs. {sellPrice}</p>
                              {dealSavings > 0 && (
                                <p className="text-[9px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">Save Rs. {dealSavings} ({dealDiscountPct}% off)</p>
                              )}
                            </div>
                            <div className="bg-white/90 dark:bg-slate-800/90 p-2.5 rounded-xl border border-purple-100 dark:border-purple-900/40 shadow-2xs">
                              <p className="text-[10px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider">Total Food Cost (COGS)</p>
                              <p className="text-sm sm:text-base font-black text-red-700 dark:text-red-300">Rs. {totalCogs.toFixed(1)}</p>
                            </div>
                            <div className="bg-white/90 dark:bg-slate-800/90 p-2.5 rounded-xl border border-purple-100 dark:border-purple-900/40 shadow-2xs">
                              <p className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Gross Profit (Margin)</p>
                              <p className="text-sm sm:text-base font-black text-emerald-700 dark:text-emerald-300">Rs. {grossProfit.toFixed(1)} ({marginPct}%)</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400">
              <ChefHat className="w-16 h-16 mb-3 opacity-25" />
              <h3 className="text-base sm:text-lg font-black text-slate-700 dark:text-slate-200">Select a Menu Item</h3>
              <p className="text-xs sm:text-sm font-semibold max-w-sm mt-1 text-slate-400">
                Tap any menu item from the left catalog to configure its recipe, Bill of Materials, and profit margins.
              </p>
              <button 
                onClick={() => setMobileTab('MENU')}
                className="mt-4 md:hidden bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl cursor-pointer"
              >
                Browse Menu Catalog
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Add New Category Modal Dialog (Laptop Only) */}
      {isLaptop && isCategoryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-black text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-blue-600" /> New Menu Category
              </h3>
              <button 
                type="button" 
                onClick={() => setIsCategoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleConfirmAddCategory} className="pt-4 space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 block mb-1">Category Name *</label>
                <input
                  type="text"
                  autoFocus
                  placeholder="e.g. Burgers, Beverages, Desserts..."
                  value={newCategoryNameInput}
                  onChange={e => { setNewCategoryNameInput(e.target.value); setCategoryModalError(null); }}
                  className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2 text-sm font-bold focus:border-blue-500 outline-none"
                />
                {categoryModalError && (
                  <p className="text-xs text-red-500 mt-1 font-semibold">{categoryModalError}</p>
                )}
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsCategoryModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-bold rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-black rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Save Category
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* POS Add-ons & Modifiers Manager Modal (Laptop Only) */}
      {isLaptop && isManagingModifiers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full p-4 sm:p-6 shadow-2xl animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-black text-base text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-purple-600" /> POS Add-ons &amp; Modifiers Manager
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Dynamic add-ons shown in POS cart. Each item links to raw inventory to deduct stock and calculate COGS.
                </p>
              </div>
              <button 
                type="button" 
                onClick={() => setIsManagingModifiers(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modifier Form (Add / Edit) - Laptop Counter Only */}
            {isLaptop && (
              <form onSubmit={handleSaveModifier} className="p-3.5 my-3 bg-purple-50/60 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-purple-900 dark:text-purple-300 uppercase tracking-wide">
                    {editingModifierId ? 'Edit Modifier' : '+ Create New POS Add-on'}
                  </span>
                  {editingModifierId && (
                    <button 
                      type="button" 
                      onClick={() => {
                        setEditingModifierId(null);
                        setModName('');
                        setModPrice('');
                        setModInventoryId('');
                        setModDeductQty(1);
                      }}
                      className="text-[11px] font-bold text-slate-500 hover:underline cursor-pointer"
                    >
                      Cancel Editing
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">Add-on Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Extra Cheese Slice"
                      value={modName}
                      onChange={e => setModName(e.target.value)}
                      className="w-full mt-1 border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">Customer Price (Rs.) *</label>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="70"
                      value={modPrice}
                      onChange={e => setModPrice(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full mt-1 border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">Deduct From Raw Ingredient</label>
                    <select
                      value={modInventoryId}
                      onChange={e => setModInventoryId(e.target.value)}
                      className="w-full mt-1 border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-slate-100 cursor-pointer"
                    >
                      <option value="">(None - No inventory deduction)</option>
                      {effectiveRawInventory.map(inv => (
                        <option key={inv.id} value={inv.id}>
                          {inv.name} (Live: {Number(inv.current_stock).toFixed(0)} {inv.base_unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-600 dark:text-slate-400 uppercase">Deduct Quantity</label>
                    <div className="flex gap-2 mt-1">
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="1"
                        value={modDeductQty}
                        onChange={e => setModDeductQty(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full border border-purple-300 dark:border-purple-700 bg-white dark:bg-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-900 dark:text-slate-100"
                      />
                      <button
                        type="submit"
                        disabled={!modName.trim() || Number(modPrice) < 0}
                        className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-black text-xs rounded-lg shadow-sm transition-all cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {editingModifierId ? 'Update' : 'Add'}
                      </button>
                    </div>
                  </div>
                </div>
              </form>
            )}

            {/* Existing Modifiers List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 border border-slate-200 dark:border-slate-800 rounded-xl p-2 bg-slate-50 dark:bg-slate-800/40">
              <span className="text-[10px] font-black uppercase text-slate-400 px-1 block mb-1">
                Active POS Add-ons ({modifiersList.length})
              </span>
              {modifiersList.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">No add-ons created yet.</p>
              ) : (
                modifiersList.map(mod => {
                  const linkedRaw = effectiveRawInventory.find(r => r.id === mod.inventory_item_id);
                  return (
                    <div 
                      key={mod.id} 
                      className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-purple-300 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-xs text-slate-900 dark:text-slate-100">{mod.name}</span>
                          <span className="text-xs font-black text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-950/60 px-1.5 py-0.2 rounded">
                            +Rs. {mod.price}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {linkedRaw ? (
                            <span>Deducts: {mod.quantity_deducted || 1} {linkedRaw.base_unit} of <strong>{linkedRaw.name}</strong></span>
                          ) : (
                            <span className="text-amber-500 font-medium">No inventory deduction linked</span>
                          )}
                        </div>
                      </div>
                      {isLaptop && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleOpenAddModifierModal(mod)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg cursor-pointer"
                            title="Edit Add-on"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteModifier(mod.id)}
                            className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                            title="Delete Add-on"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="pt-3 flex justify-end">
              <button
                type="button"
                onClick={() => setIsManagingModifiers(false)}
                className="px-4 py-2 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-black cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

