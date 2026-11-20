"use client";

import React, { useState, useEffect } from "react";
import { 
  X, Database, RefreshCw, CheckCircle2, AlertTriangle, Clock,
  Wifi, WifiOff, ShieldAlert, Loader2, ArrowRight
} from "lucide-react";
import { 
  getSyncDiagnostics, 
  performFullUploadSync, 
  resetCircuitBreaker,
  SyncProgressStep 
} from "@/lib/sync-engine";
import { posBus } from "@/lib/broadcast-bus";
import { modal } from "@/lib/modalStore";

interface SyncDiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type StepStatus = 'pending' | 'running' | 'done' | 'error';

interface StepDef {
  key: SyncProgressStep;
  title: string;
  subtitle: string;
}

const FLOW_STEPS: StepDef[] = [
  { key: 'CHECKING_WIFI', title: 'Checking Wi-Fi', subtitle: 'Checking network interface and ping reachability' },
  { key: 'CONNECTING', title: 'Connecting to Cloud', subtitle: 'Authenticating & establishing Supabase session' },
  { key: 'SYNCING_SHIFTS', title: 'Uploading Shifts', subtitle: 'Uploading closed shifts first for relational integrity' },
  { key: 'SYNCING_ORDERS', title: 'Uploading Orders', subtitle: 'Uploading orders, items, and payments' },
  { key: 'SYNCING_EXPENSES', title: 'Uploading Expenses', subtitle: 'Syncing cash drawer expense entries' },
  { key: 'SYNCING_INVENTORY', title: 'Uploading Inventory', subtitle: 'Syncing deduction logs and stock snapshot' },
  { key: 'SYNCING_MENU', title: 'Uploading Menu & Recipes', subtitle: 'Syncing menu items, categories, and recipe specs' },
  { key: 'UPDATING_META', title: 'Updating Sync Meta', subtitle: 'Writing sync timestamp for phone dashboard view' },
];

export default function SyncDiagnosticsModal({ isOpen, onClose }: SyncDiagnosticsModalProps) {
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [activeStep, setActiveStep] = useState<SyncProgressStep | null>(null);
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>({});
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchDiagnostics = async () => {
    try {
      const data = await getSyncDiagnostics();
      setDiagnostics(data);
    } catch (err) {
      console.warn("Failed to fetch sync diagnostics", err);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDiagnostics();
      setSyncResult(null);
      setActiveStep(null);
      setStepStatuses({});
    }

    const unsub = posBus.subscribe('DIAGNOSTICS_REFRESH', () => {
      if (isOpen) fetchDiagnostics();
    });

    return () => {
      unsub();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const totalPending = diagnostics
    ? (diagnostics.pendingOrders || 0) +
      (diagnostics.pendingShifts || 0) +
      (diagnostics.pendingInventory || 0) +
      (diagnostics.pendingMenuItems || 0) +
      (diagnostics.pendingExpenses || 0) +
      (diagnostics.pendingRecipes || 0)
    : 0;

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    const initialStatuses: Record<string, StepStatus> = {};
    FLOW_STEPS.forEach(s => { initialStatuses[s.key] = 'pending'; });
    setStepStatuses(initialStatuses);

    try {
      const res = await performFullUploadSync((stepKey: SyncProgressStep, detail?: string) => {
        setActiveStep(stepKey);
        setStepStatuses(prev => {
          const next = { ...prev };
          const stepIndex = FLOW_STEPS.findIndex(s => s.key === stepKey);
          FLOW_STEPS.forEach((s, idx) => {
            if (idx < stepIndex) {
              next[s.key] = 'done';
            } else if (idx === stepIndex) {
              next[s.key] = 'running';
            }
          });
          return next;
        });
      });

      if (res.success) {
        setStepStatuses(prev => {
          const next = { ...prev };
          FLOW_STEPS.forEach(s => { next[s.key] = 'done'; });
          return next;
        });
        setSyncResult({ success: true, message: res.message });
        modal.toast.success(res.message);
      } else {
        setStepStatuses(prev => {
          const next = { ...prev };
          if (activeStep) {
            next[activeStep] = 'error';
          }
          return next;
        });
        setSyncResult({ success: false, message: res.message });
        modal.toast.warning(res.message);
      }
      await fetchDiagnostics();
    } catch (err: any) {
      if (activeStep) {
        setStepStatuses(prev => ({ ...prev, [activeStep]: 'error' }));
      }
      setSyncResult({ success: false, message: err?.message || "Sync failed due to an unexpected error." });
      modal.toast.error("Sync failed: " + (err?.message || "Network error"));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleResetCircuitBreaker = () => {
    resetCircuitBreaker();
    modal.toast.success("Circuit breaker reset. Reconnection enabled.");
    fetchDiagnostics();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-950/60 text-[#E11D2A] flex items-center justify-center border border-red-200 dark:border-red-900/40">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-800 dark:text-white">Sync Flow &amp; Queue Diagnostics</h3>
              <p className="text-[11px] text-slate-400">Step-by-step ordered upload to Supabase cloud mirror</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
          {/* Status Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">Network State</span>
              <div className="flex items-center gap-1.5 mt-1.5">
                {diagnostics?.explicitOffline ? (
                  <>
                    <WifiOff className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-black text-amber-600 dark:text-amber-400">Explicit Offline</span>
                  </>
                ) : diagnostics?.isOnline ? (
                  <>
                    <Wifi className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">Connected</span>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-black text-red-600 dark:text-red-400">No Connection</span>
                  </>
                )}
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider block">Circuit Breaker</span>
              <div className="flex items-center gap-1.5 mt-1.5">
                {diagnostics?.circuitBreakerActive ? (
                  <>
                    <ShieldAlert className="w-4 h-4 text-amber-500" />
                    <span className="text-xs font-black text-amber-600 dark:text-amber-400">Tripped (Cooldown)</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">Active / Ready</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Step-by-Step Flow Status */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <ArrowRight className="w-3.5 h-3.5 text-[#E11D2A]" /> Ordered Sync Pipeline
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                {isSyncing ? "Running..." : "Idle"}
              </span>
            </div>

            <div className="space-y-2">
              {FLOW_STEPS.map((step, idx) => {
                const status = stepStatuses[step.key] || 'pending';
                return (
                  <div 
                    key={step.key} 
                    className={`flex items-start gap-3 p-2.5 rounded-xl border transition-all ${
                      status === 'running'
                        ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-300 dark:border-blue-700 shadow-xs'
                        : status === 'done'
                        ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                        : status === 'error'
                        ? 'bg-red-50/70 dark:bg-red-950/40 border-red-300 dark:border-red-800'
                        : 'bg-white/60 dark:bg-slate-900/60 border-slate-200/60 dark:border-slate-800 opacity-70'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {status === 'running' && <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />}
                      {status === 'done' && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      {status === 'error' && <AlertTriangle className="w-4 h-4 text-red-500" />}
                      {status === 'pending' && (
                        <div className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 flex items-center justify-center text-[9px] font-bold text-slate-400">
                          {idx + 1}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className={`text-xs font-bold ${
                          status === 'running' ? 'text-blue-700 dark:text-blue-300 font-black' :
                          status === 'done' ? 'text-emerald-700 dark:text-emerald-400' :
                          status === 'error' ? 'text-red-600 dark:text-red-400' :
                          'text-slate-700 dark:text-slate-300'
                        }`}>
                          {step.title}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400 capitalize">
                          {status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {step.subtitle}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {syncResult && (
              <div className={`p-3 rounded-xl border text-xs font-semibold ${
                syncResult.success 
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300' 
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
              }`}>
                {syncResult.message}
              </div>
            )}
          </div>

          {/* Pending Queue Breakdown */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">
                Unsynced Records in Local Dexie
              </span>
              <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                totalPending > 0 
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300' 
                  : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
              }`}>
                {totalPending} Total Pending
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block">Orders</span>
                <span className="font-black text-sm text-slate-800 dark:text-slate-100">{diagnostics?.pendingOrders || 0}</span>
              </div>
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block">Shifts</span>
                <span className="font-black text-sm text-slate-800 dark:text-slate-100">{diagnostics?.pendingShifts || 0}</span>
              </div>
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block">Inventory</span>
                <span className="font-black text-sm text-slate-800 dark:text-slate-100">{diagnostics?.pendingInventory || 0}</span>
              </div>
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block">Menu Items</span>
                <span className="font-black text-sm text-slate-800 dark:text-slate-100">{diagnostics?.pendingMenuItems || 0}</span>
              </div>
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block">Expenses</span>
                <span className="font-black text-sm text-slate-800 dark:text-slate-100">{diagnostics?.pendingExpenses || 0}</span>
              </div>
              <div className="p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800">
                <span className="text-[10px] text-slate-400 block">Recipes</span>
                <span className="font-black text-sm text-slate-800 dark:text-slate-100">{diagnostics?.pendingRecipes || 0}</span>
              </div>
            </div>
          </div>

          {/* Sync History / Errors */}
          {diagnostics?.lastError && (
            <div className="p-3.5 rounded-2xl bg-red-50/80 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-black text-red-700 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Last Sync Error (Table: {diagnostics.lastError.table})</span>
              </div>
              <p className="text-xs text-red-600 dark:text-red-300 font-mono">
                {diagnostics.lastError.message}
              </p>
            </div>
          )}

          {diagnostics?.lastSuccessAt && (
            <div className="text-[11px] text-slate-400 flex items-center justify-between px-1">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Last successful cloud upload:
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-300">
                {new Date(diagnostics.lastSuccessAt).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex items-center gap-2.5 shrink-0">
          {diagnostics?.circuitBreakerActive && (
            <button
              onClick={handleResetCircuitBreaker}
              className="py-2.5 px-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold text-xs hover:bg-amber-100 transition-colors cursor-pointer"
            >
              Reset Circuit Breaker
            </button>
          )}

          <button
            onClick={handleManualSync}
            disabled={isSyncing}
            className="flex-1 py-2.5 px-4 rounded-xl bg-[#E11D2A] hover:bg-[#c81824] active:scale-95 text-white font-black text-xs transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{isSyncing ? "Running Ordered Sync Pipeline..." : "Execute Step-by-Step Sync Now"}</span>
          </button>

          <button
            onClick={onClose}
            className="py-2.5 px-4 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
