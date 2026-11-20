"use client";

import React from "react";
import { Mail, Phone } from "lucide-react";

interface TeddopsBrandingProps {
  variant?: 'compact' | 'card' | 'badge';
  className?: string;
}

export default function TeddopsBranding({ variant = 'compact', className = '' }: TeddopsBrandingProps) {
  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500 select-none whitespace-nowrap ${className}`}>
        <img
          src="/images/teddops-logo.jpg"
          alt="Teddops"
          className="w-4 h-4 rounded-md object-contain border border-slate-300 dark:border-slate-700 shadow-2xs shrink-0"
        />
        <span>
          Made by <strong className="text-slate-700 dark:text-slate-300 font-bold">Engr. Maryam &amp; Kamran</strong> &bull; <strong className="text-amber-700 dark:text-amber-400 font-extrabold tracking-wide">TEDDOPS</strong>
        </span>
      </div>
    );
  }

  if (variant === 'badge') {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 shadow-sm ${className}`}>
        <img
          src="/images/teddops-logo.jpg"
          alt="Teddops"
          className="w-5 h-5 rounded-md object-contain border border-slate-700 shadow-2xs shrink-0"
        />
        <div className="flex flex-col text-left">
          <span className="text-[10px] font-black text-white leading-tight tracking-wider">
            TEDDOPS
          </span>
          <span className="text-[9px] font-medium text-slate-400">
            Engr. Maryam &amp; Kamran
          </span>
        </div>
      </div>
    );
  }

  // Full detailed executive card
  return (
    <div className={`p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col gap-3.5 select-none ${className}`}>
      <div className="flex items-center gap-3">
        <img
          src="/images/teddops-logo.jpg"
          alt="Teddops Logo"
          className="w-12 h-12 rounded-xl object-contain border border-slate-200 dark:border-slate-700 p-0.5 bg-white dark:bg-slate-800 shadow-2xs shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-sm text-slate-900 dark:text-white tracking-wide">
              TEDDOPS
            </span>
            <span className="text-[9px] font-black px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 uppercase tracking-wider">
              Official Partner
            </span>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 leading-snug">
            Engineered &amp; Developed by <strong className="text-slate-800 dark:text-slate-200 font-bold">Engr. Maryam &amp; Kamran</strong>
          </p>

        </div>
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex-wrap">
        <a 
          href="tel:+923297267098" 
          className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-200 hover:text-emerald-700 dark:hover:text-emerald-300 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 text-xs font-bold transition-all shadow-2xs whitespace-nowrap"
          title="Direct Phone / WhatsApp Support"
        >
          <Phone className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span>+92 329 7267098</span>
        </a>
        <a 
          href="tel:+923235930559" 
          className="flex-1 min-w-[140px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-slate-700 dark:text-slate-200 hover:text-emerald-700 dark:hover:text-emerald-300 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 text-xs font-bold transition-all shadow-2xs whitespace-nowrap"
          title="Direct Phone / WhatsApp Support"
        >
          <Phone className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span>+92 323 5930559</span>
        </a>
        <a 
          href="mailto:teddopss@gmail.com" 
          className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 hover:bg-red-50 dark:hover:bg-red-950/40 text-slate-700 dark:text-slate-200 hover:text-red-700 dark:hover:text-red-300 border border-slate-200 dark:border-slate-700 hover:border-red-300 text-xs font-bold transition-all shadow-2xs whitespace-nowrap"
          title="Official Technical Email"
        >
          <Mail className="w-3.5 h-3.5 text-red-500 shrink-0" />
          <span>teddopss@gmail.com</span>
        </a>
      </div>
    </div>
  );
}
