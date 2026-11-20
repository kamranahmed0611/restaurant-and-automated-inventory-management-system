"use client";

import React, { useEffect, useRef } from "react";
import { 
  CheckCircle2, AlertTriangle, AlertCircle, Info, 
  HelpCircle, X, Sparkles 
} from "lucide-react";
import { useModalStore, ModalType } from "@/lib/modalStore";

export default function GlobalModalContainer() {
  const { dialog, closeDialog, toasts, removeToast } = useModalStore();
  const confirmBtnRef = useRef<HTMLButtonElement | null>(null);

  // Auto-focus confirm button and trap Escape key
  useEffect(() => {
    if (dialog.isOpen) {
      setTimeout(() => confirmBtnRef.current?.focus(), 50);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          closeDialog(false);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [dialog.isOpen, closeDialog]);

  // Determine icon & theme styling
  const renderIcon = (type: ModalType, isDanger: boolean) => {
    if (isDanger || type === "error") {
      return (
        <div className="w-12 h-12 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800/80 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0 shadow-xs">
          <AlertTriangle className="w-6 h-6 animate-pulse" />
        </div>
      );
    }
    if (type === "success") {
      return (
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/80 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 shadow-xs">
          <CheckCircle2 className="w-6 h-6" />
        </div>
      );
    }
    if (type === "warning") {
      return (
        <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0 shadow-xs">
          <AlertCircle className="w-6 h-6" />
        </div>
      );
    }
    if (type === "confirm") {
      return (
        <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800/80 flex items-center justify-center text-blue-600 dark:text-blue-400 shrink-0 shadow-xs">
          <HelpCircle className="w-6 h-6" />
        </div>
      );
    }
    return (
      <div className="w-12 h-12 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-300 shrink-0 shadow-xs">
        <Info className="w-6 h-6" />
      </div>
    );
  };

  return (
    <>
      {/* FLOATING TOAST NOTIFICATIONS */}
      <div className="fixed top-4 right-4 sm:right-6 z-[100000] pointer-events-none flex flex-col gap-2.5 max-w-sm w-full">
        {toasts.map((toast) => {
          const isError = toast.type === "error";
          const isSuccess = toast.type === "success";
          const isWarning = toast.type === "warning";

          return (
            <div
              key={toast.id}
              className={`pointer-events-auto rounded-2xl border p-4 shadow-xl backdrop-blur-md transition-all animate-in slide-in-from-top-3 fade-in duration-200 flex items-start gap-3 ${
                isError
                  ? "bg-rose-50/95 dark:bg-rose-950/90 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-100"
                  : isSuccess
                  ? "bg-emerald-50/95 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-100"
                  : isWarning
                  ? "bg-amber-50/95 dark:bg-amber-950/90 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100"
                  : "bg-white/95 dark:bg-slate-900/90 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100"
              }`}
            >
              <div className="shrink-0 mt-0.5">
                {isError && <AlertTriangle className="w-5 h-5 text-rose-600" />}
                {isSuccess && <CheckCircle2 className="w-5 h-5 text-emerald-600" />}
                {isWarning && <AlertCircle className="w-5 h-5 text-amber-600" />}
                {!isError && !isSuccess && !isWarning && <Info className="w-5 h-5 text-blue-600" />}
              </div>

              <div className="flex-1 min-w-0">
                {toast.title && (
                  <p className="text-xs font-black tracking-tight mb-0.5">{toast.title}</p>
                )}
                <p className="text-xs font-medium leading-relaxed opacity-90">{toast.message}</p>
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className="shrink-0 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-black/5 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* MODAL DIALOG BACKDROP & CONTAINER */}
      {dialog.isOpen && (
        <div 
          className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget && !dialog.cancelText) {
              closeDialog(false);
            }
          }}
        >
          <div 
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl shadow-slate-950/30 overflow-hidden animate-in zoom-in-95 duration-150 flex flex-col"
            role="alertdialog"
            aria-modal="true"
          >
            {/* Top Header Bar with Accent Indicator */}
            <div className={`h-1.5 w-full ${
              dialog.isDanger || dialog.type === 'error'
                ? 'bg-gradient-to-r from-rose-500 to-red-600'
                : dialog.type === 'success'
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500'
                : dialog.type === 'warning'
                ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600'
            }`} />

            <div className="p-6">
              <div className="flex items-start gap-4">
                {renderIcon(dialog.type, dialog.isDanger)}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight leading-snug">
                      {dialog.title}
                    </h3>
                    <button
                      onClick={() => closeDialog(false)}
                      className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Close"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Message Body with smart line-breaks and styled metrics */}
                  <div className="mt-3 text-xs sm:text-sm text-slate-600 dark:text-slate-300 font-medium leading-relaxed space-y-2">
                    {dialog.message.split("\n").map((line, idx) => {
                      if (!line.trim()) return null;

                      // Check if line contains a metric like "New Blended Cost: Rs. 30.59 / Pieces" or "Rs."
                      const hasCurrency = line.includes("Rs.") || line.includes("Cost:") || line.includes("Total:");
                      if (hasCurrency) {
                        return (
                          <div 
                            key={idx} 
                            className="bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/80 rounded-xl p-3 font-semibold text-slate-800 dark:text-slate-100 shadow-2xs flex items-center gap-2"
                          >
                            <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                            <span>{line}</span>
                          </div>
                        );
                      }

                      return <p key={idx}>{line}</p>;
                    })}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-6 flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100 dark:border-slate-800">
                {dialog.cancelText && (
                  <button
                    type="button"
                    onClick={() => closeDialog(false)}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-bold text-xs transition-all cursor-pointer active:scale-95 shadow-2xs"
                  >
                    {dialog.cancelText}
                  </button>
                )}

                <button
                  ref={confirmBtnRef}
                  type="button"
                  onClick={() => closeDialog(true)}
                  className={`px-5 py-2.5 rounded-xl text-white font-black text-xs transition-all cursor-pointer shadow-md active:scale-95 ${
                    dialog.isDanger || dialog.type === 'error'
                      ? 'bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-700 hover:to-red-700 shadow-rose-500/20'
                      : dialog.type === 'success'
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-emerald-500/20'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-blue-500/20'
                  }`}
                >
                  {dialog.confirmText}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
