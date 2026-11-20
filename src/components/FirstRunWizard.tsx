"use client";

import React, { useState } from "react";
import {
  CheckCircle2, ChevronRight, Loader2, ShieldCheck,
  User, Star, ArrowRight
} from "lucide-react";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { hashPin, setAdminPin } from "@/lib/pin-system";

interface FirstRunWizardProps {
  onComplete: () => void;
}

type WizardStep = "WELCOME" | "ADMIN_PIN" | "FIRST_CASHIER" | "DONE";

export default function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const [step, setStep] = useState<WizardStep>("WELCOME");
  const [adminPin, setAdminPinState] = useState("");
  const [adminPinConfirm, setAdminPinConfirm] = useState("");
  const [cashierName, setCashierName] = useState("");
  const [cashierPin, setCashierPin] = useState("");
  const [cashierPinConfirm, setCashierPinConfirm] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = () => setError(null);

  // ──────────────────────────── STEP HANDLERS ────────────────────────────

  const handleSetAdminPin = async () => {
    clearError();
    if (adminPin.length < 4) return setError("Admin PIN must be at least 4 digits.");
    if (adminPin !== adminPinConfirm) return setError("PINs do not match.");
    setIsBusy(true);
    try {
      await setAdminPin(adminPin);
      setStep("FIRST_CASHIER");
    } catch (e: any) {
      setError("Failed to save Admin PIN: " + e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleCreateCashier = async () => {
    clearError();
    if (!cashierName.trim()) return setError("Enter the cashier's name.");
    if (cashierPin.length < 4) return setError("Cashier PIN must be at least 4 digits.");
    if (cashierPin !== cashierPinConfirm) return setError("PINs do not match.");
    setIsBusy(true);
    try {
      const pin_hash = await hashPin(cashierPin);
      await db.cashiers.add({
        id: uuidv4(),
        name: cashierName.trim(),
        role: "CASHIER",
        pin_hash,
        created_at: new Date().toISOString(),
      });
      setStep("DONE");
    } catch (e: any) {
      setError("Failed to create cashier: " + e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleFinish = () => {
    localStorage.setItem("muchachos_wizard_done", "1");
    onComplete();
  };

  // ──────────────────────────── RENDER ───────────────────────────────────

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-8 pb-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900/50 flex items-center justify-center mx-auto mb-4">
            <Star className="w-7 h-7 text-[#E11D2A]" />
          </div>
          <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            Welcome to Muchachos POS
          </h1>
          <p className="text-sm text-slate-500 mt-1">First-run setup — takes under 2 minutes.</p>
          {/* Progress dots */}
          <div className="flex items-center justify-center gap-1.5 mt-4">
            {(["WELCOME", "ADMIN_PIN", "FIRST_CASHIER", "DONE"] as WizardStep[]).map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  step === s
                    ? "w-6 bg-[#E11D2A]"
                    : ["ADMIN_PIN", "FIRST_CASHIER", "DONE"].indexOf(s) <=
                      ["ADMIN_PIN", "FIRST_CASHIER", "DONE"].indexOf(step)
                    ? "w-3 bg-[#E11D2A]/40"
                    : "w-3 bg-slate-200 dark:bg-slate-700"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Step Body */}
        <div className="px-6 pb-8 space-y-4">
          {/* ── WELCOME ── */}
          {step === "WELCOME" && (
            <>
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-sm text-slate-600 dark:text-slate-300 space-y-2">
                <p className="font-bold text-slate-800 dark:text-white">Before you begin:</p>
                <ul className="space-y-1.5 text-xs list-none">
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> Set your <strong>Admin PIN</strong> — used to unlock admin panel &amp; reports</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> Create your <strong>first cashier</strong> with a 4-digit PIN to open shifts</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" /> <strong>100% Offline Local Mode</strong> — All data stored on this machine</li>
                </ul>
              </div>
              <button
                onClick={() => setStep("ADMIN_PIN")}
                className="w-full py-3 rounded-2xl bg-[#E11D2A] hover:bg-[#c81824] text-white font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                Get Started <ChevronRight className="w-4 h-4" />
              </button>
            </>
          )}

          {/* ── ADMIN PIN ── */}
          {step === "ADMIN_PIN" && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck className="w-5 h-5 text-[#E11D2A]" />
                <h2 className="font-black text-slate-800 dark:text-white text-base">Set Admin PIN</h2>
              </div>
              <p className="text-xs text-slate-500">This PIN opens the Admin panel. Keep it secure (minimum 4 digits).</p>

              <form onSubmit={(e) => { e.preventDefault(); handleSetAdminPin(); }} className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 block">New Admin PIN (4–6 digits)</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoFocus
                      maxLength={6}
                      value={adminPin}
                      onChange={(e) => { setAdminPinState(e.target.value.replace(/\D/g, "")); clearError(); }}
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-lg tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[#E11D2A]"
                      placeholder="••••"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 block">Confirm Admin PIN</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={adminPinConfirm}
                      onChange={(e) => { setAdminPinConfirm(e.target.value.replace(/\D/g, "")); clearError(); }}
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-lg tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[#E11D2A]"
                      placeholder="••••"
                    />
                  </div>
                </div>

                {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}

                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full py-3 rounded-2xl bg-[#E11D2A] hover:bg-[#c81824] text-white font-black text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><CheckCircle2 className="w-4 h-4" /> Save Admin PIN &amp; Continue</>}
                </button>
              </form>
            </>
          )}

          {/* ── FIRST CASHIER ── */}
          {step === "FIRST_CASHIER" && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <User className="w-5 h-5 text-[#E11D2A]" />
                <h2 className="font-black text-slate-800 dark:text-white text-base">Create First Cashier</h2>
              </div>
              <p className="text-xs text-slate-500">This is the person who will log into the POS. You can add more cashiers from the Admin panel later.</p>

              <form onSubmit={(e) => { e.preventDefault(); handleCreateCashier(); }} className="space-y-4">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 block">Cashier Name</label>
                    <input
                      type="text"
                      autoFocus
                      value={cashierName}
                      onChange={(e) => { setCashierName(e.target.value); clearError(); }}
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#E11D2A]"
                      placeholder="e.g. Ahmed"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 block">Cashier PIN (4 digits)</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={cashierPin}
                      onChange={(e) => { setCashierPin(e.target.value.replace(/\D/g, "")); clearError(); }}
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-lg tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[#E11D2A]"
                      placeholder="••••"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 dark:text-slate-300 mb-1 block">Confirm Cashier PIN</label>
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={4}
                      value={cashierPinConfirm}
                      onChange={(e) => { setCashierPinConfirm(e.target.value.replace(/\D/g, "")); clearError(); }}
                      className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white font-mono text-lg tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-[#E11D2A]"
                      placeholder="••••"
                    />
                  </div>
                </div>

                {error && <p className="text-xs text-red-500 font-semibold">{error}</p>}

                <button
                  type="submit"
                  disabled={isBusy}
                  className="w-full py-3 rounded-2xl bg-[#E11D2A] hover:bg-[#c81824] text-white font-black text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><User className="w-4 h-4" /> Create Cashier &amp; Continue</>}
                </button>
              </form>
            </>
          )}



          {/* ── DONE ── */}
          {step === "DONE" && (
            <>
              <div className="text-center py-4">
                <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto mb-3" />
                <h2 className="font-black text-xl text-slate-900 dark:text-white">Setup Complete!</h2>
                <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
                  Your Admin PIN is set, your first cashier is created. Start a shift and take orders.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs text-slate-500 space-y-1">
                <p>📌 <strong>Add more menu items</strong> from the Admin panel (Settings icon).</p>
                <p>📌 <strong>Add more cashiers</strong> in Admin → Manage Staff.</p>
                <p>📌 <strong>Sync to phone</strong> from Admin → Sync when connected.</p>
              </div>
              <button
                onClick={handleFinish}
                className="w-full py-3 rounded-2xl bg-[#E11D2A] hover:bg-[#c81824] text-white font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-95"
              >
                <Star className="w-4 h-4" /> Open Muchachos POS
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
