"use client";

import React, { useState, useEffect } from "react";
import { X, AlertTriangle } from "lucide-react";
import { modal } from "@/lib/modalStore";
import { MuchachosSymbol } from "./MuchachosBrand";
import { db } from "@/lib/db";
import { posBus } from "@/lib/broadcast-bus";
import { v4 as uuidv4 } from "uuid";
import { syncOfflineExpenses, syncOfflineInventoryLogs } from "@/lib/sync-engine";
import { usePosStore } from "@/lib/store";

interface SpoilageModalProps {
  onClose: () => void;
}

export default function SpoilageModal({ onClose }: SpoilageModalProps) {
  const activeCashier = usePosStore((s) => s.activeCashier);
  const [inventory, setInventory] = useState<any[]>([]);
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState('');
  const [quantity, setQuantity] = useState<number | ''>('');
  const [reason, setReason] = useState('Dropped / Spilled');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const REASONS = [
    'Dropped / Spilled',
    'Burned / Overcooked',
    'Customer Return / Remake',
    'Expired / Spoiled',
    'Other'
  ];

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      // 100% Local Dexie (0ms local-first)
      const [localInv, localMenu, localRecipes] = await Promise.all([
        db.raw_inventory.orderBy('name').toArray(),
        db.menu_items.orderBy('name').toArray(),
        db.recipes.toArray()
      ]);

      setInventory(localInv || []);
      setMenuItems(localMenu || []);
      setRecipes(localRecipes || []);

      if (localMenu && localMenu.length > 0 && !selectedItem) {
        setSelectedItem(`menu_${localMenu[0].id}`);
      } else if (localInv && localInv.length > 0 && !selectedItem) {
        setSelectedItem(`raw_${localInv[0].id}`);
      }
    } catch (err) {
      console.warn("[SpoilageModal] Local Dexie load error:", err);
    }
  };

  const handleSubmit = async () => {
    if (!selectedItem || !quantity || Number(quantity) <= 0) {
      return modal.warning("Incomplete Form", "Valid item and positive quantity are required.");
    }
    setIsSubmitting(true);
    
    try {
      const isMenu = selectedItem.startsWith('menu_');
      const actualId = selectedItem.replace('menu_', '').replace('raw_', '');
      const qty = Number(quantity);

      let totalLossCost = 0;
      const activeShiftId = (typeof window !== 'undefined' ? localStorage.getItem('muchachos_active_shift_id') : null) || undefined;

      if (isMenu) {
        const menuItem = menuItems.find(m => m.id === actualId);
        const itemName = menuItem?.name || 'Menu Item';
        const matchingRecipes = recipes.filter(r => r.menu_item_id === actualId);

        if (matchingRecipes.length > 0) {
          for (const rec of matchingRecipes) {
            const needed = Number(rec.quantity_deducted || 1) * qty;
            const raw = await db.raw_inventory.get(rec.inventory_item_id);
            if (raw) {
              const newStock = Number(raw.current_stock || 0) - needed;
              await db.raw_inventory.update(raw.id, { current_stock: newStock, sync_status: 'PENDING' });
              const cost = Number(raw.cost_per_unit || 0) * needed;
              totalLossCost += cost;

              await db.inventory_logs.put({
                id: uuidv4(),
                inventory_item_id: raw.id,
                change_qty: -needed,
                change_type: 'SPOILAGE',
                reason: `Waste: ${itemName} x ${qty} (${reason})`,
                created_at: new Date().toISOString(),
                sync_status: 'PENDING'
              });
            }
          }
        } else {
          // Direct retail item without recipes
          const directRaw = inventory.find(i => 
            i.id === actualId || 
            (menuItem?.name && i.name && i.name.trim().toLowerCase() === menuItem.name.trim().toLowerCase())
          );
          if (directRaw) {
            const newStock = Number(directRaw.current_stock || 0) - qty;
            await db.raw_inventory.update(directRaw.id, { current_stock: newStock, sync_status: 'PENDING' });
            const cost = Number(directRaw.cost_per_unit || 0) * qty;
            totalLossCost += cost;

            await db.inventory_logs.put({
              id: uuidv4(),
              inventory_item_id: directRaw.id,
              change_qty: -qty,
              change_type: 'SPOILAGE',
              reason: `Waste: ${itemName} x ${qty} (${reason})`,
              created_at: new Date().toISOString(),
              sync_status: 'PENDING'
            });
          } else {
            totalLossCost += Number(menuItem?.cost_price || 0) * qty;
          }
        }

        // Log waste loss to store expenses ledger
        if (totalLossCost > 0) {
          await db.expenses.put({
            id: uuidv4(),
            category: 'Waste / Spoilage',
            logged_by: activeCashier?.name || 'Staff',
            amount: Math.round(totalLossCost),
            description: `Spoilage: ${itemName} x ${qty} (${reason})`,
            shift_id: activeShiftId,
            created_at: new Date().toISOString(),
            sync_status: 'PENDING'
          });
        }
      } else {
        // Direct raw ingredient wasted
        const raw = await db.raw_inventory.get(actualId);
        if (raw) {
          const newStock = Number(raw.current_stock || 0) - qty;
          await db.raw_inventory.update(raw.id, { current_stock: newStock, sync_status: 'PENDING' });
          totalLossCost = Number(raw.cost_per_unit || 0) * qty;

          await db.inventory_logs.put({
            id: uuidv4(),
            inventory_item_id: raw.id,
            change_qty: -qty,
            change_type: 'SPOILAGE',
            reason: `Waste: ${raw.name} x ${qty} (${reason})`,
            created_at: new Date().toISOString(),
            sync_status: 'PENDING'
          });

          if (totalLossCost > 0) {
            await db.expenses.put({
              id: uuidv4(),
              category: 'Waste / Spoilage',
              logged_by: activeCashier?.name || 'Staff',
              amount: Math.round(totalLossCost),
              description: `Spoilage: ${raw.name} x ${qty} (${reason})`,
              shift_id: activeShiftId,
              created_at: new Date().toISOString(),
              sync_status: 'PENDING'
            });
          }
        }
      }

      posBus.publish('STOCK_UPDATED');
      posBus.publish('EXPENSE_LOGGED');

      if (typeof window !== 'undefined' && navigator.onLine) {
        syncOfflineInventoryLogs().catch(() => {});
        syncOfflineExpenses().catch(() => {});
      }

      modal.success(
        "Waste Logged", 
        `Waste of ${qty} recorded. Inventory decremented and Rs. ${Math.round(totalLossCost).toLocaleString()} logged in loss ledger.`
      );
      onClose();
    } catch (err: any) {
      console.error("Failed to log spoilage:", err);
      modal.error("Waste Logging Failed", err?.message || "Failed to record spoilage in local database.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isMenuSelected = selectedItem.startsWith('menu_');
  const activeRawItem = !isMenuSelected ? inventory.find(i => `raw_${i.id}` === selectedItem) : null;
  const unitLabel = isMenuSelected ? 'Order(s)' : (activeRawItem?.unit || 'Unit');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xs animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-red-500/20">
        <div className="flex items-center justify-between p-5 border-b border-slate-100 dark:border-slate-800 bg-red-50/50 dark:bg-red-950/20">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#E11D2A] text-white flex items-center justify-center p-1.5 shadow-xs">
              <MuchachosSymbol size={22} color="#FFFFFF" />
            </div>
            <div>
              <h3 className="font-black text-base text-slate-800 dark:text-slate-100 leading-tight">Log Waste / Spoilage</h3>
              <p className="text-[10px] font-serif italic text-red-500">An Oasis Of Taste</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"><X className="w-5 h-5"/></button>
        </div>
        
        <div className="p-6 space-y-5">
          <div>
            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Item Wasted</label>
            <select value={selectedItem} onChange={e => setSelectedItem(e.target.value)} className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold bg-transparent outline-none focus:border-red-500">
              <optgroup label="Finished Menu Items (e.g. Dropped an entire burger)">
                {menuItems.map(item => (
                  <option key={`menu_${item.id}`} value={`menu_${item.id}`} className="dark:bg-slate-800 font-bold">{item.name}</option>
                ))}
              </optgroup>
              <optgroup label="Raw Ingredients (e.g. Dropped a single bun)">
                {inventory.map(item => (
                  <option key={`raw_${item.id}`} value={`raw_${item.id}`} className="dark:bg-slate-800 text-slate-500">{item.name} ({item.current_stock} {item.unit || 'units'} in stock)</option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Quantity</label>
              <div className="relative mt-1">
                <input type="number" min="0.1" step="any" value={quantity} onChange={e => setQuantity(Number(e.target.value))} className="w-full border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-lg font-black bg-transparent outline-none focus:border-red-500" placeholder="0" />
                <span className="absolute right-3 top-4 text-xs font-bold text-slate-400">{unitLabel}</span>
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Reason</label>
              <select value={reason} onChange={e => setReason(e.target.value)} className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3.5 text-sm font-bold bg-transparent outline-none focus:border-red-500">
                {REASONS.map(r => <option key={r} value={r} className="dark:bg-slate-800">{r}</option>)}
              </select>
            </div>
          </div>
          
          <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl border border-slate-100 dark:border-slate-800">
             <p className="text-xs font-bold text-slate-600 dark:text-slate-300 text-center leading-relaxed">
               {isMenuSelected 
                 ? "The local engine will read this item's recipe from Dexie and automatically deduct all underlying raw ingredients!" 
                 : "This raw ingredient will be directly deducted from live stock and logged in the waste ledger."}
             </p>
          </div>
        </div>

        <div className="p-5 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
          <button onClick={onClose} className="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer">CANCEL</button>
          <button onClick={handleSubmit} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white font-black tracking-widest uppercase py-3 px-8 rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-2 cursor-pointer">
            <AlertTriangle className="w-4 h-4"/> CONFIRM WASTE
          </button>
        </div>
      </div>
    </div>
  );
}
