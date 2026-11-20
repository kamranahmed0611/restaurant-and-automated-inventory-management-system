"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Lock, Unlock, Delete, AlertCircle, ShieldCheck, Check } from "lucide-react";
import { 
  verifyCashierPin, 
  DEFAULT_CASHIER_PIN, 
  getLockoutStatus, 
  recordFailedAttempt, 
  resetLockout 
} from "@/lib/pin-system";
import { db, LocalCashier } from "@/lib/db";
import { usePosStore } from "@/lib/store";
import { MuchachosSymbol } from "./MuchachosBrand";
import SuperAdminResetModal from "./SuperAdminResetModal";

interface CashierPinModalProps {
  isOpen: boolean;
  onSuccess?: () => void;
}

export default function CashierPinModal({ isOpen, onSuccess }: CashierPinModalProps) {
  const { unlockRegister, activeCashier } = usePosStore();
  const [pin, setPin] = useState<string>("");
  const [selectedCashier, setSelectedCashier] = useState<LocalCashier | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [isSuperResetOpen, setIsSuperResetOpen] = useState(false);

  // Initialize cashiers from local Dexie IndexedDB
  useEffect(() => {
    let isMounted = true;
    async function loadCashiers() {
      try {
        const list = await db.cashiers.toArray();
        if (isMounted && list.length > 0 && !selectedCashier) {
          setSelectedCashier(list[0]);
        }
      } catch {}
    }
    if (isOpen) {
      loadCashiers();
      setPin("");
      setErrorMsg(null);
      setIsSuccess(false);

      const status = getLockoutStatus();
      if (status.isLocked) {
        setLockoutSeconds(status.remainingSeconds);
      } else {
        setLockoutSeconds(0);
      }
    }
    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Lockout countdown
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          resetLockout();
          setErrorMsg(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  const handleVerify = useCallback(async (pinToVerify: string) => {
    if (isVerifying || isSuccess || lockoutSeconds > 0) return;
    setIsVerifying(true);
    setErrorMsg(null);

    try {
      const cashier = await verifyCashierPin(pinToVerify);
      if (cashier) {
        setIsSuccess(true);
        resetLockout();
        setTimeout(() => {
          unlockRegister({
            id: cashier.id,
            name: cashier.name,
            role: cashier.role
          });
          if (onSuccess) onSuccess();
          setIsVerifying(false);
        }, 300);
      } else {
        setIsShaking(true);
        const fail = recordFailedAttempt();
        if (fail.isLocked) {
          setLockoutSeconds(fail.remainingSeconds);
          setErrorMsg(`Locked out for ${fail.remainingSeconds}s.`);
        } else {
          setErrorMsg(`Incorrect PIN. ${fail.attemptsRemaining} attempts remaining.`);
        }
        setTimeout(() => {
          setIsShaking(false);
          setPin("");
          setIsVerifying(false);
        }, 600);
      }
    } catch (err) {
      setIsShaking(true);
      setErrorMsg("Verification error. Please try again.");
      setTimeout(() => {
        setIsShaking(false);
        setPin("");
        setIsVerifying(false);
      }, 600);
    }
  }, [isVerifying, isSuccess, lockoutSeconds, unlockRegister, onSuccess]);

  const handleDigitPress = (digit: string) => {
    if (isVerifying || isSuccess || lockoutSeconds > 0) return;
    setErrorMsg(null);
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        handleVerify(newPin);
      }
    }
  };

  const handleBackspace = () => {
    if (isVerifying || isSuccess || lockoutSeconds > 0) return;
    setErrorMsg(null);
    setPin(prev => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (isVerifying || isSuccess || lockoutSeconds > 0) return;
    setErrorMsg(null);
    setPin("");
  };

  // Keyboard navigation & physical numpad listener
  useEffect(() => {
    if (!isOpen || lockoutSeconds > 0 || isSuperResetOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleDigitPress(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape' || e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleClear();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, pin, isVerifying, isSuccess, lockoutSeconds, isSuperResetOpen]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
        <div 
          className={`w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl p-6 sm:p-8 flex flex-col items-center transition-all ${
            isShaking ? 'animate-bounce' : ''
          }`}
        >
          {/* Muchachos Brand & Header */}
          <div className="flex flex-col items-center text-center mb-6">
            <div className="relative mb-3">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-[#B3121E] to-[#E11D2A] flex items-center justify-center shadow-lg shadow-red-500/25">
                <MuchachosSymbol className="w-9 h-9 text-amber-300 drop-shadow-sm" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-center border-2 border-white dark:border-slate-900 shadow-xs">
                {isSuccess ? (
                  <Unlock className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Lock className="w-3 h-3 text-amber-400" />
                )}
              </div>
            </div>

            <h2 className="text-xl font-black tracking-tight text-slate-900 dark:text-white uppercase">
              Muchachos Register
            </h2>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">
              Enter 4-Digit Cashier PIN to Unlock Terminal
            </p>

            {/* Active Cashier Identifier */}
            <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-[11px] font-bold text-slate-700 dark:text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>Terminal: {selectedCashier?.name || activeCashier?.name || "Counter Cashier"}</span>
            </div>
          </div>

          {/* Lockout Screen vs 4-PIN Dot Indicators */}
          {lockoutSeconds > 0 ? (
            <div className="my-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-center w-full">
              <p className="text-xs font-bold text-red-500">Terminal Locked</p>
              <p className="text-[11px] text-red-400 mt-0.5">Please wait: {lockoutSeconds}s</p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-4 my-3">
              {[0, 1, 2, 3].map(index => {
                const hasDigit = pin.length > index;
                return (
                  <div
                    key={index}
                    className={`w-4 h-4 rounded-full transition-all duration-200 ${
                      isSuccess
                        ? 'bg-emerald-500 scale-125 shadow-md shadow-emerald-500/50'
                        : hasDigit
                        ? 'bg-[#E11D2A] scale-110 shadow-md shadow-red-500/40 ring-4 ring-red-500/20'
                        : 'border-2 border-slate-300 dark:border-slate-700 bg-transparent'
                    }`}
                  />
                );
              })}
            </div>
          )}

          {/* Error or Hint Alert */}
          <div className="h-6 flex items-center justify-center my-1 text-center">
            {errorMsg ? (
              <span className="text-[11px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1 animate-in fade-in">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {errorMsg}
              </span>
            ) : isSuccess ? (
              <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 animate-in fade-in">
                <Check className="w-3.5 h-3.5" /> Terminal Unlocked!
              </span>
            ) : (
              <span className="text-[10px] text-slate-400 font-medium">
                Default cashier PIN: <strong className="text-slate-600 dark:text-slate-300 font-black">{DEFAULT_CASHIER_PIN}</strong>
              </span>
            )}
          </div>

          {/* Numeric Keypad */}
          <div className="w-full grid grid-cols-3 gap-2.5 sm:gap-3 mt-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => (
              <button
                key={num}
                type="button"
                onClick={() => handleDigitPress(num.toString())}
                disabled={isVerifying || isSuccess || lockoutSeconds > 0}
                className="h-14 sm:h-15 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-slate-900 dark:text-white text-2xl font-black transition-all active:scale-95 flex items-center justify-center shadow-2xs border border-slate-200/50 dark:border-slate-700/50 cursor-pointer disabled:opacity-50"
              >
                {num}
              </button>
            ))}

            <button
              type="button"
              onClick={handleClear}
              disabled={isVerifying || isSuccess || pin.length === 0 || lockoutSeconds > 0}
              className="h-14 sm:h-15 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-black transition-all active:scale-95 flex items-center justify-center border border-slate-200/50 dark:border-slate-700/50 cursor-pointer disabled:opacity-40"
              title="Clear"
            >
              CLEAR
            </button>

            <button
              type="button"
              onClick={() => handleDigitPress("0")}
              disabled={isVerifying || isSuccess || lockoutSeconds > 0}
              className="h-14 sm:h-15 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-slate-900 dark:text-white text-2xl font-black transition-all active:scale-95 flex items-center justify-center shadow-2xs border border-slate-200/50 dark:border-slate-700/50 cursor-pointer disabled:opacity-50"
            >
              0
            </button>

            <button
              type="button"
              onClick={handleBackspace}
              disabled={isVerifying || isSuccess || pin.length === 0 || lockoutSeconds > 0}
              className="h-14 sm:h-15 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/70 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-sm font-black transition-all active:scale-95 flex items-center justify-center border border-slate-200/50 dark:border-slate-700/50 cursor-pointer disabled:opacity-40"
              title="Backspace"
            >
              <Delete className="w-5 h-5" />
            </button>
          </div>

          {/* Reset PIN Link */}
          <div className="mt-4 flex justify-center">
            <button
              onClick={() => setIsSuperResetOpen(true)}
              className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline"
            >
              Forgot PIN? Emergency Reset (Super Admin)
            </button>
          </div>

          {/* Offline Security Footer Notice */}
          <div className="mt-4 flex items-center justify-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>100% Offline Auth (0ms Local DB)</span>
          </div>
        </div>
      </div>

      {/* Emergency Reset Modal */}
      {isSuperResetOpen && (
        <SuperAdminResetModal
          isOpen={isSuperResetOpen}
          onClose={() => setIsSuperResetOpen(false)}
          onSuccess={() => {
            setLockoutSeconds(0);
            setErrorMsg(null);
          }}
        />
      )}
    </>
  );
}