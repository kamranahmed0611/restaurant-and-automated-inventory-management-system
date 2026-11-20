"use client";

import React, { useState, useEffect } from "react";
import { 
  X, KeyRound, Shield, CheckCircle2, RefreshCw, Plus, 
  Lock, User, AlertCircle, Save 
} from "lucide-react";
import { db, LocalCashier } from "@/lib/db";
import { DEFAULT_CASHIER_PIN } from "@/lib/auth-local";
import { posBus } from "@/lib/broadcast-bus";
import { SUPER_ADMIN_PIN } from "@/lib/pin-system";

interface AdminCashierSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminCashierSettingsModal({ isOpen, onClose }: AdminCashierSettingsModalProps) {
  const [cashiers, setCashiers] = useState<LocalCashier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCashier, setSelectedCashier] = useState<LocalCashier | null>(null);
  
  // PIN change state
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // New cashier creation state
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<'CASHIER' | 'MANAGER'>('CASHIER');
  const [initialPin, setInitialPin] = useState("");

  const loadCashiers = async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const local = await db.cashiers.toArray();
      if (local.length === 0) {
        const defaultCashier = {
          id: 'default-cashier',
          name: 'Head Cashier',
          pin: '1234',
          pin_hash: '1234',
          role: 'CASHIER' as const,
          sync_status: 'PENDING'
        };
        await db.cashiers.put(defaultCashier as any);
        setCashiers([defaultCashier as any]);
        setSelectedCashier(defaultCashier as any);
      } else {
        setCashiers(local);
        if (!selectedCashier) setSelectedCashier(local[0]);
      }
    } catch (err: any) {
      console.error("Failed to load cashiers:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadCashiers();
      setNewPin("");
      setConfirmPin("");
      setSuccessMsg(null);
      setErrorMsg(null);
      setShowAddForm(false);
    }
  }, [isOpen]);

  // Super Admin Authorization Key
  const [superAdminKey, setSuperAdminKey] = useState("");

  const handleUpdatePin = async () => {
    if (!selectedCashier) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    // Super Admin Verification
    if (superAdminKey.trim() !== SUPER_ADMIN_PIN) {
      setErrorMsg("Super Admin Authorization Key (888888) is required to edit PINs.");
      return;
    }

    // Validation
    const cleanPin = newPin.trim();
    if (!/^\d{4}$/.test(cleanPin)) {
      setErrorMsg("PIN must be exactly 4 digits (0-9).");
      return;
    }
    if (cleanPin !== confirmPin.trim()) {
      setErrorMsg("PIN confirmation does not match.");
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date().toISOString();

      const updatedRecord: LocalCashier = {
        id: selectedCashier.id,
        name: selectedCashier.name,
        pin: cleanPin,
        pin_hash: cleanPin,
        role: selectedCashier.role,
        created_at: selectedCashier.created_at || now,
        sync_status: 'PENDING'
      };

      // Update in local Dexie database
      await db.cashiers.put(updatedRecord);

      // Broadcast immediate PIN update across all active local tabs/windows
      posBus.publish('CASHIER_PIN_UPDATED', { cashierId: updatedRecord.id });

      // Update local UI state
      setCashiers(prev => prev.map(c => c.id === updatedRecord.id ? updatedRecord : c));
      setSelectedCashier(updatedRecord);
      setNewPin("");
      setConfirmPin("");
      setSuperAdminKey("");
      setSuccessMsg(`PIN for "${updatedRecord.name}" successfully updated!`);

      setTimeout(() => {
        setSuccessMsg(null);
      }, 5000);
    } catch (err: any) {
      console.error("PIN update error:", err);
      setErrorMsg(err.message || "Failed to update PIN. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateCashier = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (superAdminKey.trim() !== SUPER_ADMIN_PIN) {
      setErrorMsg("Super Admin Authorization Key (888888) is required to create a cashier.");
      return;
    }

    const name = newName.trim();
    const pin = initialPin.trim();

    if (!name) {
      setErrorMsg("Please enter a cashier name.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setErrorMsg("Initial PIN must be exactly 4 digits (0-9).");
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      const newCashier: LocalCashier = {
        id: `cashier-${Date.now()}`,
        name,
        pin: pin,
        pin_hash: pin,
        role: newRole,
        created_at: now,
        sync_status: 'PENDING'
      };

      // Save to local Dexie
      await db.cashiers.put(newCashier);

      setCashiers(prev => [...prev, newCashier]);
      setSelectedCashier(newCashier);
      setShowAddForm(false);
      setNewName("");
      setInitialPin("");
      setSuperAdminKey("");
      setSuccessMsg(`Created cashier "${name}"! PIN: ${pin}`);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to create cashier.");
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in select-none">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center p-2 shadow-xs shrink-0 border border-amber-200 dark:border-amber-800">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-white">
                Cashier PIN Management
              </h2>
              <p className="text-xs text-slate-400">
                Change counter unlock PINs &bull; Auto-syncs to cloud &amp; counter
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
          {successMsg && (
            <div className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 flex items-center gap-3 text-emerald-800 dark:text-emerald-300 text-xs font-bold animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 flex items-center gap-3 text-red-800 dark:text-red-300 text-xs font-bold animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Cashier Selector */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider">
                Select Counter Cashier
              </label>
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>{showAddForm ? "Cancel Add" : "New Cashier"}</span>
              </button>
            </div>

            {/* List of Cashiers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {cashiers.map((c) => {
                const isSelected = selectedCashier?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      setSelectedCashier(c);
                      setNewPin("");
                      setConfirmPin("");
                      setErrorMsg(null);
                      setSuccessMsg(null);
                    }}
                    className={`flex items-center justify-between p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "border-amber-500 bg-amber-50/40 dark:bg-amber-950/30 shadow-xs"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 bg-white dark:bg-slate-800/60"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        isSelected 
                          ? "bg-amber-500 text-white" 
                          : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400"
                      }`}>
                        <User className="w-4 h-4" />
                      </div>
                      <div className="truncate">
                        <p className="font-black text-xs text-slate-800 dark:text-white truncate">
                          {c.name}
                        </p>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                          {c.role}
                        </span>
                      </div>
                    </div>
                    {isSelected && (
                      <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Add New Cashier Form */}
          {showAddForm && (
            <div className="p-4 rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/30 dark:bg-blue-950/20 space-y-3 animate-in fade-in">
              <h4 className="text-xs font-black text-blue-900 dark:text-blue-300 uppercase tracking-wider">
                Create New Counter User
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Cashier Name</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Evening Shift"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold text-slate-800 dark:text-white outline-hidden focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">4-Digit Initial PIN</label>
                  <input
                    type="password"
                    maxLength={4}
                    value={initialPin}
                    onChange={(e) => setInitialPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="4 digits (e.g. 5678)"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono font-bold tracking-widest text-slate-800 dark:text-white outline-hidden focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-red-500 tracking-wider block mb-1">
                  Super Admin Authorization Key (888888)
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={superAdminKey}
                  onChange={(e) => setSuperAdminKey(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter 888888 to authorize"
                  className="w-full px-3 py-2 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-800 text-xs font-mono font-bold tracking-widest text-slate-800 dark:text-white outline-hidden focus:border-red-500"
                />
              </div>
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleCreateCashier}
                  disabled={isSaving || superAdminKey.length < 6}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Create Cashier"}
                </button>
              </div>
            </div>
          )}

          {/* Change PIN Form */}
          {selectedCashier && (
            <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Change PIN for: <span className="text-amber-600 dark:text-amber-400">{selectedCashier.name}</span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Enter a new 4-digit numeric code to unlock the counter register.
                  </p>
                </div>
                <Lock className="w-4 h-4 text-slate-400" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    New 4-Digit PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-center font-mono font-black text-lg tracking-[0.4em] outline-hidden focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                    Confirm PIN
                  </label>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={4}
                    value={confirmPin}
                    onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ""))}
                    placeholder="••••"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-center font-mono font-black text-lg tracking-[0.4em] outline-hidden focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-red-500 tracking-wider block mb-1">
                  Super Admin Authorization Key (888888)
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={superAdminKey}
                  onChange={(e) => setSuperAdminKey(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter 888888 to authorize change"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-center font-mono font-black text-sm tracking-widest outline-hidden focus:border-red-500 transition-colors"
                />
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  Default factory PIN: <code className="font-mono font-bold text-slate-600 dark:text-slate-300">1234</code>
                </span>
                <button
                  onClick={handleUpdatePin}
                  disabled={isSaving || newPin.length !== 4 || confirmPin.length !== 4 || superAdminKey.length < 6}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-black text-xs shadow-md transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save &amp; Apply PIN</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Sync Information Footer */}
          <div className="p-3.5 rounded-2xl bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 flex items-start gap-2.5 text-[11px] text-slate-500 dark:text-slate-400">
            <Shield className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-slate-700 dark:text-slate-200">Local POS Security Policy:</span>
              <p className="mt-0.5 leading-relaxed">
                PIN changes require the Master Super Admin Key (<code>888888</code>). Once updated, the new PIN is immediately saved to the local Dexie database and broadcast to all counter screens and open windows.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
