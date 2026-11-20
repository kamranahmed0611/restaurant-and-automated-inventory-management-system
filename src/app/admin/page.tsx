"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  LayoutDashboard, ClipboardList, Package, ChefHat, BookOpen, 
  Settings, Sun, Moon, Laptop, Printer, Sparkles, X, CheckCircle2, Shield,
  LogOut, KeyRound, ShieldAlert, Tv, BarChart3, Store, Trash2, Database, RefreshCw
} from "lucide-react";
import { useTheme } from "next-themes";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import AdminOverview from "@/components/AdminOverview";
import AdminOrdersLiveLog from "@/components/AdminOrdersLiveLog";
import AdminInventory from "@/components/AdminInventory";
import AdminMenuBuilder from "@/components/AdminMenuBuilder";
import AdminExpenses from "@/components/AdminExpenses";
import AdminFinancialReports from "@/components/AdminFinancialReports";
import MuchachosBrand from "@/components/MuchachosBrand";
import AdminCashierSettingsModal from "@/components/AdminCashierSettingsModal";
import AdminSuperAdminResetModal from "@/components/AdminSuperAdminResetModal";
import AdminDatabaseBackupModal from "@/components/AdminDatabaseBackupModal";
import AdminMasterPinModal from "@/components/AdminMasterPinModal";
import ReceiptSettingsModal from "@/components/ReceiptSettingsModal";
import TeddopsBranding from "@/components/TeddopsBranding";
import { getKdsDisplayEnabled, setKdsDisplayEnabled } from "@/lib/kds-config";
import { isAdminUnlocked, setAdminUnlocked } from "@/lib/pin-system";
import { isLaptopWriter } from "@/lib/device-mode";
import { startAutoBackupTimer, triggerDailyAutoBackup } from "@/lib/auto-backup";
import { posBus } from "@/lib/broadcast-bus";
import { modal } from "@/lib/modalStore";
import { openAppRoute } from "@/lib/window-navigation";
import { adminCache } from "@/lib/admin-cache";

export type AdminTab = 'OVERVIEW' | 'ORDERS' | 'INVENTORY' | 'MENU' | 'EXPENSES' | 'REPORTS';

export default function AdminPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>('OVERVIEW');
  const [visitedTabs, setVisitedTabs] = useState<Set<AdminTab>>(() => new Set<AdminTab>(['OVERVIEW']));
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCashierSettingsOpen, setIsCashierSettingsOpen] = useState(false);
  const [isSuperAdminResetOpen, setIsSuperAdminResetOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [lastBackupInfo, setLastBackupInfo] = useState<{ time: string | null; status: string | null }>({ time: null, status: null });
  const [isMasterPinRequired, setIsMasterPinRequired] = useState(false);
  const [isReceiptSettingsOpen, setIsReceiptSettingsOpen] = useState(false);
  const [isKdsActive, setIsKdsActive] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [isPurgingCloud, setIsPurgingCloud] = useState(false);
  const [terminalHeartbeat, setTerminalHeartbeat] = useState<{ status: 'LIVE' | 'OFFLINE'; text: string }>({ status: 'LIVE', text: 'Live' });
  const { theme, setTheme, resolvedTheme } = useTheme();

  const handleSelectTab = (tab: AdminTab) => {
    setActiveTab(tab);
    setVisitedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
    posBus.publish('ADMIN_TAB_SELECTED', { tab });
  };

  useEffect(() => {
    setMounted(true);
    setIsKdsActive(getKdsDisplayEnabled());

    const laptop = isLaptopWriter();
    if (!laptop) {
      // Remote cloud / Vercel: verify Supabase Auth session
      supabase.auth.getSession().then(({ data }: any) => {
        if (!data?.session) {
          router.replace('/login?redirect=/admin');
        }
      }).catch(() => {
        router.replace('/login?redirect=/admin');
      });

      // Terminal Heartbeat probe on remote cloud (Q24: A)
      const checkHeartbeat = async () => {
        try {
          const { data, error } = await supabase
            .from('orders')
            .select('created_at')
            .order('created_at', { ascending: false })
            .limit(1);

          if (error || !data || data.length === 0) {
            setTerminalHeartbeat({ status: 'LIVE', text: 'Live' });
            return;
          }

          const latest = new Date(data[0].created_at).getTime();
          const diffMins = Math.floor((Date.now() - latest) / 60000);

          if (diffMins <= 30) {
            setTerminalHeartbeat({ status: 'LIVE', text: 'Live' });
          } else if (diffMins < 120) {
            setTerminalHeartbeat({ status: 'OFFLINE', text: `${diffMins}m ago` });
          } else {
            const hours = Math.floor(diffMins / 60);
            setTerminalHeartbeat({ status: 'OFFLINE', text: `${hours}h ago` });
          }
        } catch {
          setTerminalHeartbeat({ status: 'LIVE', text: 'Live' });
        }
      };

      checkHeartbeat();
      const hbInterval = setInterval(checkHeartbeat, 30000);

      return () => {
        clearInterval(hbInterval);
      };
    } else {
      // Local laptop: verify local PIN state immediately (0ms)
      if (!isAdminUnlocked()) {
        setIsMasterPinRequired(true);
      }
    }

    const stopBackupTimer = startAutoBackupTimer();
    const updateBackupInfo = () => {
      if (typeof window !== 'undefined') {
        setLastBackupInfo({
          time: localStorage.getItem('muchachos_last_backup_time'),
          status: localStorage.getItem('muchachos_last_backup_status')
        });
      }
    };
    updateBackupInfo();
    const backupPollInterval = setInterval(updateBackupInfo, 10000);

    return () => {
      stopBackupTimer();
      clearInterval(backupPollInterval);
    };
  }, [router]);

  const handleToggleKds = async () => {
    const next = !isKdsActive;
    setIsKdsActive(next);
    await setKdsDisplayEnabled(next);
  };

  const handleSignOut = async () => {
    if (!isLaptopWriter()) {
      await supabase.auth.signOut();
      router.replace('/login');
    } else {
      setAdminUnlocked(false);
      setIsMasterPinRequired(true);
      modal.toast.info("Admin panel locked.");
    }
  };

  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    adminCache.invalidate();
    posBus.publish('MANUAL_REFRESH');
    posBus.publish('DIAGNOSTICS_REFRESH');
    setRefreshTrigger(prev => prev + 1);
    modal.toast.success("Cloud mirror refreshed with latest database records.");
    setTimeout(() => {
      setIsRefreshing(false);
    }, 600);
  };

  const handlePurgeOldCloudOrders = async () => {
    const ok = await modal.confirm({
      title: "Purge Old Cloud History?",
      message: "This will delete synced orders older than 90 days from Supabase to free up cloud storage.\n\nNote: The physical laptop's local database (Dexie) will NOT be affected and retains 100% of historical data.",
      confirmText: "Purge Cloud History",
      isDanger: true
    });
    if (!ok) return;

    try {
      setIsPurgingCloud(true);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - 90);
      const isoCutoff = cutoffDate.toISOString();

      const { error } = await supabase
        .from('orders')
        .delete()
        .lt('created_at', isoCutoff);

      if (error) throw error;

      modal.toast.success("Old cloud orders purged from Supabase mirror.");
      handleManualRefresh();
    } catch (err: any) {
      modal.toast.error("Failed to purge cloud orders: " + (err.message || 'Unknown error'));
    } finally {
      setIsPurgingCloud(false);
    }
  };

  const handleCleanDeleteSupabase = async () => {
    const ok = await modal.confirm({
      title: "Clean Delete ALL Supabase Cloud Records?",
      message: "⚠️ Complete Cloud Wipe:\nThis will permanently delete ALL records from Supabase Cloud:\n• Orders & Order Items\n• Menu Items & Categories\n• Raw Inventory Ingredients & Recipes\n• Modifiers & Deal Components\n• Shifts, Expenses & Spoilage Logs\n\n🔒 Counter Data 100% Safe:\nYour physical counter laptop local database (Dexie) is completely untouched.\nAfter cleaning, click 'Push to Cloud' on the counter laptop to re-populate a fresh, clean cloud mirror.",
      confirmText: "Wipe All Cloud Records",
      isDanger: true
    });
    if (!ok) return;

    try {
      setIsPurgingCloud(true);
      // Delete in strict foreign key order (child tables first):
      await Promise.allSettled([
        supabase.from('order_items').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('deal_components').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('recipes').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('modifiers').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('spoilage_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('inventory_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      ]);

      await Promise.allSettled([
        supabase.from('orders').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('menu_items').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('expenses').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('foodpanda_payouts').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('cashier_shifts').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('shifts').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('sync_queue').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('sync_meta').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      ]);

      await Promise.allSettled([
        supabase.from('raw_inventory').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
        supabase.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      ]);

      modal.toast.success("All Supabase Cloud records wiped cleanly. Use 'Push to Cloud' on laptop to re-sync.");
      handleManualRefresh();
    } catch (err: any) {
      modal.toast.error("Failed to clean cloud records: " + (err.message || 'Unknown error'));
    } finally {
      setIsPurgingCloud(false);
    }
  };

  const navItems: { tab: AdminTab; label: string; shortLabel: string; icon: any }[] = [
    { tab: 'OVERVIEW', label: 'Overview', shortLabel: 'Overview', icon: LayoutDashboard },
    { tab: 'ORDERS', label: 'Orders & Kitchen', shortLabel: 'Orders', icon: ClipboardList },
    { tab: 'REPORTS', label: 'Reports & P&L', shortLabel: 'Reports', icon: BarChart3 },
    { tab: 'INVENTORY', label: 'Inventory', shortLabel: 'Stock', icon: Package },
    { tab: 'MENU', label: 'Menu & Recipes', shortLabel: 'Menu', icon: ChefHat },
    { tab: 'EXPENSES', label: 'Expenses', shortLabel: 'Expenses', icon: BookOpen }
  ];

  return (
    <div className="h-[100dvh] w-full max-w-full overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans flex flex-col transition-colors duration-200">
      {/* Top Navigation Bar - Permanent Executive Header with Safe Area Inset Top */}
      <header className="shrink-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-2.5 sm:px-4 lg:px-6 min-h-[3.75rem] h-auto pt-[max(0.625rem,env(safe-area-inset-top,0px))] pb-2 flex items-center justify-between gap-1.5 sm:gap-2 shadow-xs w-full max-w-full min-w-0">
        {/* Left: Brand Logo (Ultra-responsive on mobile) */}
        <div className="flex items-center shrink-0">
          <div className="sm:hidden">
            <MuchachosBrand size="xs" showTagline={false} />
          </div>
          <div className="hidden sm:block">
            <MuchachosBrand size="sm" subtitle={isLaptopWriter() ? "ADMIN PORTAL" : "CLOUD MIRROR"} />
          </div>
        </div>
        
        {/* Desktop Navigation Tabs (>= 1024px) */}
        <div className="hidden lg:flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl shrink min-w-0 overflow-x-auto no-scrollbar">
          {navItems.map(({ tab, label, icon: Icon }) => (
            <button
              key={tab}
              onClick={() => handleSelectTab(tab)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer shrink-0 ${
                activeTab === tab
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        {/* Header Right: Status, Theme, Controls, Logout (Guaranteed to fit without overflow) */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Laptop Mode Controls */}
          {isLaptopWriter() ? (
            <>
              {/* Last Backup Status Badge */}
              <button
                onClick={() => setIsBackupModalOpen(true)}
                className="hidden lg:flex items-center gap-1.5 px-2 py-1 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition-all cursor-pointer shadow-2xs active:scale-95 shrink-0"
                title="Database Backup Engine. Click to view or create backup."
              >
                <Database className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                <span className="hidden 2xl:inline text-slate-500 dark:text-slate-400">Backup:</span>
                <span className="text-[11px]">{lastBackupInfo.time ? lastBackupInfo.time : 'Scheduled'}</span>
                <span className={`text-[9px] px-1 py-0.2 rounded font-black ${
                  lastBackupInfo.status === 'SUCCESS'
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                    : lastBackupInfo.status === 'FAILED'
                      ? 'bg-red-500/15 text-red-700 dark:text-red-300 border border-red-500/20'
                      : 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border border-blue-500/20'
                }`}>
                  {lastBackupInfo.status || 'OK'}
                </span>
              </button>

              {/* POS Register Button (Laptop Counter Only) */}
              <button
                onClick={() => openAppRoute('pos')}
                className="h-8 px-2 sm:px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all shadow-2xs active:scale-95 cursor-pointer flex items-center justify-center gap-1 shrink-0"
                title="Return to Cashier POS Register"
              >
                <Store className="w-3.5 h-3.5 text-[#E11D2A]" />
                <span className="hidden sm:inline whitespace-nowrap font-bold">POS</span>
              </button>
            </>
          ) : (
            /* Cloud Mirror Mode Controls */
            <>
              {/* Discrete Counter Terminal Heartbeat Badge */}
              <div 
                className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-lg text-[9.5px] sm:text-[10.5px] font-bold border transition-all ${
                  terminalHeartbeat.status === 'LIVE'
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-500/20'
                    : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-500/20'
                }`}
                title="Physical laptop counter terminal live status"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${terminalHeartbeat.status === 'LIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                <span className="font-black">{terminalHeartbeat.text}</span>
              </div>

              {/* Manual Instant Cloud Pull / Refresh */}
              <button
                onClick={handleManualRefresh}
                className="h-8 w-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all flex items-center justify-center cursor-pointer shadow-2xs active:scale-95 shrink-0"
                title="Pull Latest Database Updates from Supabase"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-blue-600 dark:text-blue-400 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}

          {/* Quick One-Click Dark / Light Mode Toggle */}
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="h-8 w-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-center cursor-pointer shadow-2xs active:scale-95 shrink-0"
            title={`Switch to ${resolvedTheme === 'dark' ? 'Light' : 'Dark'} Mode`}
            aria-label="Toggle Dark/Light Mode"
          >
            {mounted && resolvedTheme === 'dark' ? (
              <Sun className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Moon className="w-3.5 h-3.5 text-slate-700 dark:text-slate-200" />
            )}
          </button>

          {/* Settings Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="h-8 w-8 sm:w-auto sm:px-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all shadow-2xs active:scale-95 cursor-pointer flex items-center justify-center gap-1 shrink-0"
            title="Owner Settings & Appearance"
          >
            <Settings className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
            <span className="hidden xl:inline whitespace-nowrap">Settings</span>
          </button>

          {/* Compact Log Out Button */}
          <button
            onClick={handleSignOut}
            className="h-8 w-8 sm:w-auto sm:px-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 rounded-xl text-xs font-black transition-all shadow-2xs active:scale-95 cursor-pointer flex items-center justify-center gap-1 shrink-0 whitespace-nowrap"
            title={isLaptopWriter() ? "Lock Admin" : "Sign Out"}
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline text-xs font-black whitespace-nowrap">
              {isLaptopWriter() ? "Lock Admin" : "Log Out"}
            </span>
          </button>
        </div>
      </header>

      {/* Main Content Area - Preserves Visited Tabs in DOM with bottom dock safe space on mobile */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-3 sm:p-5 md:p-7 pb-36 sm:pb-40 lg:pb-8 flex flex-col min-w-0 max-w-full overflow-y-auto overflow-x-hidden">
        {visitedTabs.has('OVERVIEW') && (
          <div className={activeTab === 'OVERVIEW' ? 'block animate-in fade-in duration-150 w-full max-w-full min-w-0 overflow-x-hidden' : 'hidden'}>
            <AdminOverview onNavigateTab={handleSelectTab} refreshTrigger={refreshTrigger} />
          </div>
        )}
        {visitedTabs.has('ORDERS') && (
          <div className={activeTab === 'ORDERS' ? 'block animate-in fade-in duration-150 w-full max-w-full min-w-0 overflow-x-hidden' : 'hidden'}>
            <AdminOrdersLiveLog refreshTrigger={refreshTrigger} />
          </div>
        )}
        {visitedTabs.has('REPORTS') && (
          <div className={activeTab === 'REPORTS' ? 'block animate-in fade-in duration-150 w-full max-w-full min-w-0 overflow-x-hidden' : 'hidden'}>
            <AdminFinancialReports isActive={activeTab === 'REPORTS'} refreshTrigger={refreshTrigger} />
          </div>
        )}
        {visitedTabs.has('INVENTORY') && (
          <div className={activeTab === 'INVENTORY' ? 'block animate-in fade-in duration-150 w-full max-w-full min-w-0 overflow-x-hidden' : 'hidden'}>
            <AdminInventory isActive={activeTab === 'INVENTORY'} refreshTrigger={refreshTrigger} />
          </div>
        )}
        {visitedTabs.has('MENU') && (
          <div className={activeTab === 'MENU' ? 'block animate-in fade-in duration-150 w-full max-w-full min-w-0 overflow-x-hidden' : 'hidden'}>
            <AdminMenuBuilder isActive={activeTab === 'MENU'} refreshTrigger={refreshTrigger} />
          </div>
        )}
        {visitedTabs.has('EXPENSES') && (
          <div className={activeTab === 'EXPENSES' ? 'block animate-in fade-in duration-150 w-full max-w-full min-w-0 overflow-x-hidden' : 'hidden'}>
            <AdminExpenses isActive={activeTab === 'EXPENSES'} refreshTrigger={refreshTrigger} />
          </div>
        )}
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[90vh] animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/50 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <Settings className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-sm text-slate-800 dark:white">Admin Settings</h3>
                  <p className="text-[11px] text-slate-400">Application preferences &amp; session</p>
                </div>
              </div>
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
              {/* 1. Theme Configuration */}
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                  Display Appearance
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setTheme('light')}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      theme === 'light' 
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-black shadow-xs' 
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    <span>Light</span>
                  </button>
                  <button
                    onClick={() => setTheme('dark')}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      theme === 'dark' 
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-black shadow-xs' 
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Dark</span>
                  </button>
                  <button
                    onClick={() => setTheme('system')}
                    className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      theme === 'system' 
                        ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 font-black shadow-xs' 
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Laptop className="w-3.5 h-3.5 text-slate-500" />
                    <span>Auto</span>
                  </button>
                </div>
              </div>

              {/* CLOUD MIRROR: Storage Quota & Supabase Maintenance */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                  Cloud Mirror &amp; Storage Maintenance
                </label>
                
                <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600 dark:text-slate-300">Supabase Cloud Mirror:</span>
                    <span className="font-black text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                      Connected
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-bold text-slate-600 dark:text-slate-300">Authoritative Writer:</span>
                    <span className="font-black text-blue-600 dark:text-blue-400">Counter Laptop (Dexie)</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    <button
                      onClick={handleManualRefresh}
                      disabled={isRefreshing}
                      className="py-2 px-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                      title="Force refresh local cache with latest Supabase records"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                      <span>Refresh Sync</span>
                    </button>

                    <button
                      onClick={handlePurgeOldCloudOrders}
                      disabled={isPurgingCloud}
                      className="py-2 px-2.5 rounded-xl bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900/60 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                      title="Purge orders older than 90 days from Supabase to free cloud storage"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Purge &gt;90d Cloud</span>
                    </button>

                    <button
                      onClick={handleCleanDeleteSupabase}
                      disabled={isPurgingCloud}
                      className="py-2 px-2.5 rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/60 font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                      title="Clean all records from Supabase mirror (Dexie counter safe)"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-red-600" />
                      <span>Clean Delete Cloud</span>
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    Clean deletion purges all cloud records from Supabase to free quotas or start fresh without touching the counter laptop&apos;s physical database.
                  </p>
                </div>
              </div>

              {/* LAPTOP COUNTER SPECIFIC CONTROLS */}
              {isLaptopWriter() && (
                <>
                  {/* 2. Kitchen Display Screen (KDS) Toggle */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                        Kitchen Display Screen (/kds)
                      </label>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                        isKdsActive 
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300' 
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        {isKdsActive ? 'SCREEN ACTIVE' : 'SCREEN DISABLED'}
                      </span>
                    </div>
                    <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                          isKdsActive 
                            ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300' 
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                        }`}>
                          <Tv className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="font-black text-xs text-slate-800 dark:text-white">Kitchen Display Screen</p>
                          <p className="text-[10px] text-slate-400">Toggles /kds screen display on/off</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleToggleKds}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          isKdsActive ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                            isKdsActive ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {/* 3. Hardware Printing Settings */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                      Receipt &amp; Hardware
                    </label>
                    <button
                      onClick={() => {
                        setIsSettingsOpen(false);
                        setIsReceiptSettingsOpen(true);
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-all text-left group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center">
                          <Printer className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="font-black text-xs text-slate-800 dark:text-white">Thermal Receipt &amp; Printer</p>
                          <p className="text-[10px] text-slate-400">80mm / 58mm paper, header, QR code</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Configure &rarr;</span>
                    </button>
                  </div>

                  {/* 4. Cashier PIN Management */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                      Counter Security
                    </label>
                    <button
                      onClick={() => {
                        setIsSettingsOpen(false);
                        setIsCashierSettingsOpen(true);
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-500 bg-slate-50/50 dark:bg-slate-800/40 hover:bg-blue-50/30 dark:hover:bg-blue-950/20 transition-all text-left group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 flex items-center justify-center">
                          <KeyRound className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="font-black text-xs text-slate-800 dark:text-white">Cashier PINs &amp; Passwords</p>
                          <p className="text-[10px] text-slate-400">Manage 4-digit staff access codes</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Manage &rarr;</span>
                    </button>
                  </div>

                  {/* 5. Super Admin Day 1 Launch & Factory Reset */}
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                    <label className="text-[10px] font-black text-red-500 uppercase tracking-wider block mb-2">
                      Super Admin Controls
                    </label>
                    <button
                      onClick={() => {
                        setIsSettingsOpen(false);
                        setIsSuperAdminResetOpen(true);
                      }}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-red-200 dark:border-red-900/60 hover:border-red-400 dark:hover:border-red-500 bg-red-50/40 dark:bg-red-950/20 hover:bg-red-50/60 dark:hover:bg-red-950/40 transition-all text-left group cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-red-100 dark:bg-red-900/60 text-red-700 dark:text-red-300 flex items-center justify-center">
                          <ShieldAlert className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <p className="font-black text-xs text-red-700 dark:text-red-300">Day 1 Launch &amp; Factory Reset</p>
                          <p className="text-[10px] text-slate-400">Purge test orders, keep menu catalog</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-red-600 dark:text-red-400">Access &rarr;</span>
                    </button>
                  </div>
                </>
              )}

              {/* Session Sign Out Button */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                  Security &amp; Session
                </label>
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-red-200 dark:border-red-800/60 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-900/50 text-red-600 dark:text-red-400 text-xs font-black transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>{isLaptopWriter() ? "Lock Admin Panel" : "Log Out of Owner Account"}</span>
                </button>
              </div>

              {/* Developer Support */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                  System Architecture &amp; Support
                </label>
                <TeddopsBranding variant="card" />
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 shrink-0">
              <button 
                onClick={() => setIsSettingsOpen(false)}
                className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-black dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-black text-xs tracking-wider transition-all cursor-pointer"
              >
                DONE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <ReceiptSettingsModal
        isOpen={isReceiptSettingsOpen}
        onClose={() => setIsReceiptSettingsOpen(false)}
      />

      <AdminCashierSettingsModal 
        isOpen={isCashierSettingsOpen} 
        onClose={() => setIsCashierSettingsOpen(false)} 
      />

      <AdminSuperAdminResetModal
        isOpen={isSuperAdminResetOpen}
        onClose={() => setIsSuperAdminResetOpen(false)}
      />

      <AdminDatabaseBackupModal
        isOpen={isBackupModalOpen}
        onClose={() => setIsBackupModalOpen(false)}
      />

      <AdminMasterPinModal
        isOpen={isMasterPinRequired}
        onSuccess={() => setIsMasterPinRequired(false)}
        onCancel={() => { openAppRoute('pos'); }}
      />

      {/* Mobile Floating Bottom Navigation Dock (lg:hidden) */}
      <nav className="lg:hidden fixed bottom-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] left-3 right-3 sm:left-6 sm:right-6 max-w-lg mx-auto z-50 bg-slate-900/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 dark:border-slate-800 shadow-[0_12px_40px_rgba(0,0,0,0.5)] rounded-2xl p-1.5 touch-none select-none pointer-events-auto">
        <div className="flex items-center justify-around gap-1 w-full">
          {navItems.map(({ tab, shortLabel, icon: Icon }) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => handleSelectTab(tab)}
                className={`flex flex-col items-center justify-center py-2 px-0.5 rounded-xl transition-all duration-200 active:scale-95 cursor-pointer select-none flex-1 min-w-0 ${
                  isActive 
                    ? 'text-white bg-blue-600 shadow-md font-black' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 font-semibold'
                }`}
              >
                <div className={`p-0.5 rounded-lg transition-transform ${isActive ? 'scale-110' : ''}`}>
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <span className={`text-[8.5px] sm:text-[9.5px] mt-0.5 tracking-tight truncate w-full text-center px-0.5 leading-none ${
                  isActive ? 'font-black text-white' : 'font-semibold text-slate-400'
                }`}>
                  {shortLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}