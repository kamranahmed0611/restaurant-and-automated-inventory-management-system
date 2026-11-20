"use client";

import React, { useState, useEffect } from "react";
import { Lock, Delete, AlertCircle, ArrowLeft, KeyRound, ShieldAlert } from "lucide-react";
import { 
  verifyAdminPin, 
  getLockoutStatus, 
  recordFailedAttempt, 
  resetLockout, 
  isAdminUnlocked,
  setAdminUnlocked
} from "@/lib/pin-system";
import SuperAdminResetModal from "./SuperAdminResetModal";

interface AdminMasterPinModalProps {
  isOpen: boolean;
  onSuccess: () => void;
  onCancel?: () => void;
}

export default function AdminMasterPinModal({ isOpen, onSuccess, onCancel }: AdminMasterPinModalProps) {
  const [pin, setPin] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [isSuperResetOpen, setIsSuperResetOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    if (isAdminUnlocked()) {
      onSuccess();
      return;
    }

    const status = getLockoutStatus();
    if (status.isLocked) {
      setLockoutSeconds(status.remainingSeconds);
    } else {
      setLockoutSeconds(0);
    }

    setPin("");
    setErrorMsg(null);
  }, [isOpen, onSuccess]);

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const interval = setInterval(() => {
      setLockoutSeconds(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setErrorMsg(null);
          resetLockout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSeconds]);

  // Physical keyboard and numpad event listener
  useEffect(() => {
    if (!isOpen || isSuperResetOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleKeyPress(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape' || e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleClear();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (pin.length >= 4) {
          handleAutoVerify(pin);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSuperResetOpen, pin, lockoutSeconds, isVerifying]);

  const handleKeyPress = (num: string) => {
    if (lockoutSeconds > 0 || isVerifying) return;
    if (pin.length < 6) {
      const nextPin = pin + num;
      setPin(nextPin);
      setErrorMsg(null);

      if (nextPin.length === 4) {
        verifyAdminPin(nextPin).then(ok => {
          if (ok) {
            setAdminUnlocked(true);
            onSuccess();
          } else if (nextPin !== '8888') {
            triggerError("Incorrect Admin PIN.");
          }
        });
      } else if (nextPin.length === 6) {
        handleAutoVerify(nextPin);
      }
    }
  };

  const handleAutoVerify = async (pinToTest: string) => {
    setIsVerifying(true);
    try {
      const ok = await verifyAdminPin(pinToTest);
      if (ok) {
        setAdminUnlocked(true);
        onSuccess();
      } else {
        const failureResult = recordFailedAttempt();
        if (failureResult.isLocked) {
          setLockoutSeconds(failureResult.remainingSeconds);
          triggerError(`Too many failed attempts. Locked for ${failureResult.remainingSeconds}s.`);
        } else {
          triggerError(`Incorrect PIN. Please try again.`);
        }
      }
    } catch {
      triggerError("Verification failed. Please retry.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleBackspace = () => {
    if (lockoutSeconds > 0 || isVerifying) return;
    setPin(prev => prev.slice(0, -1));
    setErrorMsg(null);
  };

  const handleClear = () => {
    if (lockoutSeconds > 0 || isVerifying) return;
    setPin("");
    setErrorMsg(null);
  };

  const triggerError = (msg: string) => {
    setErrorMsg(msg);
    setIsShaking(true);
    setPin("");
    setTimeout(() => setIsShaking(false), 500);
  };

  const formatLockoutTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/85 backdrop-blur-md p-4 animate-in fade-in duration-200">
        <div 
          className={`bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-sm shadow-2xl p-6 flex flex-col items-center relative text-white ${
            isShaking ? "animate-shake" : ""
          }`}
        >
          {/* Security Shield Icon */}
          <div className="w-14 h-14 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-3">
            {lockoutSeconds > 0 ? (
              <Lock className="w-7 h-7 text-red-400" />
            ) : (
              <KeyRound className="w-7 h-7 text-blue-400" />
            )}
          </div>

          <h2 className="text-lg font-black tracking-wide text-white">Owner Portal Security</h2>
          <p className="text-xs text-slate-400 mt-0.5 text-center">
            Enter 4-digit Admin PIN to access management tools
          </p>

          {/* Lockout Warning or PIN Dots */}
          {lockoutSeconds > 0 ? (
            <div className="mt-5 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-center w-full">
              <p className="text-xs font-bold text-red-400">Terminal Locked</p>
              <p className="text-[11px] text-red-300/80 mt-1">
                5 failed attempts. Please wait:
              </p>
              <p className="text-xl font-mono font-black text-red-400 mt-1">
                {formatLockoutTime(lockoutSeconds)}
              </p>
            </div>
          ) : (
            <>
              {/* PIN Dots Visualizer */}
              <div className="flex gap-3 my-5">
                {Array.from({ length: Math.max(4, pin.length) }).map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
                      idx < pin.length
                        ? "bg-blue-500 border-blue-400 scale-110 shadow-lg shadow-blue-500/40"
                        : "border-slate-700 bg-slate-800/50"
                    }`}
                  />
                ))}
              </div>

              {/* Error Message */}
              {errorMsg && (
                <div className="mb-3 text-xs font-bold text-red-400 flex items-center gap-1.5 text-center">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Keypad */}
              <div className="grid grid-cols-3 gap-2.5 w-full">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(n => (
                  <button
                    key={n}
                    onClick={() => handleKeyPress(n)}
                    className="h-12 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-blue-600 text-lg font-bold text-white transition-all shadow-sm active:scale-95"
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={handleClear}
                  className="h-12 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-xs font-bold text-slate-400 transition-colors uppercase tracking-wider"
                >
                  Clear
                </button>
                <button
                  onClick={() => handleKeyPress("0")}
                  className="h-12 rounded-xl bg-slate-800/80 hover:bg-slate-700 active:bg-blue-600 text-lg font-bold text-white transition-all shadow-sm active:scale-95"
                >
                  0
                </button>
                <button
                  onClick={handleBackspace}
                  className="h-12 rounded-xl bg-slate-800/40 hover:bg-slate-800 text-slate-300 flex items-center justify-center transition-colors"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>
            </>
          )}

          {/* Reset PIN Link */}
          <div className="mt-4 w-full flex justify-center">
            <button
              onClick={() => setIsSuperResetOpen(true)}
              className="text-[11px] font-semibold text-amber-400/90 hover:text-amber-300 underline underline-offset-2 transition-colors"
            >
              Forgot PIN? Emergency Reset (Super Admin)
            </button>
          </div>

          {/* Footer: Return to POS */}
          <div className="mt-4 w-full pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs">
            <button
              onClick={() => {
                if (onCancel) onCancel();
                else window.location.href = "/pos";
              }}
              className="text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors py-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> Return to Cashier POS
            </button>
            <span className="text-[10px] text-slate-500 font-mono">
              100% Offline Auth
            </span>
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
            setPin("");
            setAdminUnlocked(true);
            setIsSuperResetOpen(false);
            onSuccess();
          }}
        />
      )}
    </>
  );
}

