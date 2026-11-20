"use client";

import React, { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { isLaptopWriter } from "@/lib/device-mode";

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

export default function Home() {
  const router = useRouter();
  const isAdminOnly = process.env.NEXT_PUBLIC_ADMIN_ONLY === 'true';

  useEffect(() => {
    if (isAdminOnly || !isLaptopWriter()) {
      router.replace('/admin');
    }
  }, [isAdminOnly, router]);

  if (isAdminOnly || !isLaptopWriter()) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="font-bold text-sm tracking-widest text-slate-300 uppercase">Opening Owner Portal...</p>
        </div>
      </div>
    );
  }

  return <PosLayout />;
}