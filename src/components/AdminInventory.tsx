"use client";

import React, { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { modal } from "@/lib/modalStore";
import { db } from "@/lib/db";
import { posBus } from "@/lib/broadcast-bus";
import { isLaptopWriter } from "@/lib/device-mode";
import { createBackup } from "@/lib/auto-backup";
import { cleanupCorruptedInventoryItems, recalculateAndSyncMenuItemCosts } from "@/lib/inventory-service";
import { trackAndSyncDeletion, syncOfflineOrders } from "@/lib/sync-engine";
import { 
  Plus, AlertTriangle, X, PackagePlus, Calculator, Info, Zap, 
  Edit2, Trash2, ArrowRight, TrendingUp, AlertCircle, CheckCircle2, 
  Search, Filter, RefreshCw, Package, Copy, Layers, Eye
} from "lucide-react";

interface AdminInventoryProps {
  isActive?: boolean;
  refreshTrigger?: number;
}

export default function AdminInventory({ isActive, refreshTrigger }: AdminInventoryProps = {}) {
  const [stockItems, setStockItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLaptop, setIsLaptop] = useState(false);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [showLowStockOnly, setShowLowStockOnly] = useState(false);

  // Duplicate Resolution Modal state
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
  const [duplicateSets, setDuplicateSets] = useState<any[]>([]);
  const [isScanningDuplicates, setIsScanningDuplicates] = useState(false);
  const [isMerging, setIsMerging] = useState(false);

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Restock Delivery Modal state
  const [isRestockOpen, setIsRestockOpen] = useState(false);
  const [restockItem, setRestockItem] = useState<any>(null);
  const [restockBulkQty, setRestockBulkQty] = useState<number>(0);
  const [restockBulkCost, setRestockBulkCost] = useState<number>(0);
  
  // Form fields
  const [name, setName] = useState('');
  const [bulkUnit, setBulkUnit] = useState('Packet');
  const [baseUnit, setBaseUnit] = useState('Pieces');
  const [conversionRate, setConversionRate] = useState<number>(4);
  const [bulkCost, setBulkCost] = useState<number>(100);
  const [initialBulkStock, setInitialBulkStock] = useState<number>(5);
  const [minAlert, setMinAlert] = useState<number>(10);

  const calculatedCostPerBase = conversionRate > 0 ? (bulkCost / conversionRate) : 0;
  const calculatedTotalBaseStock = initialBulkStock * conversionRate;

  useEffect(() => {
    setIsLaptop(isLaptopWriter());
    fetchStock();
    
    // 1. Instant local posBus listener (POS deductions & void restocks)
    const unsubBus = posBus.subscribe((msg: any) => {
      if ([
        'INVENTORY_DEDUCTED', 'ORDER_CREATED', 'ORDER_COMPLETED', 
        'ORDER_CANCELLED', 'INVENTORY_RESTOCKED', 'INVENTORY_UPDATED',
        'STOCK_UPDATED', 'OFFLINE_MODE_CHANGED', 'MANUAL_REFRESH'
      ].includes(msg?.type)) {
        fetchStock();
      }
    });

    // 2. Cloud realtime subscription (only active if remote phone viewer)
    let channel: any = null;
    if (!isLaptopWriter()) {
      channel = supabase
        .channel('live-inventory')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_inventory' }, () => {
          fetchStock();
        })
        .subscribe();
    }
      
    return () => { 
      unsubBus();
      if (channel) supabase.removeChannel(channel); 
    };
  }, []);

  useEffect(() => {
    if (isActive) {
      fetchStock();
    }
  }, [isActive]);

  useEffect(() => {
    if (refreshTrigger) {
      fetchStock();
    }
  }, [refreshTrigger]);

  const fetchStock = async () => {
    setIsLoading(true);
    try {
      if (isLaptopWriter()) {
        // Laptop reads ONLY from local Dexie (0ms offline guarantee, single authoritative source)
        await cleanupCorruptedInventoryItems().catch(() => {});
        const localStock = await db.raw_inventory.toArray();
        setStockItems(localStock || []);
      } else {
        // Phone / Remote Vercel: read from Supabase mirror (view-only)
        const { data } = await supabase.from('raw_inventory').select('*').order('name');
        if (data && data.length > 0) {
          setStockItems(data);
        } else {
          const localStock = await db.raw_inventory.toArray();
          setStockItems(localStock || []);
        }
      }
    } catch (err) {
      console.warn("[Inventory] Stock fetch note:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const openAddModal = () => {
    setEditingId(null);
    setName(''); 
    setBulkUnit('Packet'); 
    setBaseUnit('Pieces'); 
    setConversionRate(4); 
    setBulkCost(100); 
    setInitialBulkStock(5); 
    setMinAlert(10);
    setIsModalOpen(true);
  };

  const openEditModal = (item: any) => {
    if (!isLaptopWriter()) return;
    setEditingId(item.id);
    setName(item.name);
    setBaseUnit(item.base_unit);
    setMinAlert(item.min_stock_alert);
    setBulkUnit(item.bulk_unit || 'Packet');
    setConversionRate(item.conversion_rate || 1);
    setBulkCost(item.bulk_cost || item.cost_per_unit);
    const currentBulk = (item.conversion_rate || 1) > 0 ? (item.current_stock / (item.conversion_rate || 1)) : item.current_stock;
    setInitialBulkStock(Number(currentBulk.toFixed(2)));
    setIsModalOpen(true);
  };

  const openRestockModal = (item: any) => {
    if (!isLaptopWriter()) return;
    setRestockItem(item);
    setRestockBulkQty(1);
    setRestockBulkCost(item.bulk_cost || (item.cost_per_unit * (item.conversion_rate || 1)));
    setIsRestockOpen(true);
  };

  const handleSaveItem = async () => {
    if (!isLaptopWriter()) return;
    if (!name.trim()) return modal.warning("Missing Name", "Ingredient name is required.");
    if (conversionRate <= 0) return modal.warning("Invalid Conversion", "Conversion rate must be greater than 0.");
    
    const payload = {
      name: name.trim(),
      base_unit: baseUnit.trim(),
      unit: baseUnit.trim(),
      cost_per_unit: calculatedCostPerBase,
      current_stock: calculatedTotalBaseStock,
      min_stock_alert: minAlert,
      bulk_unit: bulkUnit.trim(),
      conversion_rate: conversionRate,
      bulk_cost: bulkCost
    };

    if (editingId) {
      // 1. Update in local Dexie immediately (0ms, 100% offline, laptop authoritative)
      await db.raw_inventory.update(editingId, { ...payload, sync_status: 'PENDING' });
      setStockItems(prev => prev.map(item => item.id === editingId ? { ...item, ...payload } : item));
      setIsModalOpen(false);

      // 2. Automatically recalculate linked menu items' COGS and profit margins with new ingredient price
      await recalculateAndSyncMenuItemCosts(editingId);

      modal.toast.success("Ingredient updated & linked recipe costs refreshed.");
      posBus.publish('STOCK_UPDATED', { itemId: editingId, newStock: payload.current_stock });
      setTimeout(() => syncOfflineOrders(), 50);
    } else {
      // Deduplicate check (case-insensitive)
      const trimmedName = name.trim();
      const existing = stockItems.find(i => i.name.trim().toLowerCase() === trimmedName.toLowerCase());
      if (existing) {
        modal.warning("Ingredient Already Exists", `An ingredient named "${existing.name}" already exists in inventory. Please edit that item or adjust stock directly instead of creating a duplicate.`);
        return;
      }

      const newId = crypto.randomUUID();
      const newItem = { id: newId, ...payload, sync_status: 'PENDING' };
      
      // 1. Save to local Dexie immediately (0ms, 100% offline)
      await db.raw_inventory.put(newItem as any);
      setStockItems(prev => [...prev, newItem]);
      setIsModalOpen(false);

      modal.toast.success("Ingredient created successfully.");
      posBus.publish('STOCK_UPDATED', { itemId: newId, newStock: payload.current_stock });
      setTimeout(() => syncOfflineOrders(), 50);
    }
  };

  const handleProcessRestock = async () => {
    if (!isLaptopWriter() || !restockItem) return;
    
    const conversion = restockItem.conversion_rate || 1;
    const addedBaseUnits = restockBulkQty * conversion;
    const newBaseCost = conversion > 0 ? (restockBulkCost / conversion) : 0;
    
    const oldTotalValue = restockItem.current_stock * restockItem.cost_per_unit;
    const addedTotalValue = addedBaseUnits * newBaseCost;
    const newTotalStock = restockItem.current_stock + addedBaseUnits;
    
    const blendedCostPerUnit = newTotalStock > 0 ? ((oldTotalValue + addedTotalValue) / newTotalStock) : newBaseCost;

    const payload = {
      current_stock: newTotalStock,
      cost_per_unit: blendedCostPerUnit,
      bulk_cost: restockBulkCost
    };

    // 1. Update in local Dexie immediately (0ms, 100% offline)
    await db.raw_inventory.update(restockItem.id, { ...payload, sync_status: 'PENDING' });
    setStockItems(prev => prev.map(item => item.id === restockItem.id ? { ...item, ...payload } : item));
    setIsRestockOpen(false);

    // 2. Automatically recalculate linked menu items' COGS and profit margins with new blended price
    await recalculateAndSyncMenuItemCosts(restockItem.id);

    posBus.publish('STOCK_UPDATED', { itemId: restockItem.id, newStock: newTotalStock });
    posBus.publish('MENU_UPDATED', { itemId: restockItem.id });
    setTimeout(() => syncOfflineOrders(), 50);

    modal.success(
      "Restock Successful!",
      `Restock logged into inventory.\nNew Blended Cost: Rs. ${blendedCostPerUnit.toFixed(2)} / ${restockItem.base_unit}\nTotal In Stock: ${newTotalStock.toFixed(1)} ${restockItem.base_unit}\nLinked menu item recipes & margins updated.`
    );
  };

  const handleDeleteItem = async (id: string, itemName: string) => {
    if (!isLaptopWriter()) return;
    const ok = await modal.confirm({
      title: `Delete ${itemName}?`,
      message: `Are you sure you want to delete "${itemName}"? This item and its recipe links will be removed from local database and queued for cloud sync.`,
      confirmText: "Delete Ingredient",
      isDanger: true
    });
    if (!ok) return;

    // Delete from local Dexie immediately (0ms offline guarantee)
    try {
      const linked = await db.recipes.where('inventory_item_id').equals(id).toArray();
      for (const r of linked) {
        await trackAndSyncDeletion('recipes', r.id);
      }
      await db.recipes.where('inventory_item_id').equals(id).delete();
      await db.modifiers.where('inventory_item_id').equals(id).modify({ inventory_item_id: undefined });
      await db.raw_inventory.delete(id);
      await trackAndSyncDeletion('raw_inventory', id);
    } catch (dexErr) {
      console.warn("Dexie deletion warning:", dexErr);
    }
    setStockItems(prev => prev.filter(item => item.id !== id));
    modal.toast.success(`"${itemName}" deleted.`);
    setTimeout(() => syncOfflineOrders(), 50);
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // DUPLICATE INVENTORY SCAN & ATOMIC MERGE
  // ─────────────────────────────────────────────────────────────────────────────
  const handleScanDuplicates = async () => {
    setIsScanningDuplicates(true);
    try {
      const allStock = await db.raw_inventory.toArray();
      const allRecipes = await db.recipes.toArray();

      // Group by normalized name (case-insensitive & trimmed)
      const map = new Map<string, any[]>();
      for (const item of allStock) {
        const norm = item.name.trim().toLowerCase();
        if (!map.has(norm)) map.set(norm, []);
        map.get(norm)!.push(item);
      }

      const dupes: any[] = [];
      map.forEach((items, norm) => {
        if (items.length > 1) {
          // Sort items by ID to determine older item (Target)
          items.sort((a, b) => a.id.localeCompare(b.id));
          const target = items[0];
          const sources = items.slice(1);

          dupes.push({
            normalizedName: norm,
            target: {
              ...target,
              recipeCount: allRecipes.filter(r => r.inventory_item_id === target.id).length
            },
            sources: sources.map(s => ({
              ...s,
              recipeCount: allRecipes.filter(r => r.inventory_item_id === s.id).length
            }))
          });
        }
      });

      setDuplicateSets(dupes);
      if (dupes.length === 0) {
        modal.toast.success("No duplicate ingredients found! Inventory is clean.");
      } else {
        setIsDuplicateModalOpen(true);
      }
    } catch (err: any) {
      modal.error("Scan Failed", err.message);
    } finally {
      setIsScanningDuplicates(false);
    }
  };

  const handleMergeDuplicate = async (targetItem: any, sourceItem: any) => {
    const ok = await modal.confirm({
      title: `Merge "${sourceItem.name}" into "${targetItem.name}"?`,
      message: `This will:\n1. Automatically create a local backup before merging.\n2. Sum stock (${sourceItem.current_stock} + ${targetItem.current_stock} = ${(Number(sourceItem.current_stock) || 0) + (Number(targetItem.current_stock) || 0)} ${targetItem.base_unit || targetItem.unit}).\n3. Remap all recipe ingredients from "${sourceItem.name}" to "${targetItem.name}".\n4. Write an inventory audit log.\n5. Delete the duplicate record from Dexie.`,
      confirmText: "Backup & Merge Items",
      isDanger: false
    });
    if (!ok) return;

    setIsMerging(true);
    try {
      // 1. Automatically trigger local backup before merge
      await createBackup(`pre-duplicate-merge-${sourceItem.name}`);

      // 2. Compute summed stock
      const newStock = (Number(targetItem.current_stock) || 0) + (Number(sourceItem.current_stock) || 0);

      // 3. Atomically perform merge in Dexie
      await db.transaction('rw', [db.raw_inventory, db.recipes, db.modifiers, db.inventory_logs], async () => {
        // Remap recipes
        const linkedRecipes = await db.recipes.where('inventory_item_id').equals(sourceItem.id).toArray();
        for (const r of linkedRecipes) {
          await db.recipes.update(r.id, { inventory_item_id: targetItem.id, sync_status: 'PENDING' });
        }

        // Remap modifiers
        const linkedModifiers = await db.modifiers.where('inventory_item_id').equals(sourceItem.id).toArray();
        for (const m of linkedModifiers) {
          await db.modifiers.update(m.id, { inventory_item_id: targetItem.id });
        }

        // Update target stock
        await db.raw_inventory.update(targetItem.id, {
          current_stock: newStock,
          sync_status: 'PENDING'
        });

        // Write inventory audit log
        await db.inventory_logs.put({
          id: crypto.randomUUID(),
          inventory_item_id: targetItem.id,
          change_qty: Number(sourceItem.current_stock) || 0,
          reason: `MERGE: merged ${sourceItem.name} (${sourceItem.current_stock}) into ${targetItem.name}`,
          created_at: new Date().toISOString(),
          sync_status: 'PENDING'
        });

        // Delete source item from Dexie
        await db.raw_inventory.delete(sourceItem.id);
      });

      modal.toast.success(`Successfully merged "${sourceItem.name}" into "${targetItem.name}".`);
      posBus.publish('STOCK_UPDATED', { itemId: targetItem.id, newStock });

      // Refresh stock & duplicate modal
      await fetchStock();
      await handleScanDuplicates();
    } catch (err: any) {
      modal.error("Merge Failed", err.message);
    } finally {
      setIsMerging(false);
    }
  };

  const applyTemplate = (type: string) => {
    if (type === 'KG_TO_G') { setBulkUnit('KG'); setBaseUnit('Grams'); setConversionRate(1000); }
    if (type === 'L_TO_ML') { setBulkUnit('Liter'); setBaseUnit('ML'); setConversionRate(1000); }
    if (type === 'DOZEN') { setBulkUnit('Dozen'); setBaseUnit('Pieces'); setConversionRate(12); }
    if (type === 'PACK_6') { setBulkUnit('Packet'); setBaseUnit('Pieces'); setConversionRate(6); }
  };

  // Quick Stats Calculations (NaN-guarded, excludes any legacy fake overhead)
  const realStockItems = stockItems.filter(item => !item.is_overhead && !item.name?.toLowerCase().startsWith('overhead') && !item.name?.toLowerCase().startsWith('cooking overhead'));
  const totalValue = realStockItems.reduce((sum, item) => {
    const stock = Number(item.current_stock) || 0;
    const cost = Number(item.cost_per_unit) || 0;
    return sum + (stock * cost);
  }, 0);
  const lowStockCount = realStockItems.filter(item => (Number(item.current_stock) || 0) <= (Number(item.min_stock_alert) || 0)).length;
  const optimalCount = realStockItems.length - lowStockCount;

  // Filtered Items
  const filteredItems = realStockItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const isLow = item.current_stock <= item.min_stock_alert;
    if (showLowStockOnly) return matchesSearch && isLow;
    return matchesSearch;
  });

  return (
    <div className="flex flex-col gap-5 sm:gap-6 relative pb-12 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* VIEW-ONLY PHONE BANNER */}
      {!isLaptop && (
        <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center gap-2.5 text-xs font-bold text-amber-700 dark:text-amber-300">
          <Eye className="w-4 h-4 shrink-0" />
          <span>Read-only mirror — edits must be made on laptop POS</span>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center p-2 shadow-xs shrink-0 border border-blue-200 dark:border-blue-800">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight">Stock &amp; Raw Ingredients</h2>
            <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
              Track base inventory, process deliveries, and calculate recipe costs.
            </p>
          </div>
        </div>
        
        {isLaptop && (
          <div className="flex items-center gap-2">
            <button
              onClick={handleScanDuplicates}
              disabled={isScanningDuplicates}
              className="bg-amber-50 hover:bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-3.5 py-3 sm:py-2.5 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-1.5 transition-all shadow-xs active:scale-95 touch-manipulation cursor-pointer"
              title="Scan and merge duplicate ingredient names"
            >
              <Copy className="w-4 h-4" />
              <span>{isScanningDuplicates ? "Scanning..." : "Find Duplicates"}</span>
            </button>
            <button 
              onClick={openAddModal}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 sm:py-2.5 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 touch-manipulation cursor-pointer"
            >
              <Plus className="w-5 h-5" /> ADD INGREDIENT
            </button>
          </div>
        )}
      </div>

      {/* QUICK INVENTORY STATS - Spacious layout that NEVER truncates numbers */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Items */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 rounded-2xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">Total Items</span>
            <div className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 p-1.5 sm:p-2 rounded-xl shrink-0">
              <PackagePlus className="w-4 h-4 sm:w-5 sm:h-5"/>
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 mt-2 leading-none">{stockItems.length}</p>
        </div>
        
        {/* Total Value */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 rounded-2xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-emerald-600/80 dark:text-emerald-400 uppercase tracking-wider">Total Value</span>
            <div className="bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300 p-1.5 sm:p-2 rounded-xl shrink-0">
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5"/>
            </div>
          </div>
          <p className="text-base sm:text-xl md:text-2xl font-black text-slate-800 dark:text-slate-100 mt-2 leading-tight whitespace-nowrap overflow-visible">
            Rs. {totalValue.toLocaleString(undefined, {maximumFractionDigits: 0})}
          </p>
        </div>

        {/* Optimal Stock */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-4 rounded-2xl shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-blue-600/80 dark:text-blue-400 uppercase tracking-wider">Optimal Stock</span>
            <div className="bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 p-1.5 sm:p-2 rounded-xl shrink-0">
              <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5"/>
            </div>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 mt-2 leading-none">{optimalCount}</p>
        </div>

        {/* Low Stock Alerts */}
        <div 
          onClick={() => setShowLowStockOnly(!showLowStockOnly)}
          className={`border p-3.5 sm:p-4 rounded-2xl shadow-xs flex flex-col justify-between cursor-pointer transition-all ${
            lowStockCount > 0 
              ? 'bg-red-50/60 dark:bg-red-950/30 border-red-300 dark:border-red-900/60 ring-2 ring-red-400/20' 
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] sm:text-xs font-bold text-red-600 dark:text-red-400 uppercase tracking-wider">Low Stock</span>
            <div className={`p-1.5 sm:p-2 rounded-xl shrink-0 ${lowStockCount > 0 ? 'bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
              <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5"/>
            </div>
          </div>
          <div className="flex items-baseline justify-between mt-2">
            <p className={`text-xl sm:text-2xl font-black leading-none ${lowStockCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-800 dark:text-slate-100'}`}>
              {lowStockCount}
            </p>
            {lowStockCount > 0 && (
              <span className="text-[10px] font-bold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-950/80 px-2 py-0.5 rounded-full">
                {showLowStockOnly ? 'Filtered' : 'Filter'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SEARCH AND FILTER BAR */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3 rounded-2xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-2 rounded-xl flex-1">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input 
            type="text" 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search raw ingredient by name..."
            className="w-full bg-transparent text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLowStockOnly(!showLowStockOnly)}
            className={`px-3 py-2 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer ${
              showLowStockOnly 
                ? 'bg-red-600 text-white shadow-xs' 
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            {showLowStockOnly ? 'Showing: Low Stock' : 'Filter: Low Stock'}
          </button>

          <button 
            onClick={fetchStock} 
            title="Refresh Stock List"
            className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* RESTOCK / PROCESS DELIVERY MODAL (MOBILE BOTTOM-SHEET / DESKTOP CENTERED - LAPTOP ONLY) */}
      {isLaptop && isRestockOpen && restockItem && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-xl rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[92vh] overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <div className="min-w-0 pr-2">
                <h3 className="font-black text-base sm:text-lg text-slate-800 dark:text-slate-100 truncate">
                  Process Delivery: {restockItem.name}
                </h3>
                <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                  Blends new delivery cost via Weighted Average Cost.
                </p>
              </div>
              <button 
                onClick={() => setIsRestockOpen(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5"/>
              </button>
            </div>
            
            {/* Modal Body */}
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Quantity Received (in {restockItem.bulk_unit || 'Bulk Unit'})
                  </label>
                  <input 
                    type="number" 
                    inputMode="decimal"
                    value={restockBulkQty || ''} 
                    onChange={e => setRestockBulkQty(Number(e.target.value))} 
                    className="w-full mt-1.5 border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2.5 text-lg font-black focus:border-blue-500 outline-none" 
                    placeholder="1"
                  />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Equals Base Units ({restockItem.base_unit})
                  </label>
                  <input 
                    type="number" 
                    inputMode="decimal"
                    value={(restockBulkQty * (restockItem.conversion_rate || 1)) || ''} 
                    onChange={e => setRestockBulkQty(Number(e.target.value) / (restockItem.conversion_rate || 1))} 
                    className="w-full mt-1.5 border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2.5 text-lg font-black focus:border-blue-500 outline-none" 
                    placeholder="0"
                  />
                </div>

                <div className="sm:col-span-2 bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
                  <label className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Total Invoiced Cost for this Batch (Rs.)
                  </label>
                  <div className="relative mt-1.5">
                    <span className="absolute left-3 top-3 text-sm font-bold text-slate-400">Rs.</span>
                    <input 
                      type="number" 
                      inputMode="decimal"
                      value={restockBulkCost || ''} 
                      onChange={e => setRestockBulkCost(Number(e.target.value))} 
                      className="w-full border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl pl-10 pr-3 py-2.5 text-lg font-black focus:border-blue-500 outline-none" 
                      placeholder="0"
                    />
                  </div>
                </div>
              </div>

              {/* Financial Impact Preview */}
              <div className="bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 p-4 rounded-2xl">
                <h4 className="font-bold text-xs text-blue-900 dark:text-blue-300 mb-3 flex items-center gap-1.5 uppercase tracking-wider">
                  <Calculator className="w-4 h-4 text-blue-600 dark:text-blue-400"/> Financial Impact Preview
                </h4>
                <div className="grid grid-cols-3 gap-2 text-center items-center">
                  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-blue-100 dark:border-slate-700 shadow-2xs">
                    <p className="text-[9px] font-bold text-slate-400 uppercase">Old Cost / {restockItem.base_unit}</p>
                    <p className="text-sm sm:text-base font-black text-slate-700 dark:text-slate-200 mt-0.5">Rs. {Number(restockItem.cost_per_unit).toFixed(2)}</p>
                  </div>
                  <div className="flex items-center justify-center text-blue-400">
                    <ArrowRight className="w-5 h-5" />
                  </div>
                  <div className="bg-white dark:bg-slate-800 p-2.5 rounded-xl border border-blue-200 dark:border-blue-800 shadow-2xs">
                    <p className="text-[9px] font-bold text-blue-600 dark:text-blue-400 uppercase">New Blended Cost</p>
                    <p className="text-base sm:text-lg font-black text-blue-700 dark:text-blue-300 mt-0.5">
                      Rs. {((restockItem.current_stock * restockItem.cost_per_unit + (restockBulkQty * (restockItem.conversion_rate || 1)) * (restockBulkCost / (restockItem.conversion_rate || 1))) / (restockItem.current_stock + (restockBulkQty * (restockItem.conversion_rate || 1))) || 0).toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 text-center bg-white/70 dark:bg-slate-800/70 py-1.5 px-3 rounded-lg border border-blue-100 dark:border-slate-700">
                  <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                    New Total Stock will be: <span className="font-black text-slate-900 dark:text-white">{(restockItem.current_stock + (restockBulkQty * (restockItem.conversion_rate || 1))).toFixed(1)} {restockItem.base_unit}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-2">
              <button 
                onClick={() => setIsRestockOpen(false)}
                className="flex-1 py-3 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm transition-all cursor-pointer"
              >
                CANCEL
              </button>
              <button 
                onClick={handleProcessRestock} 
                className="flex-[2] py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm tracking-wide shadow-md active:scale-95 transition-all touch-manipulation cursor-pointer"
              >
                CONFIRM &amp; UPDATE LEDGER
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD / EDIT INGREDIENT MODAL (MOBILE BOTTOM-SHEET / DESKTOP CENTERED - LAPTOP ONLY) */}
      {isLaptop && isModalOpen && !isRestockOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-2xl rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 flex flex-col max-h-[92vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
              <div>
                <h3 className="font-black text-base sm:text-lg text-slate-800 dark:text-slate-100">
                  {editingId ? 'Edit Stock Ingredient' : 'Add New Ingredient'}
                </h3>
                <p className="text-[11px] font-bold text-slate-400">
                  Converts wholesale bulk purchases into base recipe units.
                </p>
              </div>
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5"/>
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
              {/* Quick Conversion Templates */}
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1.5">Quick Unit Presets</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button onClick={() => applyTemplate('KG_TO_G')} type="button" className="text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 py-1.5 px-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center gap-1 cursor-pointer">
                    <Zap className="w-3 h-3 text-blue-600 dark:text-blue-400"/> KG &rarr; Grams
                  </button>
                  <button onClick={() => applyTemplate('L_TO_ML')} type="button" className="text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 py-1.5 px-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center gap-1 cursor-pointer">
                    <Zap className="w-3 h-3 text-blue-600 dark:text-blue-400"/> Liter &rarr; ML
                  </button>
                  <button onClick={() => applyTemplate('DOZEN')} type="button" className="text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 py-1.5 px-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center gap-1 cursor-pointer">
                    <Zap className="w-3 h-3 text-blue-600 dark:text-blue-400"/> Dozen &rarr; Pcs
                  </button>
                  <button onClick={() => applyTemplate('PACK_6')} type="button" className="text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 py-1.5 px-2 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 border border-blue-200 dark:border-blue-800 flex items-center justify-center gap-1 cursor-pointer">
                    <Zap className="w-3 h-3 text-blue-600 dark:text-blue-400"/> Pack &rarr; 6 Pcs
                  </button>
                </div>
              </div>

              {/* Form Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Ingredient Name *</label>
                  <input 
                    type="text" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                    placeholder="e.g. Beef Patty, Cheese Slice, Mayo" 
                    className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-blue-500 outline-none" 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Wholesale Unit (Bulk)</label>
                  <input 
                    type="text" 
                    value={bulkUnit} 
                    onChange={e => setBulkUnit(e.target.value)} 
                    placeholder="Packet, KG, Box" 
                    className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-blue-500 outline-none" 
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Kitchen Unit (Base)</label>
                  <input 
                    type="text" 
                    value={baseUnit} 
                    onChange={e => setBaseUnit(e.target.value)} 
                    placeholder="Pieces, Grams, ML" 
                    className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2.5 text-sm font-bold focus:border-blue-500 outline-none" 
                  />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-200 dark:border-slate-700 sm:col-span-2 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">How many {baseUnit} in 1 {bulkUnit}?</label>
                    <input 
                      type="number" 
                      inputMode="decimal"
                      value={conversionRate || ''} 
                      onChange={e => setConversionRate(Number(e.target.value))} 
                      className="w-24 border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-2.5 py-1 text-sm font-black text-center focus:border-blue-500 outline-none" 
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">Cost of 1 {bulkUnit} (Rs.)</label>
                    <input 
                      type="number" 
                      inputMode="decimal"
                      value={bulkCost || ''} 
                      onChange={e => setBulkCost(Number(e.target.value))} 
                      className="w-24 border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-lg px-2.5 py-1 text-sm font-black text-center focus:border-blue-500 outline-none" 
                    />
                  </div>
                </div>

                {/* System Derived Cost Per Base Unit */}
                <div className="sm:col-span-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 p-3.5 rounded-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider">Calculated Recipe Cost</p>
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Wholesale cost &divide; conversion rate</p>
                  </div>
                  <div className="text-xl sm:text-2xl font-black text-emerald-800 dark:text-emerald-300 bg-white dark:bg-slate-800 px-3 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    Rs. {calculatedCostPerBase.toFixed(2)} <span className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">/{baseUnit}</span>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Live Stock (in {bulkUnit}s)</label>
                  <input 
                    type="number" 
                    inputMode="decimal"
                    value={initialBulkStock || ''} 
                    onChange={e => setInitialBulkStock(Number(e.target.value))} 
                    className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3.5 py-2.5 text-sm font-black focus:border-emerald-500 outline-none" 
                  />
                  <p className="text-[10px] font-bold text-slate-400 mt-1">
                    = {calculatedTotalBaseStock.toFixed(0)} {baseUnit} in system
                  </p>
                </div>

                <div>
                  <label className="text-xs font-bold text-red-600 dark:text-red-400 uppercase">Low Stock Alert ({baseUnit})</label>
                  <input 
                    type="number" 
                    inputMode="decimal"
                    value={minAlert || ''} 
                    onChange={e => setMinAlert(Number(e.target.value))} 
                    className="w-full mt-1 border-2 border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-800 text-red-700 dark:text-red-400 rounded-xl px-3.5 py-2.5 text-sm font-black focus:border-red-500 outline-none" 
                  />
                  <p className="text-[10px] font-bold text-slate-400 mt-1">
                    Triggers red warning badge
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-2">
              <button 
                onClick={() => setIsModalOpen(false)} 
                className="flex-1 py-3 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm transition-all cursor-pointer"
              >
                CANCEL
              </button>
              <button 
                onClick={handleSaveItem} 
                className="flex-[2] py-3 rounded-xl bg-slate-900 hover:bg-black dark:bg-blue-600 dark:hover:bg-blue-700 text-white font-black text-sm tracking-wide shadow-md active:scale-95 transition-all touch-manipulation cursor-pointer uppercase"
              >
                {editingId ? 'UPDATE INGREDIENT' : 'SAVE INGREDIENT'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1. MOBILE CARDS VIEW (block md:hidden) - Ultra touch friendly */}
      <div className="block md:hidden space-y-3">
        {isLoading ? (
          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-slate-400 font-bold text-sm">
            Loading inventory...
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 text-center text-slate-400 font-bold text-sm">
            No ingredients found matching &quot;{searchQuery}&quot;.
          </div>
        ) : (
          filteredItems.map(item => {
            const isLow = item.current_stock <= item.min_stock_alert;
            return (
              <div 
                key={item.id} 
                className={`bg-white dark:bg-slate-900 border rounded-2xl p-4 shadow-xs flex flex-col gap-3 transition-all ${
                  isLow ? 'border-red-300 dark:border-red-900/60 ring-1 ring-red-200 dark:ring-red-950/40' : 'border-slate-200 dark:border-slate-800'
                }`}
              >
                {/* Header row: Name + Status */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-black text-base text-slate-900 dark:text-slate-100">{item.name}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] font-black bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded uppercase">
                        {item.base_unit}
                      </span>
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        Rs. {Number(item.cost_per_unit).toFixed(2)} / unit
                      </span>
                    </div>
                  </div>

                  <div>
                    {isLow ? (
                      <span className="flex items-center gap-1 text-[10px] font-black bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 px-2 py-1 rounded-full uppercase">
                        <AlertTriangle className="w-3 h-3" /> LOW STOCK
                      </span>
                    ) : (
                      <span className="text-[10px] font-black bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-2 py-1 rounded-full uppercase">
                        OPTIMAL
                      </span>
                    )}
                  </div>
                </div>

                {/* Stock count and valuation banner */}
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Live System Stock</p>
                    <p className="text-xl font-black text-slate-900 dark:text-slate-100">
                      {Number(item.current_stock).toFixed(1)} <span className="text-xs font-bold text-slate-500 dark:text-slate-400">{item.base_unit}</span>
                    </p>
                    {item.conversion_rate > 1 && item.bulk_unit && (
                      <p className="text-[11px] font-bold text-slate-400">
                        &asymp; {(item.current_stock / item.conversion_rate).toFixed(1)} {item.bulk_unit}s
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Holding Value</p>
                    <p className="text-base font-black text-emerald-700 dark:text-emerald-400">
                      Rs. {(item.current_stock * item.cost_per_unit).toFixed(0)}
                    </p>
                    <p className="text-[10px] font-bold text-slate-400">
                      Alert at &le; {item.min_stock_alert}
                    </p>
                  </div>
                </div>

                {/* Touch Action Bar (Min 44px touch height) */}
                {isLaptop ? (
                  <div className="grid grid-cols-3 gap-2 pt-1">
                    <button 
                      onClick={() => openRestockModal(item)}
                      className="py-3 px-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black text-xs rounded-xl flex items-center justify-center gap-1.5 shadow-xs transition-all touch-manipulation cursor-pointer"
                    >
                      <PackagePlus className="w-3.5 h-3.5" /> RESTOCK
                    </button>

                    <button 
                      onClick={() => openEditModal(item)}
                      className="py-3 px-3 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors touch-manipulation cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" /> EDIT
                    </button>

                    <button 
                      onClick={() => handleDeleteItem(item.id, item.name)}
                      className="py-3 px-3 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors touch-manipulation cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> DELETE
                    </button>
                  </div>
                ) : (
                  <div className="pt-1 text-center text-[11px] font-bold text-slate-400 dark:text-slate-500">
                    View-only mode (laptop counter edits only)
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 2. DESKTOP TABLE VIEW (hidden md:block) */}
      <div className="hidden md:block bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-xs uppercase tracking-wider font-bold">
              <th className="p-4">Raw Ingredient</th>
              <th className="p-4">Base Unit</th>
              <th className="p-4 text-right">Cost per Unit</th>
              <th className="p-4 text-right">Live Stock Count</th>
              <th className="p-4 text-center">Status</th>
              <th className="p-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {isLoading ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400 font-medium">Loading inventory engine...</td></tr>
            ) : filteredItems.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400 font-medium">No ingredients found.</td></tr>
            ) : (
              filteredItems.map(item => {
                const isLow = item.current_stock <= item.min_stock_alert;
                return (
                  <tr key={item.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="p-4 font-black text-slate-800 dark:text-slate-100">{item.name}</td>
                    <td className="p-4">
                      <span className="text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/60 px-2 py-1 rounded uppercase">{item.base_unit}</span>
                    </td>
                    <td className="p-4 text-right align-middle">
                      <div className="flex flex-col items-end">
                        <span className="font-black text-slate-700 dark:text-slate-200">
                          Rs. {(Number(item.cost_per_unit) || 0).toFixed(2)}
                        </span>
                        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          Total: Rs. {((Number(item.current_stock) || 0) * (Number(item.cost_per_unit) || 0)).toFixed(0)}
                        </span>
                      </div>
                    </td>
                    <td className="p-4 text-right align-middle">
                      <div className="flex flex-col items-end">
                        <span className="font-black text-xl text-slate-900 dark:text-slate-100">{Number(item.current_stock).toFixed(1)}</span>
                        {item.conversion_rate > 1 && item.bulk_unit && (
                          <span className="text-xs font-bold text-slate-400">
                            ~{(item.current_stock / item.conversion_rate).toFixed(1)} {item.bulk_unit}s
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      {isLow ? (
                        <span className="inline-flex items-center justify-center gap-1 text-xs font-black bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 px-2.5 py-1 rounded-full uppercase">
                          <AlertTriangle className="w-3.5 h-3.5"/> LOW STOCK
                        </span>
                      ) : (
                        <span className="text-xs font-black bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full uppercase">
                          OPTIMAL
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      {isLaptop ? (
                        <div className="flex justify-end gap-1.5">
                          <button 
                            onClick={() => openRestockModal(item)} 
                            className="px-2.5 py-1.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors flex items-center gap-1 font-bold text-xs cursor-pointer" 
                            title="Process New Delivery"
                          >
                            <PackagePlus className="w-3.5 h-3.5" /> Restock
                          </button>
                          <button 
                            onClick={() => openEditModal(item)} 
                            className="p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/60 hover:text-blue-600 dark:hover:text-blue-300 transition-colors cursor-pointer" 
                            title="Edit Item"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button 
                            onClick={() => handleDeleteItem(item.id, item.name)} 
                            className="p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/60 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer" 
                            title="Delete Item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium">View-only</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* DUPLICATE INVENTORY RESOLUTION MODAL - LAPTOP ONLY */}
      {isLaptop && isDuplicateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-amber-500/10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400">
                  <Copy className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-base text-slate-900 dark:text-white">
                    Duplicate Ingredients Found ({duplicateSets.length})
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Review duplicate items, inspect recipe usage, and merge them safely with automatic pre-backup.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsDuplicateModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* List of Duplicate Sets */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {duplicateSets.map((set, setIdx) => (
                <div key={setIdx} className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50/50 dark:bg-slate-800/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-sm text-slate-900 dark:text-white uppercase tracking-wider">
                      Group: &quot;{set.normalizedName}&quot;
                    </span>
                    <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/60 px-2.5 py-0.5 rounded-full">
                      {1 + set.sources.length} duplicate records
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    {/* Target (Primary/Older) */}
                    <div className="p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-black text-emerald-800 dark:text-emerald-300">Target (Primary)</span>
                        <span className="text-[10px] font-bold font-mono text-emerald-600 dark:text-emerald-400">ID: {set.target.id.slice(0, 8)}...</span>
                      </div>
                      <div className="font-bold text-slate-800 dark:text-slate-100">{set.target.name}</div>
                      <div className="text-slate-600 dark:text-slate-300 mt-1">
                        Stock: <span className="font-black">{set.target.current_stock} {set.target.base_unit || set.target.unit}</span>
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                        Used in <strong className="text-slate-700 dark:text-slate-200">{set.target.recipeCount}</strong> recipes
                      </div>
                    </div>

                    {/* Source (Duplicate to merge) */}
                    {set.sources.map((src: any, sIdx: number) => (
                      <div key={sIdx} className="p-3 rounded-lg bg-red-50/50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-black text-red-800 dark:text-red-300">Duplicate (To Merge)</span>
                            <span className="text-[10px] font-bold font-mono text-red-600 dark:text-red-400">ID: {src.id.slice(0, 8)}...</span>
                          </div>
                          <div className="font-bold text-slate-800 dark:text-slate-100">{src.name}</div>
                          <div className="text-slate-600 dark:text-slate-300 mt-1">
                            Stock: <span className="font-black">{src.current_stock} {src.base_unit || src.unit}</span>
                          </div>
                          <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                            Used in <strong className="text-slate-700 dark:text-slate-200">{src.recipeCount}</strong> recipes
                          </div>
                        </div>

                        <button
                          onClick={() => handleMergeDuplicate(set.target, src)}
                          disabled={isMerging}
                          className="mt-3 w-full py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:scale-95 text-black font-black text-xs transition-all shadow-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                        >
                          <Layers className="w-3.5 h-3.5" />
                          <span>Merge into Primary</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex justify-between items-center text-xs">
              <span className="text-slate-500">Auto-backup created prior to every merge</span>
              <button
                onClick={() => setIsDuplicateModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

