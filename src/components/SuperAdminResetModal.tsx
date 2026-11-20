"use client";

import React, { useState } from "react";
import { X, ShieldAlert, KeyRound, CheckCircle2, Lock } from "lucide-react";
import { superAdminEmergencyReset, SUPER_ADMIN_PIN } from "@/lib/pin-system";
import { modal } from "@/lib/modalStore";

interface SuperAdminResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function SuperAdminResetModal({ isOpen, onClose, onSuccess }: SuperAdminResetModalProps) {
  const [superAdminKey, setSuperAdminKey] = useState("");
  const [newAdminPin, setNewAdminPin] = useState("7788");
  const [newCashierPin, setNewCashierPin] = useState("1234");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (superAdminKey.trim() !== SUPER_ADMIN_PIN) {
      setErrorMsg("Invalid Super Admin Key. Emergency override rejected.");
      return;
    }

    if (newAdminPin && newAdminPin.length !== 4) {
      setErrorMsg("Admin PIN must be exactly 4 digits.");
      return;
    }

    if (newCashierPin && newCashierPin.length !== 4) {
      setErrorMsg("Cashier PIN must be exactly 4 digits.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await superAdminEmergencyReset(superAdminKey, newAdminPin, newCashierPin);
      if (res.success) {
        modal.toast.success("Emergency override successful! Lockouts cleared and PINs updated.");
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMsg(res.message);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to execute emergency reset.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-red-100 dark:border-red-950/60 flex items-center justify-between bg-red-500/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-500/20 text-red-600 dark:text-red-400 flex items-center justify-center">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-red-700 dark:text-red-300">
                Super Admin Emergency Reset
              </h3>
              <p className="text-[11px] text-slate-400">Master override to recover access &amp; reset PINs</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleReset} className="p-5 space-y-4 overflow-y-auto flex-1">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-xs font-bold text-red-600 dark:text-red-400">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
              Super Admin Key (Emergency PIN)
            </label>
            <input
              type="password"
              value={superAdminKey}
              onChange={(e) => setSuperAdminKey(e.target.value)}
              placeholder="Enter 6-digit emergency key"
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-center tracking-widest text-lg font-black outline-none focus:border-red-500 text-slate-900 dark:text-slate-100"
            />
            <span className="text-[10px] text-slate-400 mt-1 block">Default Super Admin Key: 888888</span>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <span className="text-xs font-black text-slate-700 dark:text-slate-300 block">
              Set New Credentials (Optional)
            </span>

            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                New Admin Master PIN (4 digits)
              </label>
              <input
                type="text"
                maxLength={4}
                value={newAdminPin}
                onChange={(e) => setNewAdminPin(e.target.value.replace(/\D/g, ""))}
                placeholder="7788"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-center tracking-widest text-base font-bold outline-none focus:border-blue-500 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider block mb-1">
                New Default Cashier PIN (4 digits)
              </label>
              <input
                type="text"
                maxLength={4}
                value={newCashierPin}
                onChange={(e) => setNewCashierPin(e.target.value.replace(/\D/g, ""))}
                placeholder="1234"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono text-center tracking-widest text-base font-bold outline-none focus:border-blue-500 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="pt-3">
            <button
              type="submit"
              disabled={isSubmitting || !superAdminKey}
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-black text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isSubmitting ? "Overriding & Resetting..." : "Execute Emergency Override"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
