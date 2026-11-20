"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { isLaptopWriter } from "@/lib/device-mode";
import { modal } from "@/lib/modalStore";

const PosLayout = dynamic(() => import("@/components/PosLayout"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="font-bold text-sm tracking-widest text-slate-300 uppercase">Loading Muchachos POS...</p>
      </div>
    </div>
  ),
});

export default function PosPage() {
  const router = useRouter();

  useEffect(() => {
    if (!isLaptopWriter()) {
      modal.toast.warning("POS Register is exclusive to the physical counter laptop.");
      router.replace("/admin");
    }
  }, [router]);

  if (!isLaptopWriter()) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-4 text-center px-4">
          <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="font-bold text-sm text-slate-200">Redirecting to Owner Portal...</p>
          <p className="text-xs text-slate-400">Cashier Register is counter-only.</p>
        </div>
      </div>
    );
  }

  return <PosLayout />;
}

