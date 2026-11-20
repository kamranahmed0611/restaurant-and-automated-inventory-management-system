"use client";

import dynamic from "next/dynamic";

const KdsView = dynamic(() => import("@/components/KdsView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-slate-950 text-white">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="font-bold text-sm tracking-widest text-slate-400 uppercase">Loading Kitchen Display...</p>
      </div>
    </div>
  ),
});

export default function KDS() {
  return <KdsView />;
}