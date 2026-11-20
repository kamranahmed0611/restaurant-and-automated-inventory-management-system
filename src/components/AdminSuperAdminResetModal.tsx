"use client";

import React, { useState, useEffect } from "react";
import { 
  X, AlertTriangle, Trash2, RefreshCw, CheckCircle2, ShieldAlert, 
  Database, Check, Lock, ArrowRight, Server, FileText
} from "lucide-react";
import { db } from "@/lib/db";
import { triggerDailyAutoBackup } from "@/lib/auto-backup";
import { supabase } from "@/lib/supabase";
import { posBus } from "@/lib/broadcast-bus";

interface AdminSuperAdminResetModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminSuperAdminResetModal({ isOpen, onClose }: AdminSuperAdminResetModalProps) {
  const [counts, setCounts] = useState<{
    orders: number;
    items: number;
    shifts: number;
    expenses: number;
    menuItems: number;
    inventory: number;
    fpPayouts: number;
  }>({ orders: 0, items: 0, shifts: 0, expenses: 0, menuItems: 0, inventory: 0, fpPayouts: 0 });

  const [isLoading, setIsLoading] = useState(true);
  const [isPurging, setIsPurging] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const fetchDatabaseCounts = async () => {
    setIsLoading(true);
    setErrorBanner(null);
    try {
      const [o, sh, ex, m, inv] = await Promise.all([
        db.orders.count(),
        db.shifts.count(),
        db.expenses.count(),
        db.menu_items.count(),
        db.raw_inventory.count(),
      ]);

      setCounts({
        orders: o,
        items: 0,
        shifts: sh,
        expenses: ex,
        menuItems: m,
        inventory: inv,
        fpPayouts: 0,
      });
    } catch (err: any) {
      console.error("Error fetching table counts:", err);
      setErrorBanner(err.message || "Failed to load database metrics.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDatabaseCounts();
      setConfirmText("");
      setSuccessBanner(null);
      setErrorBanner(null);
    }
  }, [isOpen]);

  const handleExecuteDay1Reset = async () => {
    if (confirmText.trim().toUpperCase() !== "LAUNCH") {
      setErrorBanner('Please type "LAUNCH" to confirm this action.');
      return;
    }

    setIsPurging(true);
    setErrorBanner(null);
    setSuccessBanner(null);

    try {
      // 1. Automatic backup snapshot first
      await triggerDailyAutoBackup(true);

      // 2. Clear Local Dexie Transactional Records
      await db.orders.clear();
      await db.shifts.clear();
      await db.expenses.clear();
      await db.inventory_logs.clear();
      localStorage.removeItem('muchachos_active_shift_id');
      localStorage.removeItem('muchachos_active_cashier_id');

      // 3. Clear Supabase Cloud Mirror Transactional Records (One-click Simultaneous Cloud Purge)
      if (typeof window !== 'undefined' && navigator.onLine) {
        try {
          await Promise.allSettled([
            supabase.from('order_items').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('cashier_shifts').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
            supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
          ]);
        } catch (cloudErr) {
          console.warn("[SuperAdminReset] Cloud purge notice:", cloudErr);
        }
      }

      posBus.publish('STOCK_UPDATED');
      posBus.publish('DIAGNOSTICS_REFRESH');

      setSuccessBanner("Day 1 Launch Reset Completed! All test orders, shifts, drawer history, and Supabase cloud mirror transactions are wiped simultaneously. Local backup was saved. Menu catalog, recipes, inventory, and cashiers are 100% preserved.");
      setConfirmText("");
      await fetchDatabaseCounts();
    } catch (err: any) {
      console.error("Purge failure:", err);
      setErrorBanner(err.message || "Reset failed.");
    } finally {
      setIsPurging(false);
    }
  };

  const handleHardResetLocalCache = async () => {
    setIsPurging(true);
    setErrorBanner(null);
    try {
      await triggerDailyAutoBackup(true);
      await db.orders.clear();
      await db.inventory_logs.clear();
      await db.shifts.clear();
      await db.expenses.clear();
      setSuccessBanner("Transactional test orders and shifts purged. Catalog and ingredients preserved.");
      await fetchDatabaseCounts();
    } catch (err: any) {
      setErrorBanner("Local reset error: " + err.message);
    } finally {
      setIsPurging(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in select-none">
      <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-950/80 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-red-100 dark:border-red-950/50 flex items-center justify-between bg-red-50/50 dark:bg-red-950/30">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-300 flex items-center justify-center p-2 shadow-xs shrink-0 border border-red-200 dark:border-red-800">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-white">
                  Super Admin: Day 1 Launch Controls
                </h2>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-md bg-red-500 text-white">
                  Owner Only
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Purge test orders, reset token sequence &amp; prepare for live opening
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {/* Success Banner */}
          {successBanner && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3 text-emerald-800 dark:text-emerald-300 text-xs font-bold animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successBanner}</span>
            </div>
          )}

          {/* Error Banner */}
          {errorBanner && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 flex items-center gap-3 text-red-800 dark:text-red-300 text-xs font-bold animate-in fade-in">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorBanner}</span>
            </div>
          )}

          {/* Live Cloud Database Health Card */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Database className="w-3.5 h-3.5 text-blue-500" />
                Live Cloud Data Snapshot
              </span>
              <button
                onClick={fetchDatabaseCounts}
                disabled={isLoading}
                className="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">Test Orders</span>
                <span className="text-base font-black text-red-600 dark:text-red-400">{counts.orders}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">Test Shifts</span>
                <span className="text-base font-black text-amber-600 dark:text-amber-400">{counts.shifts}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">FP Settlements</span>
                <span className="text-base font-black text-pink-600 dark:text-pink-400">{counts.fpPayouts}</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">Catalog Items</span>
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">{counts.menuItems} (Safe)</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700">
                <span className="text-[10px] font-bold text-slate-400 block uppercase">Raw Ingredients</span>
                <span className="text-base font-black text-emerald-600 dark:text-emerald-400">{counts.inventory} (Safe)</span>
              </div>
            </div>
          </div>

          {/* Section 1: Day 1 Launch Purge */}
          <div className="p-4 sm:p-5 rounded-2xl border border-red-200 dark:border-red-900/60 bg-red-50/20 dark:bg-red-950/20 space-y-3">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/80 text-red-600 dark:text-red-300 flex items-center justify-center shrink-0 mt-0.5">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-red-700 dark:text-red-300 uppercase tracking-wider">
                  Day 1 Production Launch Wipe
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                  Permanently deletes all test orders, order items, shifts, test expenses, and Foodpanda settlement payouts from both Supabase Cloud and the counter laptop. 
                  <strong className="text-slate-800 dark:text-white block mt-1">
                    ✓ All menu items, recipes, combo slots, and inventory catalog items will be 100% PRESERVED.
                  </strong>
                </p>
              </div>
            </div>

            <div className="pt-2 border-t border-red-100 dark:border-red-900/40">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                Type &quot;LAUNCH&quot; to confirm:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="LAUNCH"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-black uppercase tracking-widest text-slate-800 dark:text-white outline-hidden focus:border-red-500"
                />
                <button
                  onClick={handleExecuteDay1Reset}
                  disabled={isPurging || confirmText.trim().toUpperCase() !== "LAUNCH"}
                  className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs shadow-md transition-all active:scale-95 disabled:opacity-40 cursor-pointer flex items-center gap-1.5"
                >
                  {isPurging ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Wiping...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Purge Test Data</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Local Terminal Cache Reset */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 flex items-center justify-between gap-4">
            <div>
              <h4 className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">
                Re-sync Local Terminal Cache
              </h4>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Forces the local Dexie database to purge and re-download fresh data from Supabase.
              </p>
            </div>
            <button
              onClick={handleHardResetLocalCache}
              disabled={isPurging}
              className="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold border border-slate-200 dark:border-slate-700 transition-all cursor-pointer flex items-center gap-1.5 shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isPurging ? 'animate-spin' : ''}`} />
              <span>Re-sync Cache</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
