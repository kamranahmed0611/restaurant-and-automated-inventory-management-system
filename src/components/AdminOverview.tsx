"use client";

import React, { useState, useEffect, useRef } from "react";
import { db } from "@/lib/db";
import { modal } from "@/lib/modalStore";
import { adminCache, CACHE_TTL } from "@/lib/admin-cache";
import { posBus } from "@/lib/broadcast-bus";
import { loadCostLookupData, computeItemCogsFromLookup, backfillOrdersCogs, cleanupCorruptedInventoryItems } from "@/lib/inventory-service";
import { 
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip as RechartsTooltip, ResponsiveContainer, PieChart, Pie, Cell 
} from "recharts";
import { 
  TrendingUp, BarChart3, PieChart as PieChartIcon, ArrowDownRight, Settings, 
  CheckCircle2, Building2, Package, Clock, Filter, Bike, DollarSign, History, 
  AlertCircle, ChevronDown, ChevronUp, FileText, Search, UtensilsCrossed, ArrowRight,
  Printer, Calendar, ChevronLeft, ChevronRight, BookOpen, ClipboardList, Sparkles,
  LayoutDashboard, CreditCard, Smartphone, Wallet, RefreshCw, Cloud, UploadCloud
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isLaptopWriter } from "@/lib/device-mode";
import { bulkUploadLocalToCloud } from "@/lib/sync-engine";

interface RecordPoint {
  id: string;
  isoDate: string;
  label: string;
  subLabel: string;
  shiftsCount: number;
  ordersCount: number;
  grossSales: number;
  sales: number; // Net Sales
  cogs: number; // Cost of Goods
  profit: number; // Operating Gross Profit (Sales - COGS)
  fpGross: number;
  fpNet: number;
  // Payment Breakdown
  cashSales: number;
  digitalSales: number;
  jazzcashSales: number;
  easypaisaSales: number;
  foodpandaSales: number;
  // Order Channels
  dineInSales: number;
  takeawaySales: number;
}

interface FpPayoutRecord {
  id: string;
  payout_date: string;
  orders_count: number;
  gross_amount: number;
  commission_amount: number;
  expected_net: number;
  actual_received: number;
  variance: number;
  reference_no: string;
  notes?: string;
  created_at: string;
}

interface AdminOverviewProps {
  onNavigateTab?: (tab: 'OVERVIEW' | 'ORDERS' | 'INVENTORY' | 'MENU' | 'EXPENSES') => void;
  refreshTrigger?: number;
}

export default function AdminOverview({ 
  onNavigateTab,
  refreshTrigger 
}: AdminOverviewProps = {}) {
  const [timeRange, setTimeRange] = useState<'TODAY' | 'CURRENT_SHIFT' | 'CUSTOM_DATE' | '7_DAYS' | '30_DAYS' | 'THIS_MONTH'>('TODAY');
  const [selectedCustomDate, setSelectedCustomDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [viewGrouping, setViewGrouping] = useState<'DAILY' | 'SHIFT'>('DAILY');
  const [chartStyle, setChartStyle] = useState<'BAR' | 'LINE'>('BAR');
  const [chartMetricMode, setChartMetricMode] = useState<'FINANCIALS' | 'PAYMENTS' | 'CHANNELS'>('PAYMENTS');
  const [breakdownTab, setBreakdownTab] = useState<'PAYMENTS' | 'CHANNELS'>('PAYMENTS');
  const [isLoading, setIsLoading] = useState(true);
  
  // Chart Visibility Toggles - Financials
  const [showSales, setShowSales] = useState(true);
  const [showCogs, setShowCogs] = useState(true);
  const [showProfit, setShowProfit] = useState(true);

  // Chart Visibility Toggles - Payments
  const [showCash, setShowCash] = useState(true);
  const [showDigital, setShowDigital] = useState(true);
  const [showFpPayment, setShowFpPayment] = useState(true);

  // Chart Visibility Toggles - Channels
  const [showDineIn, setShowDineIn] = useState(true);
  const [showTakeaway, setShowTakeaway] = useState(true);
  const [showFpChannel, setShowFpChannel] = useState(true);

  // Data States
  const [dailyData, setDailyData] = useState<RecordPoint[]>([]);
  const [shiftData, setShiftData] = useState<RecordPoint[]>([]);
  const [salesByChannel, setSalesByChannel] = useState<any[]>([]);
  const [salesByPayment, setSalesByPayment] = useState<any[]>([]);
  const [totalShiftsInRange, setTotalShiftsInRange] = useState(0);
  
  // Core Operational & Payment Metrics
  const [metrics, setMetrics] = useState({
    grossSales: 0,
    netSales: 0,
    cogs: 0,
    operatingProfit: 0,
    totalOrdersCount: 0,
    windowFpGross: 0,
    windowFpNet: 0,
    totalCashSales: 0,
    totalDigitalSales: 0,
    totalJazzcashSales: 0,
    totalEasypaisaSales: 0,
    totalFoodpandaSales: 0,
    totalDineInSales: 0,
    totalTakeawaySales: 0,
  });

  // Foodpanda Accrual & Payout Cycle States
  const [globalFpCycle, setGlobalFpCycle] = useState({
    pendingOrdersCount: 0,
    grossReceivable: 0,
    commissionDeducted: 0,
    netReceivable: 0,
    orderIds: [] as string[]
  });

  const [fpPayoutHistory, setFpPayoutHistory] = useState<FpPayoutRecord[]>([]);
  const [showPayoutHistory, setShowPayoutHistory] = useState(false);

  // Modal States
  const [isFpSettingsOpen, setIsFpSettingsOpen] = useState(false);
  const [isSettlementModalOpen, setIsSettlementModalOpen] = useState(false);
  const [fpConfig, setFpConfig] = useState({ rate: 30.0 });
  const [tempFpRate, setTempFpRate] = useState(30.0);
  const [includePendingFp, setIncludePendingFp] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('muchachos_include_pending_fp') === 'true';
    }
    return false;
  });

  // Settlement Form Inputs
  const [settlementActualReceived, setSettlementActualReceived] = useState<number>(0);
  const [settlementRefNo, setSettlementRefNo] = useState("");
  const [settlementNotes, setSettlementNotes] = useState("");
  const [settlementDate, setSettlementDate] = useState(new Date().toISOString().split('T')[0]);
  const [isSettling, setIsSettling] = useState(false);
  const [isPushingToCloud, setIsPushingToCloud] = useState(false);

  const handlePushToCloud = async () => {
    const ok = await modal.confirm({
      title: "Sync All Local Data to Supabase?",
      message: "This will bulk-upload your local categories, menu items, raw inventory, recipes, shifts, and orders to the Supabase Cloud Mirror for remote phone/owner access.",
      confirmText: "Upload Now"
    });
    if (!ok) return;

    setIsPushingToCloud(true);
    modal.toast.info("Starting cloud sync upload...");
    const res = await bulkUploadLocalToCloud();
    setIsPushingToCloud(false);
    if (res.success) {
      modal.success("Cloud Sync Complete", res.message);
    } else {
      modal.error("Cloud Sync Failed", res.message);
    }
  };

  const COLORS = ['#2563eb', '#10b981', '#D70F64', '#f59e0b'];
  const CHANNEL_COLORS: Record<string, string> = {
    'DINE_IN': '#2563eb',
    'TAKEAWAY': '#10b981',
    'FOODPANDA': '#D70F64', // Foodpanda Official Brand Pink
  };
  const PAYMENT_COLORS: Record<string, string> = {
    'CASH': '#10b981',
    'JAZZCASH': '#f43f5e',
    'EASYPAISA': '#059669',
    'DIGITAL': '#6366f1',
    'FOODPANDA': '#D70F64',
  };

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const getOverviewCacheKey = (range: string, customDate: string, pendingFp: boolean) => {
    return `overview_${range}_${range === 'CUSTOM_DATE' ? customDate : ''}_${pendingFp}`;
  };

  const handleStepDate = (days: number) => {
    const [y, m, d] = selectedCustomDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    const yStr = dt.getFullYear();
    const mStr = String(dt.getMonth() + 1).padStart(2, '0');
    const dStr = String(dt.getDate()).padStart(2, '0');
    const nextDate = `${yStr}-${mStr}-${dStr}`;
    setSelectedCustomDate(nextDate);
    setTimeRange('CUSTOM_DATE');

    // Instant Cache check for 0ms stepping
    const key = getOverviewCacheKey('CUSTOM_DATE', nextDate, includePendingFp);
    const cached = adminCache.get<any>(key);
    if (cached) {
      processMetrics(cached.orders, cached.items, cached.shifts, cached.currentFpRate);
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const key = getOverviewCacheKey(timeRange, selectedCustomDate, includePendingFp);
    const isLive = timeRange === 'TODAY' || timeRange === 'CURRENT_SHIFT';
    const cached = adminCache.get<any>(key, isLive ? CACHE_TTL.LIVE_TODAY : CACHE_TTL.HISTORIC_DATE);

    if (cached) {
      // Instant render from cache (0ms) - completely instantaneous, zero network delay
      processMetrics(cached.orders, cached.items, cached.shifts, cached.currentFpRate);
      setIsLoading(false);
      return;
    }

    // Debounce network query (avoids rapid clicks spamming Supabase)
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      fetchDashboardData(true, false);
    }, 60);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [timeRange, selectedCustomDate, includePendingFp]);

  // Realtime subscription & Local posBus listener: silently refreshes active today/shift without wiping the screen
  useEffect(() => {
    const unsubBus = posBus.subscribe((msg: any) => {
      if ([
        'ORDER_CREATED', 'ORDER_COMPLETED', 'ORDER_UPDATED',
        'EXPENSE_LOGGED', 'SHIFT_OPENED', 'SHIFT_CLOSED', 'INVENTORY_DEDUCTED',
        'STOCK_UPDATED', 'INVENTORY_RESTOCKED', 'INVENTORY_UPDATED',
        'MANUAL_REFRESH', 'MENU_UPDATED'
      ].includes(msg?.type)) {
        adminCache.invalidate('overview_TODAY');
        adminCache.invalidate('overview_CURRENT_SHIFT');
        adminCache.invalidate(getOverviewCacheKey(timeRange, selectedCustomDate, includePendingFp));
        fetchDashboardData(false, true);
      }
    });

    return () => {
      unsubBus();
    };
  }, [timeRange, selectedCustomDate, includePendingFp]);

  // Direct prop-driven refresh trigger from top executive header
  useEffect(() => {
    if (refreshTrigger) {
      adminCache.invalidate();
      fetchDashboardData(true, true);
    }
  }, [refreshTrigger]);

  // Remote Cloud Realtime WebSockets: updates instantly on owner's phone/screen when orders or shifts sync
  useEffect(() => {
    if (isLaptopWriter()) return;

    const channel = supabase
      .channel('realtime_admin_overview')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        adminCache.invalidate('overview_TODAY');
        adminCache.invalidate('overview_CURRENT_SHIFT');
        adminCache.invalidate(getOverviewCacheKey(timeRange, selectedCustomDate, includePendingFp));
        fetchDashboardData(false, true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cashier_shifts' }, () => {
        adminCache.invalidate('overview_TODAY');
        adminCache.invalidate('overview_CURRENT_SHIFT');
        adminCache.invalidate(getOverviewCacheKey(timeRange, selectedCustomDate, includePendingFp));
        fetchDashboardData(false, true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [timeRange, selectedCustomDate, includePendingFp]);

  // Remote Cloud 20s Background Polling Fallback (Q23: A)
  useEffect(() => {
    if (isLaptopWriter()) return;
    const interval = setInterval(() => {
      fetchDashboardData(false, true);
    }, 20000);
    return () => clearInterval(interval);
  }, [timeRange, selectedCustomDate, includePendingFp]);

  // Backfill historical orders COGS in Dexie & clean phantom corrupted items on initial load
  useEffect(() => {
    if (isLaptopWriter()) {
      backfillOrdersCogs().catch(() => {});
      cleanupCorruptedInventoryItems().catch(() => {});
    }
  }, []);

  const fetchDashboardData = async (showLoadingSpinner = true, forceBypassCache = false) => {
    const key = getOverviewCacheKey(timeRange, selectedCustomDate, includePendingFp);
    if (!forceBypassCache) {
      const cached = adminCache.get<any>(key);
      if (cached) {
        processMetrics(cached.orders, cached.items, cached.shifts, cached.currentFpRate);
        setIsLoading(false);
        return;
      }
    }

    if (showLoadingSpinner) {
      setIsLoading(true);
    }
    
    // Determine date range for window first
    const now = new Date();
    let startDate = new Date();
    let endDate: Date | null = null;

    if (timeRange === 'TODAY') {
      startDate.setHours(0, 0, 0, 0); // start of today 00:00:00 local time
    } else if (timeRange === 'CUSTOM_DATE') {
      const [y, m, d] = selectedCustomDate.split('-').map(Number);
      startDate = new Date(y, m - 1, d, 0, 0, 0, 0);
      endDate = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else if (timeRange === 'CURRENT_SHIFT') {
      // Check local active shift first for 0ms lookup
      try {
        const localShifts = await db.shifts.toArray();
        const activeOrLatest = localShifts.find(s => s.status === 'OPEN') || localShifts[localShifts.length - 1];
        if (activeOrLatest) startDate = new Date(activeOrLatest.opened_at);
        else startDate.setHours(0, 0, 0, 0);
      } catch {
        startDate.setHours(0, 0, 0, 0);
      }
    } else if (timeRange === '7_DAYS') {
      startDate.setDate(now.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === '30_DAYS') {
      startDate.setDate(now.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
    } else if (timeRange === 'THIS_MONTH') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const startIso = startDate.toISOString();
    const endIso = endDate ? endDate.toISOString() : undefined;
    let currentFpRate = fpConfig.rate || 30.0;

    // Local Dexie Calculation (100% Offline Capable - 0ms Guaranteed)
    const loadOverviewFromDexie = async () => {
      try {
        const [localShifts, localOrders, lookup] = await Promise.all([
          db.shifts.toArray(),
          db.orders.toArray(),
          loadCostLookupData()
        ]);

        let filteredShifts = localShifts.filter(s => s.opened_at >= startIso);
        if (endIso) filteredShifts = filteredShifts.filter(s => s.opened_at <= endIso);

        let filteredOrders = localOrders.filter(o => o.created_at >= startIso);
        if (endIso) filteredOrders = filteredOrders.filter(o => o.created_at <= endIso);

        const items: any[] = [];
        filteredOrders.forEach(o => {
          (o.items || []).forEach(it => {
            const itemCogs = computeItemCogsFromLookup(it, lookup);
            items.push({
              ...it,
              cogs_total: itemCogs,
              orders: {
                id: o.id,
                created_at: o.created_at,
                status: o.status,
                order_type: o.order_type,
                shift_id: o.shift_id,
                fp_payout_status: o.fp_payout_status
              }
            });
          });
        });

        // Compute local Foodpanda cycle accrual
        const fpPending = localOrders.filter(o => 
          (o.order_type === 'FOODPANDA' || (o as any).payment_method === 'FOODPANDA_RECEIVABLE') &&
          o.status !== 'CANCELLED' &&
          o.fp_payout_status !== 'RECEIVED' &&
          o.fp_payout_status !== 'SETTLED' &&
          o.fp_payout_status !== 'VOIDED'
        );
        let grossRec = 0;
        let commTotal = 0;
        let netRec = 0;
        const orderIds: string[] = [];
        fpPending.forEach(o => {
          orderIds.push(o.id);
          const sale = Number(o.net_total || 0);
          grossRec += sale;
          const rate = Number(o.foodpanda_commission_pct || currentFpRate);
          const comm = sale * (rate / 100);
          commTotal += comm;
          netRec += (sale - comm);
        });
        setGlobalFpCycle({
          pendingOrdersCount: fpPending.length,
          grossReceivable: grossRec,
          commissionDeducted: commTotal,
          netReceivable: netRec,
          orderIds
        });
        setSettlementActualReceived(Math.round(netRec));

        processMetrics(filteredOrders, items, filteredShifts, currentFpRate);
      } catch (localErr) {
        console.warn("[AdminOverview] Local Dexie metrics fallback note:", localErr);
      }
    };

    // Remote Cloud Calculation for Vercel / Mobile phone viewer (reads from Supabase mirror)
    const loadOverviewFromSupabase = async () => {
      try {
        let ordersQuery = supabase.from('orders').select('*').gte('created_at', startIso);
        if (endIso) ordersQuery = ordersQuery.lte('created_at', endIso);

        let shiftsQuery = supabase.from('cashier_shifts').select('*').gte('opened_at', startIso);
        if (endIso) shiftsQuery = shiftsQuery.lte('opened_at', endIso);

        const [ordersRes, shiftsRes, rawInvRes, menuRes, recipesRes, orderItemsRes] = await Promise.all([
          ordersQuery,
          shiftsQuery,
          supabase.from('raw_inventory').select('*'),
          supabase.from('menu_items').select('*'),
          supabase.from('recipes').select('*'),
          supabase.from('order_items').select('*')
        ]);

        const remoteOrders = ordersRes.data || [];
        const remoteShifts = shiftsRes.data || [];
        const remoteRaw = rawInvRes.data || [];
        const remoteMenu = menuRes.data || [];
        const remoteRecipes = recipesRes.data || [];
        const remoteOrderItems = orderItemsRes.data || [];

        const remoteItemsByOrder = new Map<string, any[]>();
        remoteOrderItems.forEach((it: any) => {
          if (!remoteItemsByOrder.has(it.order_id)) remoteItemsByOrder.set(it.order_id, []);
          remoteItemsByOrder.get(it.order_id)!.push(it);
        });

        const costMap = new Map<string, number>();
        remoteRaw.forEach((r: any) => costMap.set(r.id, Number(r.cost_per_unit || 0)));
        const menuCostMap = new Map<string, number>();
        remoteMenu.forEach((m: any) => menuCostMap.set(m.id, Number(m.cost_price || 0)));
        const recipeMap = new Map<string, { invId: string; qty: number }[]>();
        remoteRecipes.forEach((rc: any) => {
          if (!recipeMap.has(rc.menu_item_id)) recipeMap.set(rc.menu_item_id, []);
          recipeMap.get(rc.menu_item_id)!.push({ invId: rc.inventory_item_id, qty: Number(rc.quantity_deducted || 1) });
        });

        const items: any[] = [];
        remoteOrders.forEach((o: any) => {
          const rawItems = Array.isArray(o.items) && o.items.length > 0 ? o.items : (remoteItemsByOrder.get(o.id) || []);
          rawItems.forEach((it: any) => {
            let itemCogs = Number(it.cogs_total || 0);
            if (itemCogs <= 0) {
              const recs = recipeMap.get(it.menu_item_id) || [];
              if (recs.length > 0) {
                itemCogs = recs.reduce((sum: number, r: any) => sum + (costMap.get(r.invId) || 0) * r.qty, 0) * Number(it.quantity || 1);
              } else {
                itemCogs = (menuCostMap.get(it.menu_item_id) || 0) * Number(it.quantity || 1);
              }
            }
            items.push({
              ...it,
              cogs_total: itemCogs,
              orders: {
                id: o.id,
                created_at: o.created_at,
                status: o.status,
                order_type: o.order_type,
                shift_id: o.shift_id,
                fp_payout_status: o.fp_payout_status
              }
            });
          });
        });

        const fpPending = remoteOrders.filter((o: any) => 
          (o.order_type === 'FOODPANDA' || o.payment_method === 'FOODPANDA_RECEIVABLE') &&
          o.status !== 'CANCELLED' &&
          o.fp_payout_status !== 'RECEIVED' &&
          o.fp_payout_status !== 'SETTLED' &&
          o.fp_payout_status !== 'VOIDED'
        );
        let grossRec = 0;
        let commTotal = 0;
        let netRec = 0;
        const orderIds: string[] = [];
        fpPending.forEach((o: any) => {
          orderIds.push(o.id);
          const sale = Number(o.net_total || 0);
          grossRec += sale;
          const rate = Number(o.foodpanda_commission_pct || currentFpRate);
          const comm = sale * (rate / 100);
          commTotal += comm;
          netRec += (sale - comm);
        });
        setGlobalFpCycle({
          pendingOrdersCount: fpPending.length,
          grossReceivable: grossRec,
          commissionDeducted: commTotal,
          netReceivable: netRec,
          orderIds
        });
        setSettlementActualReceived(Math.round(netRec));

        processMetrics(remoteOrders, items, remoteShifts, currentFpRate);
      } catch (remoteErr) {
        console.warn("[AdminOverview] Remote Supabase metrics error:", remoteErr);
      }
    };

    if (isLaptopWriter()) {
      await loadOverviewFromDexie();
    } else {
      await loadOverviewFromSupabase();
    }
    setIsLoading(false);
    fetchPayoutHistory();
  };

  const fetchPayoutHistory = () => {
    try {
      const local = localStorage.getItem('muchachos_fp_payouts');
      if (local) setFpPayoutHistory(JSON.parse(local));
      else setFpPayoutHistory([]);
    } catch {
      setFpPayoutHistory([]);
    }
  };

  const processMetrics = (orders: any[], items: any[], shifts: any[], fallbackFpRate: number) => {
    let gross = 0;
    let net = 0;
    let totalCogs = 0;
    let windowFpGross = 0;
    let windowFpNet = 0;
    let completedOrdersCount = 0;
    let totalCash = 0;
    let totalDigital = 0;
    let totalJC = 0;
    let totalEP = 0;
    let totalFpOrders = 0;
    let totalDineIn = 0;
    let totalTakeaway = 0;

    const channelMap: Record<string, number> = { 'DINE_IN': 0, 'TAKEAWAY': 0, 'FOODPANDA': 0 };
    
    // Shift Mapping
    const shiftsByDate: Record<string, number> = {};
    const shiftsMap: Record<string, any> = {};
    shifts.forEach((s, idx) => {
      shiftsMap[s.id] = { ...s, index: idx + 1 };
      const d = new Date(s.opened_at);
      const isoDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      shiftsByDate[isoDate] = (shiftsByDate[isoDate] || 0) + 1;
    });
    setTotalShiftsInRange(shifts.length);

    // DAILY MAP (Unified by calendar date)
    const dailyMap: Record<string, RecordPoint> = {};
    const getOrCreateDailyRecord = (dateObj: Date): RecordPoint => {
      const isoDate = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
      if (!dailyMap[isoDate]) {
        const dateKey = dateObj.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' });
        const fullDate = dateObj.toLocaleDateString('en-GB', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        dailyMap[isoDate] = {
          id: isoDate,
          isoDate,
          label: dateKey,
          subLabel: fullDate,
          shiftsCount: shiftsByDate[isoDate] || 1,
          ordersCount: 0,
          grossSales: 0,
          sales: 0,
          cogs: 0,
          profit: 0,
          fpGross: 0,
          fpNet: 0,
          cashSales: 0,
          digitalSales: 0,
          jazzcashSales: 0,
          easypaisaSales: 0,
          foodpandaSales: 0,
          dineInSales: 0,
          takeawaySales: 0,
        };
      }
      return dailyMap[isoDate];
    };

    // SHIFT-BY-SHIFT MAP
    const shiftRecordsMap: Record<string, RecordPoint> = {};
    shifts.forEach((s, idx) => {
      const openDate = new Date(s.opened_at);
      const label = `Shift #${idx + 1} (${openDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      shiftRecordsMap[s.id] = {
        id: s.id,
        isoDate: s.opened_at,
        label,
        subLabel: `${openDate.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} • ${s.status}`,
        shiftsCount: 1,
        ordersCount: 0,
        grossSales: 0,
        sales: 0,
        cogs: 0,
        profit: 0,
        fpGross: 0,
        fpNet: 0,
        cashSales: 0,
        digitalSales: 0,
        jazzcashSales: 0,
        easypaisaSales: 0,
        foodpandaSales: 0,
        dineInSales: 0,
        takeawaySales: 0,
      };
    });

    // 1. Process Orders for Financials
    orders.forEach(o => {
      const dateObj = new Date(o.created_at);
      const dailyRec = getOrCreateDailyRecord(dateObj);

      // Exclude voided / cancelled orders
      if (o.status === 'CANCELLED' || o.status === 'VOID') {
        return;
      }

      // If open tab with pending payment, record order count only
      if (o.status === 'OPEN_TAB' && (o.payment_method === 'PENDING' || !o.payment_method)) {
        dailyRec.ordersCount += 1;
        if (o.shift_id && shiftRecordsMap[o.shift_id]) {
          shiftRecordsMap[o.shift_id].ordersCount += 1;
        }
        return;
      }

      completedOrdersCount += 1;
      const saleAmt = Number(o.net_total || 0);
      gross += saleAmt;
      channelMap[o.order_type] = (channelMap[o.order_type] || 0) + saleAmt;

      const sId = o.shift_id;
      const isShiftValid = Boolean(sId && shiftRecordsMap[sId]);

      // Order Channels tracking
      if (o.order_type === 'DINE_IN') {
        totalDineIn += saleAmt;
        dailyRec.dineInSales += saleAmt;
        if (isShiftValid) shiftRecordsMap[sId].dineInSales += saleAmt;
      } else if (o.order_type === 'TAKEAWAY') {
        totalTakeaway += saleAmt;
        dailyRec.takeawaySales += saleAmt;
        if (isShiftValid) shiftRecordsMap[sId].takeawaySales += saleAmt;
      }

      // Payment Method Classification
      const method = String(o.payment_method || '').toUpperCase();
      const isFoodpanda = o.order_type === 'FOODPANDA' || method === 'FOODPANDA_RECEIVABLE';
      const isJC = method === 'JAZZCASH';
      const isEP = method === 'EASYPAISA';
      const isCard = method === 'CARD';
      const isDigital = isJC || isEP || isCard;
      const isCash = !isFoodpanda && !isDigital;

      if (isCash) {
        totalCash += saleAmt;
        dailyRec.cashSales += saleAmt;
        if (isShiftValid) shiftRecordsMap[sId].cashSales += saleAmt;
      } else if (isFoodpanda) {
        totalFpOrders += saleAmt;
        dailyRec.foodpandaSales += saleAmt;
        if (isShiftValid) shiftRecordsMap[sId].foodpandaSales += saleAmt;
      } else if (isDigital) {
        totalDigital += saleAmt;
        dailyRec.digitalSales += saleAmt;
        if (isShiftValid) shiftRecordsMap[sId].digitalSales += saleAmt;

        if (isJC) {
          totalJC += saleAmt;
          dailyRec.jazzcashSales += saleAmt;
          if (isShiftValid) shiftRecordsMap[sId].jazzcashSales += saleAmt;
        } else if (isEP) {
          totalEP += saleAmt;
          dailyRec.easypaisaSales += saleAmt;
          if (isShiftValid) shiftRecordsMap[sId].easypaisaSales += saleAmt;
        }
      }

      const isFpPending = isFoodpanda && o.fp_payout_status !== 'RECEIVED' && o.fp_payout_status !== 'SETTLED' && o.fp_payout_status !== 'VOIDED';

      let actualNet = saleAmt;
      if (isFoodpanda) {
        const rate = Number(o.foodpanda_commission_pct || fallbackFpRate);
        const comm = saleAmt * (rate / 100);
        actualNet = saleAmt - comm;

        windowFpGross += saleAmt;
        windowFpNet += actualNet;

        dailyRec.fpGross += saleAmt;
        dailyRec.fpNet += actualNet;
        if (isShiftValid) {
          shiftRecordsMap[sId].fpGross += saleAmt;
          shiftRecordsMap[sId].fpNet += actualNet;
        }

        // If user unchecks "Include Pending Foodpanda", exclude from realized net sales and profit
        if (!includePendingFp && isFpPending) {
          dailyRec.ordersCount += 1;
          dailyRec.grossSales += saleAmt;
          if (isShiftValid) {
            shiftRecordsMap[sId].ordersCount += 1;
            shiftRecordsMap[sId].grossSales += saleAmt;
          }
          return;
        }
      }
      
      net += actualNet;
      dailyRec.ordersCount += 1;
      dailyRec.grossSales += saleAmt;
      dailyRec.sales += actualNet;
      dailyRec.profit += actualNet; // Operating Profit = Sales - COGS

      if (isShiftValid) {
        shiftRecordsMap[sId].ordersCount += 1;
        shiftRecordsMap[sId].grossSales += saleAmt;
        shiftRecordsMap[sId].sales += actualNet;
        shiftRecordsMap[sId].profit += actualNet;
      }
    });

    // 2. Process Items (COGS)
    items.forEach(i => {
      if (!i.orders || i.orders.status === 'OPEN_TAB' || i.orders.status === 'PENDING' || i.orders.status === 'CANCELLED' || i.orders.status === 'VOID') return;
      
      const isFp = i.orders.order_type === 'FOODPANDA' || i.orders.payment_method === 'FOODPANDA_RECEIVABLE';
      const isFpPending = isFp && i.orders.fp_payout_status !== 'RECEIVED' && i.orders.fp_payout_status !== 'SETTLED' && i.orders.fp_payout_status !== 'VOIDED';

      if (!includePendingFp && isFpPending) return;

      const cogs = Number(i.cogs_total || 0);
      totalCogs += cogs;

      const dateObj = new Date(i.orders.created_at);
      const dailyRec = getOrCreateDailyRecord(dateObj);
      dailyRec.cogs += cogs;
      dailyRec.profit -= cogs;

      const sId = i.orders.shift_id;
      if (sId && shiftRecordsMap[sId]) {
        shiftRecordsMap[sId].cogs += cogs;
        shiftRecordsMap[sId].profit -= cogs;
      }
    });

    // Sort Daily chronologically
    const sortedDaily = Object.values(dailyMap).sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    const sortedShifts = Object.values(shiftRecordsMap).filter(s => s.ordersCount > 0 || s.sales > 0);

    setMetrics({
      grossSales: gross,
      netSales: net,
      cogs: totalCogs,
      operatingProfit: net - totalCogs,
      totalOrdersCount: orders.length,
      windowFpGross,
      windowFpNet,
      totalCashSales: totalCash,
      totalDigitalSales: totalDigital,
      totalJazzcashSales: totalJC,
      totalEasypaisaSales: totalEP,
      totalFoodpandaSales: totalFpOrders,
      totalDineInSales: totalDineIn,
      totalTakeawaySales: totalTakeaway,
    });

    const paymentArray = [
      { name: 'CASH', label: 'Cash in Drawer', value: totalCash, color: '#10b981' },
      { name: 'JAZZCASH', label: 'JazzCash', value: totalJC, color: '#f43f5e' },
      { name: 'EASYPAISA', label: 'EasyPaisa', value: totalEP, color: '#059669' },
      { name: 'FOODPANDA', label: 'Foodpanda', value: totalFpOrders, color: '#D70F64' }
    ].filter(p => p.value > 0);

    setSalesByPayment(paymentArray);
    setSalesByChannel(Object.entries(channelMap).map(([name, value]) => ({ name, value })).filter(c => c.value > 0));
    setDailyData(sortedDaily);
    setShiftData(sortedShifts);

    if (sortedDaily.length <= 1) {
      setChartStyle('BAR');
    }
  };

  const handleUpdateFpConfig = async () => {
    if (!isLaptopWriter()) return;
    localStorage.setItem('muchachos_fp_commission_pct', String(tempFpRate));
    setFpConfig({ rate: tempFpRate });
    setIsFpSettingsOpen(false);
    fetchDashboardData();
  };

  // EXECUTE SETTLEMENT / RECORD BANK PAYOUT
  const handleConfirmSettlement = async () => {
    if (!isLaptopWriter()) return;
    if (globalFpCycle.orderIds.length === 0) {
      modal.warning("No Pending Orders", "No pending Foodpanda orders to settle.");
      return;
    }
    if (settlementActualReceived <= 0) {
      modal.warning("Invalid Amount", "Please enter a valid amount received in bank.");
      return;
    }

    setIsSettling(true);
    try {
      for (const orderId of globalFpCycle.orderIds) {
        await db.orders.update(orderId, { fp_payout_status: 'RECEIVED' });
      }

      const expected = Math.round(globalFpCycle.netReceivable);
      const actual = Number(settlementActualReceived);
      const variance = actual - expected;

      const payoutRecord: FpPayoutRecord = {
        id: crypto.randomUUID(),
        payout_date: settlementDate,
        orders_count: globalFpCycle.pendingOrdersCount,
        gross_amount: Math.round(globalFpCycle.grossReceivable),
        commission_amount: Math.round(globalFpCycle.commissionDeducted),
        expected_net: expected,
        actual_received: actual,
        variance,
        reference_no: settlementRefNo || `FP-BATCH-${new Date().getTime().toString().slice(-6)}`,
        notes: settlementNotes,
        created_at: new Date().toISOString()
      };

      const existingHistory = JSON.parse(localStorage.getItem('muchachos_fp_payouts') || '[]');
      const newHistory = [payoutRecord, ...existingHistory];
      localStorage.setItem('muchachos_fp_payouts', JSON.stringify(newHistory));
      setFpPayoutHistory(newHistory);

      modal.success(
        "Settlement Recorded!",
        `Bank deposit of Rs. ${actual.toLocaleString()} recorded.\n${globalFpCycle.pendingOrdersCount} Foodpanda orders marked as settled.`
      );
      setIsSettlementModalOpen(false);
      fetchDashboardData();
    } catch (err) {
      console.error("Settlement error:", err);
      modal.error("Settlement Failed", "Failed to process settlement transaction.");
    } finally {
      setIsSettling(false);
    }
  };


  const activeChartData = viewGrouping === 'DAILY' ? dailyData : (shiftData.length > 0 ? shiftData : dailyData);


  // Custom Chart Tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data: RecordPoint = payload[0].payload;
      return (
        <div className="bg-slate-900 text-white p-4 rounded-xl shadow-2xl border border-slate-700 min-w-[260px]">
          <div className="border-b border-slate-700 pb-2 mb-2">
            <p className="font-black text-sm text-slate-100">{data.subLabel || data.label}</p>
            <div className="flex items-center justify-between text-xs text-slate-400 mt-0.5">
              <span>{data.shiftsCount > 1 ? `${data.shiftsCount} Shifts Combined` : `${data.shiftsCount} Shift`}</span>
              <span>{data.ordersCount} Orders</span>
            </div>
          </div>

          {chartMetricMode === 'PAYMENTS' ? (
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center text-emerald-400 font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  💵 Cash in Drawer:
                </span>
                <span>Rs. {data.cashSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between items-center text-indigo-400 font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
                  📱 Digital Total:
                </span>
                <span>Rs. {data.digitalSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              {(data.jazzcashSales > 0 || data.easypaisaSales > 0) && (
                <div className="pl-4 text-[11px] text-slate-400 space-y-0.5">
                  {data.jazzcashSales > 0 && (
                    <div className="flex justify-between items-center">
                      <span>&bull; JazzCash:</span>
                      <span>Rs. {data.jazzcashSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  {data.easypaisaSales > 0 && (
                    <div className="flex justify-between items-center">
                      <span>&bull; EasyPaisa:</span>
                      <span>Rs. {data.easypaisaSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                </div>
              )}
              {data.foodpandaSales > 0 && (
                <div className="flex justify-between items-center text-[#D70F64] font-bold">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#D70F64] inline-block" />
                    🐼 Foodpanda:
                  </span>
                  <span>Rs. {data.foodpandaSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              <div className="border-t border-slate-700 pt-2 mt-2 flex justify-between items-center text-slate-200 font-black text-xs">
                <span>Total Collection:</span>
                <span>Rs. {(data.cashSales + data.digitalSales + data.foodpandaSales).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          ) : chartMetricMode === 'CHANNELS' ? (
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center text-blue-400 font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                  🍽️ Dine-In:
                </span>
                <span>Rs. {data.dineInSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between items-center text-emerald-400 font-bold">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  🛍️ Takeaway:
                </span>
                <span>Rs. {data.takeawaySales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              {data.foodpandaSales > 0 && (
                <div className="flex justify-between items-center text-[#D70F64] font-bold">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#D70F64] inline-block" />
                    🐼 Foodpanda:
                  </span>
                  <span>Rs. {data.foodpandaSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              <div className="border-t border-slate-700 pt-2 mt-2 flex justify-between items-center text-slate-200 font-black text-xs">
                <span>Total Revenue:</span>
                <span>Rs. {(data.dineInSales + data.takeawaySales + data.foodpandaSales).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center text-blue-400 font-bold">
                <span>🔵 Net Sales:</span>
                <span>Rs. {data.sales.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="flex justify-between items-center text-amber-400 font-bold">
                <span>🟠 Goods (COGS):</span>
                <span>Rs. {data.cogs.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              {data.fpNet > 0 && (
                <div className="flex justify-between items-center text-[#D70F64] font-black text-xs pt-1.5 border-t border-slate-700/80">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-[#D70F64] inline-block shadow-2xs" />
                    Foodpanda Net:
                  </span>
                  <span>Rs. {data.fpNet.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                </div>
              )}
              <div className="border-t border-slate-700 pt-2 mt-2 flex justify-between items-center text-emerald-400 font-black text-sm">
                <span>🟢 Operating Profit:</span>
                <span>Rs. {data.profit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <div className="border-t border-slate-800 pt-1 text-[11px] text-slate-400 flex justify-between">
                <span>Cash / Digital:</span>
                <span>Rs. {data.cashSales.toLocaleString()} / Rs. {data.digitalSales.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col gap-5 sm:gap-6 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* TIME FILTERS & CONTROLS BAR (Clean & Non-duplicated) */}
      <div className="bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col gap-2.5">
        {/* ROW 1: Title & Header Actions (Foodpanda + Refresh) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center p-1.5 shadow-xs shrink-0 border border-blue-200 dark:border-blue-800">
              <LayoutDashboard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-1.5 truncate">
                <span className="truncate">Sales &amp; Analytics</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                  {timeRange === 'TODAY' ? 'Today' : timeRange === 'CURRENT_SHIFT' ? 'Shift' : timeRange === 'CUSTOM_DATE' ? selectedCustomDate : timeRange.replace('_', ' ')}
                </span>
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {/* FP Accrual Toggle */}
            <label 
              className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-xl border cursor-pointer transition-all ${
                includePendingFp 
                  ? 'bg-pink-50 dark:bg-pink-950/40 text-pink-700 dark:text-pink-300 border-pink-300 dark:border-pink-800 shadow-xs' 
                  : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/60'
              }`}
              title="Check: Accrual Profit (Includes Foodpanda sales). Uncheck: Cash-only in drawer."
            >
              <input 
                type="checkbox" 
                checked={includePendingFp} 
                onChange={(e) => {
                  setIncludePendingFp(e.target.checked);
                  if (typeof window !== 'undefined') {
                    localStorage.setItem('muchachos_include_pending_fp', String(e.target.checked));
                  }
                }} 
                className="w-3 h-3 accent-[#D70F64] rounded cursor-pointer" 
              />
              <span className="text-[10px] font-black">Foodpanda</span>
            </label>

            {/* Push Local Data to Cloud Mirror (Laptop only) */}
            {isLaptopWriter() && (
              <button
                onClick={handlePushToCloud}
                disabled={isPushingToCloud}
                className="flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-2xs transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                title="Bulk Upload All Local Data to Supabase Mirror"
              >
                <UploadCloud className={`w-3.5 h-3.5 ${isPushingToCloud ? 'animate-bounce' : ''}`} />
                <span className="hidden sm:inline">{isPushingToCloud ? "Syncing..." : "Push to Cloud"}</span>
              </button>
            )}

            {/* Force Cloud Refresh Button */}
            <button
              onClick={() => fetchDashboardData(true, true)}
              disabled={isLoading}
              className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-all cursor-pointer shadow-2xs active:scale-95 disabled:opacity-50"
              title="Force Refresh Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-600 dark:text-blue-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* ROW 2: Date Stepper & Time Range Segmented Pills (Sleek, Single Row, Zero Wrapping) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 w-full">
          {/* Calendar Date Stepper Picker */}
          <div className={`flex items-center gap-0.5 px-1.5 py-1 rounded-xl border shrink-0 transition-all ${
            timeRange === 'CUSTOM_DATE' 
              ? 'bg-blue-50/80 dark:bg-blue-950/60 border-blue-400 dark:border-blue-700 shadow-2xs' 
              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-2xs'
          }`}>
            <button
              onClick={() => handleStepDate(-1)}
              className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              title="Previous Day"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-1 px-1">
              <Calendar className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
              <input 
                type="date"
                value={selectedCustomDate}
                onChange={(e) => {
                  setSelectedCustomDate(e.target.value);
                  setTimeRange('CUSTOM_DATE');
                }}
                className="text-[11px] font-bold text-slate-800 dark:text-slate-200 outline-none bg-transparent cursor-pointer w-[105px]"
              />
            </div>
            <button
              onClick={() => handleStepDate(1)}
              className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
              title="Next Day"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Time range pills */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
            <button 
              onClick={() => setTimeRange('TODAY')} 
              className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                timeRange === 'TODAY' 
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Today
            </button>
            <button 
              onClick={() => setTimeRange('CURRENT_SHIFT')} 
              className={`px-2 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                timeRange === 'CURRENT_SHIFT' 
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Shift
            </button>
            <button 
              onClick={() => setTimeRange('7_DAYS')} 
              className={`px-2 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                timeRange === '7_DAYS' 
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              7D
            </button>
            <button 
              onClick={() => setTimeRange('30_DAYS')} 
              className={`px-2 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                timeRange === '30_DAYS' 
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              30D
            </button>
            <button 
              onClick={() => setTimeRange('THIS_MONTH')} 
              className={`px-2 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                timeRange === 'THIS_MONTH' 
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Month
            </button>
          </div>
        </div>
      </div>

      {/* QUICK SHORT VISUAL REDIRECT BAR (Hidden on mobile phones to prioritize metrics) */}
      <div className="hidden md:grid grid-cols-3 gap-3">
        <button 
          onClick={() => onNavigateTab?.('ORDERS')}
          className="flex items-center justify-between px-4 py-3 bg-white hover:bg-blue-50/50 border border-slate-200 hover:border-blue-300 rounded-xl transition-all shadow-xs group cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-black group-hover:scale-105 transition-transform">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black text-slate-800 leading-tight">Orders &amp; Kitchen Log</p>
              <p className="text-[10px] text-slate-400 font-medium">Tickets, token search &amp; dispatch</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" />
        </button>

        <button 
          onClick={() => onNavigateTab?.('EXPENSES')}
          className="flex items-center justify-between px-4 py-3 bg-white hover:bg-indigo-50/50 border border-slate-200 hover:border-indigo-300 rounded-xl transition-all shadow-xs group cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center font-black group-hover:scale-105 transition-transform">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black text-slate-800 leading-tight">Expenses &amp; P&amp;L</p>
              <p className="text-[10px] text-slate-400 font-medium">Rent, electricity, wages &amp; overheads</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
        </button>

        <button 
          onClick={() => onNavigateTab?.('INVENTORY')}
          className="flex items-center justify-between px-4 py-3 bg-white hover:bg-emerald-50/50 border border-slate-200 hover:border-emerald-300 rounded-xl transition-all shadow-xs group cursor-pointer text-left"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black group-hover:scale-105 transition-transform">
              <Package className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black text-slate-800 leading-tight">Stock &amp; Ingredients</p>
              <p className="text-[10px] text-slate-400 font-medium">Low stock alerts &amp; restock logging</p>
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all" />
        </button>
      </div>

      {/* OPERATIONAL KPI METRIC CARDS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {/* 1. Net Sales */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-xs hover:border-blue-400 dark:hover:border-blue-500 transition-all">
          <div className="flex items-center justify-between">
            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">1. Net Sales</p>
            <span className="text-[9px] sm:text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded-full">
              {timeRange === 'TODAY' ? 'Today' : timeRange}
            </span>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 mt-2">Rs. {metrics.netSales.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
          <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 mt-1">Gross: Rs. {metrics.grossSales.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
        </div>

        {/* 2. Food Cost (COGS) */}
        <div className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/40 p-4 sm:p-5 rounded-2xl shadow-xs hover:border-amber-400 dark:hover:border-amber-500 transition-all">
          <p className="text-[10px] sm:text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1">
            <Package className="w-3.5 h-3.5"/> 2. Food Cost
          </p>
          <p className="text-xl sm:text-2xl font-black text-amber-600 mt-2">Rs. {metrics.cogs.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
          <p className="text-[10px] sm:text-[11px] font-bold text-amber-500/80 mt-1">
            {metrics.netSales > 0 ? `${((metrics.cogs / metrics.netSales) * 100).toFixed(1)}% of Sales` : 'Ingredients consumed'}
          </p>
        </div>

        {/* 3. Kitchen Operating Profit (Spans full width on mobile) */}
        <div className="col-span-2 md:col-span-1 bg-gradient-to-br from-emerald-500 to-emerald-600 border border-emerald-600 p-4 sm:p-5 rounded-2xl shadow-lg text-white">
          <p className="text-[10px] sm:text-xs font-bold text-emerald-100 uppercase tracking-wider">3. Kitchen Operating Profit</p>
          <p className="text-2xl sm:text-3xl font-black mt-1 sm:mt-2">Rs. {metrics.operatingProfit.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
          <p className="text-[10px] sm:text-[11px] font-bold text-emerald-100 mt-1">
            {metrics.netSales > 0 ? `Gross Margin: ${((metrics.operatingProfit / metrics.netSales) * 100).toFixed(1)}%` : 'Net Sales - Food Cost'}
          </p>
        </div>

        {/* 4. Orders & Shifts Count */}
        <div 
          onClick={() => onNavigateTab?.('ORDERS')}
          className="col-span-2 md:col-span-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-xs hover:border-blue-400 dark:hover:border-blue-500 cursor-pointer transition-all group"
          title="Click to view full Orders & Kitchen Status Live Log"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <UtensilsCrossed className="w-3.5 h-3.5"/> Orders &amp; Shifts
            </p>
            <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 group-hover:underline flex items-center gap-0.5">
              Live Log <ArrowRight className="w-3 h-3" />
            </span>
          </div>
          <p className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 mt-2">{metrics.totalOrdersCount} <span className="text-xs sm:text-sm font-semibold text-slate-400">Total Orders</span></p>
          <p className="text-[10px] sm:text-[11px] font-bold text-blue-600 dark:text-blue-400 mt-1">
            {totalShiftsInRange} {totalShiftsInRange === 1 ? 'Shift' : 'Shifts Combined'} in view
          </p>
        </div>
      </div>

      {/* CASH & DIGITAL PAYMENT QUICK STATS STRIP */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Cash in Drawer */}
        <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/50 p-3.5 sm:p-4 rounded-2xl shadow-xs flex items-center justify-between hover:border-emerald-400 transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-black shrink-0 border border-emerald-200 dark:border-emerald-800">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">Cash in Drawer</p>
              <p className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-0.5">Rs. {metrics.totalCashSales.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
            </div>
          </div>
          <span className="text-[10px] sm:text-xs font-black px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            {metrics.grossSales > 0 ? `${((metrics.totalCashSales / metrics.grossSales) * 100).toFixed(0)}%` : '0%'}
          </span>
        </div>

        {/* Digital (JazzCash & EasyPaisa) */}
        <div className="bg-white dark:bg-slate-900 border border-indigo-200 dark:border-indigo-900/50 p-3.5 sm:p-4 rounded-2xl shadow-xs flex items-center justify-between hover:border-indigo-400 transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-black shrink-0 border border-indigo-200 dark:border-indigo-800">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">Digital Payments</p>
              <p className="text-xl sm:text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-0.5">Rs. {metrics.totalDigitalSales.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] sm:text-xs font-black px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 inline-block mb-0.5">
              {metrics.grossSales > 0 ? `${((metrics.totalDigitalSales / metrics.grossSales) * 100).toFixed(0)}%` : '0%'}
            </span>
            <p className="text-[10px] font-bold text-slate-400">
              JC: {metrics.totalJazzcashSales.toLocaleString()} &bull; EP: {metrics.totalEasypaisaSales.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Foodpanda Orders */}
        <div className="bg-white dark:bg-slate-900 border border-pink-200 dark:border-pink-900/50 p-3.5 sm:p-4 rounded-2xl shadow-xs flex items-center justify-between hover:border-pink-400 transition-all">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-pink-50 dark:bg-pink-950/60 text-[#D70F64] flex items-center justify-center font-black shrink-0 border border-pink-200 dark:border-pink-800">
              <Bike className="w-5 h-5" />
            </div>
            <div>
              <p className="text-[10px] sm:text-xs font-bold text-slate-400 uppercase tracking-wider">Foodpanda Orders</p>
              <p className="text-xl sm:text-2xl font-black text-[#D70F64] mt-0.5">Rs. {metrics.totalFoodpandaSales.toLocaleString(undefined, {maximumFractionDigits: 0})}</p>
            </div>
          </div>
          <span className="text-[10px] sm:text-xs font-black px-2.5 py-1 rounded-full bg-pink-50 text-pink-700 dark:bg-pink-950/70 dark:text-pink-300 border border-pink-200 dark:border-pink-800">
            {metrics.grossSales > 0 ? `${((metrics.totalFoodpandaSales / metrics.grossSales) * 100).toFixed(0)}%` : '0%'}
          </span>
        </div>
      </div>

      {/* MULTI-METRIC VISUALIZATION CHART ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xs flex flex-col">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="font-black text-slate-800 dark:text-slate-100 flex items-center gap-2">
                {chartMetricMode === 'PAYMENTS' ? (
                  <>
                    <CreditCard className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    {viewGrouping === 'DAILY' ? 'Daily Payment Methods Breakdown' : 'Shift-by-Shift Payment Methods'}
                  </>
                ) : chartMetricMode === 'CHANNELS' ? (
                  <>
                    <UtensilsCrossed className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    {viewGrouping === 'DAILY' ? 'Daily Sales Channels Comparison' : 'Shift-by-Shift Sales Channels'}
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" /> 
                    {viewGrouping === 'DAILY' ? 'Daily Operating Comparison' : 'Shift-by-Shift Performance'}
                  </>
                )}
              </h3>
              <p className="text-xs font-medium text-slate-400 mt-0.5">
                {chartMetricMode === 'PAYMENTS'
                  ? `Comparing Cash in drawer, Digital (JazzCash & EasyPaisa), and Foodpanda collections ${viewGrouping === 'DAILY' ? 'per day' : 'shift-by-shift'}.`
                  : chartMetricMode === 'CHANNELS'
                  ? `Comparing Dine-In, Takeaway, and Foodpanda revenue ${viewGrouping === 'DAILY' ? 'per day' : 'shift-by-shift'}.`
                  : viewGrouping === 'DAILY' 
                  ? `Consolidated daily pillars (${includePendingFp ? 'Accrual Profit with Foodpanda' : 'Cash-only in drawer'}).` 
                  : 'Comparing individual cashier shifts side-by-side.'}
              </p>
            </div>

            {/* CONTROLS */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Metric Mode Switcher */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold">
                <button 
                  onClick={() => setChartMetricMode('PAYMENTS')}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${chartMetricMode === 'PAYMENTS' ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-xs font-black' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  💵 Cash / Digital
                </button>
                <button 
                  onClick={() => setChartMetricMode('CHANNELS')}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${chartMetricMode === 'CHANNELS' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs font-black' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  🛍️ Channels
                </button>
                <button 
                  onClick={() => setChartMetricMode('FINANCIALS')}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${chartMetricMode === 'FINANCIALS' ? 'bg-white dark:bg-slate-700 text-purple-600 dark:text-purple-300 shadow-xs font-black' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  📊 P&amp;L
                </button>
              </div>

              {shiftData.length > 1 && (
                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold">
                  <button 
                    onClick={() => setViewGrouping('DAILY')} 
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${viewGrouping === 'DAILY' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs font-black' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    Daily
                  </button>
                  <button 
                    onClick={() => setViewGrouping('SHIFT')} 
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${viewGrouping === 'SHIFT' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs font-black' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    Shift
                  </button>
                </div>
              )}

              {activeChartData.length > 1 && (
                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold">
                  <button 
                    onClick={() => setChartStyle('BAR')} 
                    className={`px-2 py-1 rounded-md transition-all cursor-pointer ${chartStyle === 'BAR' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs font-black' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    📊 Bars
                  </button>
                  <button 
                    onClick={() => setChartStyle('LINE')} 
                    className={`px-2 py-1 rounded-md transition-all cursor-pointer ${chartStyle === 'LINE' ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs font-black' : 'text-slate-500 dark:text-slate-400'}`}
                  >
                    📈 Lines
                  </button>
                </div>
              )}

              {/* Dynamic Series Toggle Pills */}
              <div className="flex items-center gap-1.5">
                {chartMetricMode === 'PAYMENTS' ? (
                  <>
                    <button
                      onClick={() => setShowCash(!showCash)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showCash ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      Cash
                    </button>
                    <button
                      onClick={() => setShowDigital(!showDigital)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showDigital ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-indigo-500" />
                      Digital
                    </button>
                    <button
                      onClick={() => setShowFpPayment(!showFpPayment)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showFpPayment ? 'bg-pink-50 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-[#D70F64]" />
                      Foodpanda
                    </button>
                  </>
                ) : chartMetricMode === 'CHANNELS' ? (
                  <>
                    <button
                      onClick={() => setShowDineIn(!showDineIn)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showDineIn ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-blue-600" />
                      Dine-In
                    </button>
                    <button
                      onClick={() => setShowTakeaway(!showTakeaway)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showTakeaway ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      Takeaway
                    </button>
                    <button
                      onClick={() => setShowFpChannel(!showFpChannel)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showFpChannel ? 'bg-pink-50 dark:bg-pink-950/60 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-[#D70F64]" />
                      Foodpanda
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => setShowSales(!showSales)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showSales ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-blue-600" />
                      Sales
                    </button>
                    <button
                      onClick={() => setShowCogs(!showCogs)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showCogs ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-amber-500" />
                      Food Cost
                    </button>
                    <button
                      onClick={() => setShowProfit(!showProfit)}
                      className={`px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 border transition-all cursor-pointer ${
                        showProfit ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-slate-50 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-50'
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full bg-emerald-500" />
                      Kitchen Profit
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* MAIN CHART */}
          <div className="h-80 w-full min-w-0 overflow-hidden mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart 
                data={activeChartData} 
                margin={{ top: 15, right: 15, left: 10, bottom: 5 }}
                barGap={activeChartData.length <= 1 ? 14 : 4}
              >
                <defs>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="label" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 12, fill: '#475569', fontWeight: 700 }} 
                  dy={10} 
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 11, fill: '#94a3b8' }} 
                  dx={-5} 
                  tickFormatter={(val) => `Rs ${val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val}`} 
                />
                <RechartsTooltip content={<CustomTooltip />} />
                
                {/* 1. PAYMENTS MODE */}
                {chartMetricMode === 'PAYMENTS' && (
                  chartStyle === 'BAR' ? (
                    <>
                      {showCash && (
                        <Bar 
                          dataKey="cashSales" 
                          name="Cash in Drawer" 
                          fill="#10b981" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                      {showDigital && (
                        <Bar 
                          dataKey="digitalSales" 
                          name="Digital (JazzCash/EP)" 
                          fill="#6366f1" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                      {showFpPayment && (
                        <Bar 
                          dataKey="foodpandaSales" 
                          name="Foodpanda" 
                          fill="#D70F64" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {showCash && (
                        <Line 
                          type="monotone" 
                          dataKey="cashSales" 
                          name="Cash in Drawer" 
                          stroke="#10b981" 
                          strokeWidth={2.5} 
                          dot={{ r: 4, fill: '#10b981' }} 
                          activeDot={{ r: 6 }} 
                        />
                      )}
                      {showDigital && (
                        <Line 
                          type="monotone" 
                          dataKey="digitalSales" 
                          name="Digital (JazzCash/EP)" 
                          stroke="#6366f1" 
                          strokeWidth={2.5} 
                          dot={{ r: 4, fill: '#6366f1' }} 
                          activeDot={{ r: 6 }} 
                        />
                      )}
                      {showFpPayment && (
                        <Line 
                          type="monotone" 
                          dataKey="foodpandaSales" 
                          name="Foodpanda" 
                          stroke="#D70F64" 
                          strokeWidth={2.5} 
                          dot={{ r: 4, fill: '#D70F64' }} 
                          activeDot={{ r: 6 }} 
                        />
                      )}
                    </>
                  )
                )}

                {/* 2. CHANNELS MODE */}
                {chartMetricMode === 'CHANNELS' && (
                  chartStyle === 'BAR' ? (
                    <>
                      {showDineIn && (
                        <Bar 
                          dataKey="dineInSales" 
                          name="Dine-In" 
                          fill="#2563eb" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                      {showTakeaway && (
                        <Bar 
                          dataKey="takeawaySales" 
                          name="Takeaway" 
                          fill="#10b981" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                      {showFpChannel && (
                        <Bar 
                          dataKey="foodpandaSales" 
                          name="Foodpanda" 
                          fill="#D70F64" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {showDineIn && (
                        <Line 
                          type="monotone" 
                          dataKey="dineInSales" 
                          name="Dine-In" 
                          stroke="#2563eb" 
                          strokeWidth={2.5} 
                          dot={{ r: 4, fill: '#2563eb' }} 
                          activeDot={{ r: 6 }} 
                        />
                      )}
                      {showTakeaway && (
                        <Line 
                          type="monotone" 
                          dataKey="takeawaySales" 
                          name="Takeaway" 
                          stroke="#10b981" 
                          strokeWidth={2.5} 
                          dot={{ r: 4, fill: '#10b981' }} 
                          activeDot={{ r: 6 }} 
                        />
                      )}
                      {showFpChannel && (
                        <Line 
                          type="monotone" 
                          dataKey="foodpandaSales" 
                          name="Foodpanda" 
                          stroke="#D70F64" 
                          strokeWidth={2.5} 
                          dot={{ r: 4, fill: '#D70F64' }} 
                          activeDot={{ r: 6 }} 
                        />
                      )}
                    </>
                  )
                )}

                {/* 3. FINANCIALS / P&L MODE */}
                {chartMetricMode === 'FINANCIALS' && (
                  chartStyle === 'BAR' ? (
                    <>
                      {showSales && (
                        <Bar 
                          dataKey="sales" 
                          name="Net Sales" 
                          fill="#2563eb" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                      {showCogs && (
                        <Bar 
                          dataKey="cogs" 
                          name="Food Cost (COGS)" 
                          fill="#f59e0b" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                      {showProfit && (
                        <Bar 
                          dataKey="profit" 
                          name="Kitchen Profit" 
                          fill="#10b981" 
                          radius={[6, 6, 0, 0]} 
                          maxBarSize={activeChartData.length <= 1 ? 80 : 36} 
                        />
                      )}
                    </>
                  ) : (
                    <>
                      {showSales && (
                        <Line 
                          type="monotone" 
                          dataKey="sales" 
                          name="Net Sales" 
                          stroke="#2563eb" 
                          strokeWidth={2.5} 
                          dot={{ r: 4, fill: '#2563eb' }} 
                          activeDot={{ r: 6 }} 
                        />
                      )}
                      {showCogs && (
                        <Line 
                          type="monotone" 
                          dataKey="cogs" 
                          name="Food Cost (COGS)" 
                          stroke="#f59e0b" 
                          strokeWidth={2} 
                          strokeDasharray="4 4" 
                          dot={{ r: 3, fill: '#f59e0b' }} 
                        />
                      )}
                      {showProfit && (
                        <Area 
                          type="monotone" 
                          dataKey="profit" 
                          name="Kitchen Profit" 
                          stroke="#10b981" 
                          strokeWidth={3} 
                          fillOpacity={1} 
                          fill="url(#colorProfit)" 
                        />
                      )}
                    </>
                  )
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SALES CHANNELS & PAYMENT METHODS DONUT */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-6 rounded-2xl shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5">
                {breakdownTab === 'PAYMENTS' ? (
                  <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <PieChartIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                )}
                <h3 className="font-black text-sm text-slate-800 dark:text-slate-100">
                  {breakdownTab === 'PAYMENTS' ? 'Payment Methods' : 'Sales Channels'}
                </h3>
              </div>
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-bold">
                <button
                  onClick={() => setBreakdownTab('PAYMENTS')}
                  className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                    breakdownTab === 'PAYMENTS'
                      ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-300 shadow-2xs font-black'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Payments
                </button>
                <button
                  onClick={() => setBreakdownTab('CHANNELS')}
                  className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
                    breakdownTab === 'CHANNELS'
                      ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-2xs font-black'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Channels
                </button>
              </div>
            </div>

            <p className="text-xs font-medium text-slate-400 mt-0.5">
              {breakdownTab === 'PAYMENTS'
                ? 'Cash, Digital (JazzCash & EasyPaisa) and Foodpanda mix'
                : 'Orders channel distribution (Dine-In, Takeaway, Foodpanda)'}
            </p>
            
            <div className="h-48 w-full min-w-0 overflow-hidden mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie 
                    data={breakdownTab === 'PAYMENTS' ? salesByPayment : salesByChannel} 
                    cx="50%" 
                    cy="50%" 
                    innerRadius={55} 
                    outerRadius={78} 
                    paddingAngle={4} 
                    dataKey="value"
                  >
                    {(breakdownTab === 'PAYMENTS' ? salesByPayment : salesByChannel).map((entry, index) => {
                      const color = entry.color || (breakdownTab === 'PAYMENTS' ? PAYMENT_COLORS[entry.name] : CHANNEL_COLORS[entry.name]) || COLORS[index % COLORS.length];
                      return <Cell key={`cell-${index}`} fill={color} stroke="none" />;
                    })}
                  </Pie>
                  <RechartsTooltip formatter={(value: any) => `Rs. ${Number(value).toFixed(0)}`} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdown List */}
          <div className="space-y-2 pt-4 border-t border-slate-100 dark:border-slate-800">
            {breakdownTab === 'PAYMENTS' ? (
              salesByPayment.length === 0 ? (
                <p className="text-center text-xs font-bold text-slate-400 py-3">No payments recorded in this range.</p>
              ) : (
                salesByPayment.map((entry) => {
                  const pct = metrics.grossSales > 0 ? ((entry.value / metrics.grossSales) * 100).toFixed(0) : '0';
                  return (
                    <div key={entry.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 font-bold text-slate-600 dark:text-slate-300">
                        <div className="w-3 h-3 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: entry.color }}></div>
                        <span>{entry.label || entry.name}</span>
                        <span className="text-[10px] font-bold text-slate-400">({pct}%)</span>
                      </div>
                      <div className="font-black text-slate-800 dark:text-slate-100">
                        Rs. {entry.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  );
                })
              )
            ) : (
              salesByChannel.length === 0 ? (
                <p className="text-center text-xs font-bold text-slate-400 py-3">No channel sales recorded in this range.</p>
              ) : (
                salesByChannel.map((entry, index) => {
                  const color = CHANNEL_COLORS[entry.name] || COLORS[index % COLORS.length];
                  const isFoodpanda = entry.name === 'FOODPANDA';
                  const pct = metrics.grossSales > 0 ? ((entry.value / metrics.grossSales) * 100).toFixed(0) : '0';
                  return (
                    <div key={entry.name} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 font-bold text-slate-600 dark:text-slate-300">
                        <div className="w-3 h-3 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: color }}></div>
                        <span className={isFoodpanda ? 'text-[#D70F64] font-black' : ''}>{entry.name}</span>
                        <span className="text-[10px] font-bold text-slate-400">({pct}%)</span>
                      </div>
                      <div className={`font-black ${isFoodpanda ? 'text-[#D70F64]' : 'text-slate-800 dark:text-slate-100'}`}>
                        Rs. {entry.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  );
                })
              )
            )}
          </div>
        </div>
      </div>

      {/* DEDICATED FOODPANDA INTEGRATION & PAYOUT SETTLEMENT HUB */}
      <div className="bg-gradient-to-br from-pink-50 to-rose-50 dark:from-pink-950/20 dark:to-slate-900 border border-pink-200 dark:border-pink-900/40 p-4 sm:p-6 rounded-2xl shadow-xs flex flex-col gap-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-2 bg-[#D70F64] text-white rounded-xl shadow-xs"><Bike className="w-5 h-5"/></span>
              <h3 className="font-black text-lg text-slate-800 dark:text-slate-100">Foodpanda Settlement &amp; Accrual Hub</h3>
            </div>
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mt-1">
              Independent payout cycle tracking. Accrues all unpaid orders until actual bank deposit is recorded.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isLaptopWriter() && (
              <button 
                onClick={() => setIsFpSettingsOpen(true)}
                className="px-3 py-2 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-pink-200 dark:border-pink-900/50 rounded-xl text-xs font-bold hover:bg-pink-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5 text-[#D70F64]" /> FP Config ({fpConfig.rate}%)
              </button>
            )}
            <button
              onClick={() => setShowPayoutHistory(!showPayoutHistory)}
              className="px-3 py-2 bg-white dark:bg-slate-800 text-[#D70F64] border border-pink-200 dark:border-pink-900/50 rounded-xl text-xs font-bold hover:bg-pink-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <History className="w-3.5 h-3.5" /> 
              {showPayoutHistory ? 'Hide Payout History' : `Payout History (${fpPayoutHistory.length})`}
            </button>
          </div>
        </div>

        {/* 4 INFORMATIC CARDS FOR FOODPANDA */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-pink-200 dark:border-pink-950 shadow-xs flex flex-col justify-between">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Accumulated Cycle Receivable</p>
              <p className="text-2xl font-black text-[#D70F64] mt-1">
                Rs. {Math.round(globalFpCycle.netReceivable).toLocaleString()}
              </p>
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">
                Gross: Rs. {Math.round(globalFpCycle.grossReceivable).toLocaleString()} (-{fpConfig.rate}% Comm)
              </p>
            </div>
            <div className="mt-3">
              {globalFpCycle.netReceivable > 0 ? (
                isLaptopWriter() ? (
                  <button
                    onClick={() => setIsSettlementModalOpen(true)}
                    className="w-full py-2 bg-[#D70F64] hover:bg-[#b00c52] text-white text-xs font-black rounded-lg shadow-sm transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer"
                  >
                    <DollarSign className="w-3.5 h-3.5"/> RECORD BANK PAYOUT
                  </button>
                ) : (
                  <div className="text-center py-1.5 text-xs font-semibold text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                    Settlement counter-only
                  </div>
                )
              ) : (
                <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 justify-center">
                  <CheckCircle2 className="w-3.5 h-3.5" /> All Cycles Settled
                </div>
              )}
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-pink-200 dark:border-pink-950 shadow-xs">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Unpaid Orders in Cycle</p>
            <p className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">
              {globalFpCycle.pendingOrdersCount} <span className="text-sm font-semibold text-slate-400">Orders</span>
            </p>
            <p className="text-[11px] font-bold text-pink-600 mt-1">
              Awaiting next Foodpanda bank transfer
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-pink-200 dark:border-pink-950 shadow-xs">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{timeRange} Foodpanda Sales</p>
            <p className="text-2xl font-black text-slate-800 dark:text-slate-100 mt-1">
              Rs. {Math.round(metrics.windowFpNet).toLocaleString()}
            </p>
            <p className="text-[11px] font-bold text-slate-400 mt-1">
              Gross: Rs. {Math.round(metrics.windowFpGross).toLocaleString()}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-pink-200 dark:border-pink-950 shadow-xs">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Lifetime Payouts Realized</p>
            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
              Rs. {fpPayoutHistory.reduce((sum, p) => sum + Number(p.actual_received || 0), 0).toLocaleString()}
            </p>
            <p className="text-[11px] font-bold text-slate-400 mt-1">
              {fpPayoutHistory.length} Batches Deposited
            </p>
          </div>
        </div>

        {/* PAYMENT-TO-PAYMENT SETTLEMENT HISTORY TABLE */}
        {showPayoutHistory && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-pink-200 dark:border-pink-900/50 overflow-hidden shadow-xs animate-in fade-in">
            <div className="p-4 bg-pink-100/40 dark:bg-pink-950/40 border-b border-pink-200 dark:border-pink-900/50 flex items-center justify-between">
              <span className="font-black text-xs text-slate-800 dark:text-slate-100 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-[#D70F64]" /> Payment-to-Payment Bank Settlement History
              </span>
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {fpPayoutHistory.length} Past Bank Transfers
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <th className="py-2.5 px-4">Payout Date</th>
                    <th className="py-2.5 px-4 text-center">Orders Settled</th>
                    <th className="py-2.5 px-4 text-right">Gross Orders</th>
                    <th className="py-2.5 px-4 text-right">FP Comm.</th>
                    <th className="py-2.5 px-4 text-right">Expected Net</th>
                    <th className="py-2.5 px-4 text-right">Bank Deposit (Actual)</th>
                    <th className="py-2.5 px-4 text-right">Variance / Fees</th>
                    <th className="py-2.5 px-4">Reference #</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {fpPayoutHistory.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400 font-bold">
                        No previous bank settlements recorded yet. Use the &quot;RECORD BANK PAYOUT&quot; button when your transfer arrives!
                      </td>
                    </tr>
                  ) : (
                    fpPayoutHistory.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                        <td className="py-3 px-4 font-bold text-slate-800 dark:text-slate-100">
                          {p.payout_date}
                        </td>
                        <td className="py-3 px-4 text-center font-bold text-slate-600 dark:text-slate-300">
                          {p.orders_count}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-slate-600 dark:text-slate-300">
                          Rs. {Number(p.gross_amount).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-medium text-pink-600">
                          -Rs. {Number(p.commission_amount).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-700 dark:text-slate-200">
                          Rs. {Number(p.expected_net).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-black text-emerald-600 dark:text-emerald-400">
                          Rs. {Number(p.actual_received).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-right font-bold">
                          <span className={p.variance < 0 ? 'text-red-500' : p.variance > 0 ? 'text-emerald-500' : 'text-slate-400'}>
                            {p.variance === 0 ? 'Rs. 0' : `${p.variance > 0 ? '+' : ''}Rs. ${Number(p.variance).toLocaleString()}`}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">
                          {p.reference_no}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* SETTLEMENT MODAL (LAPTOP ONLY) */}
      {isLaptopWriter() && isSettlementModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col max-h-[92vh]">
            <div className="p-4 sm:p-5 bg-gradient-to-r from-[#D70F64] to-pink-700 text-white flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bike className="w-5 h-5 sm:w-6 sm:h-6" />
                <h3 className="font-black text-base sm:text-lg">Record Foodpanda Settlement</h3>
              </div>
              <button onClick={() => setIsSettlementModalOpen(false)} className="text-white/80 hover:text-white font-black text-lg p-1 cursor-pointer">&times;</button>
            </div>

            <div className="p-4 sm:p-6 space-y-3.5 text-xs overflow-y-auto flex-1">
              <div className="bg-pink-50 dark:bg-pink-950/40 border border-pink-200 dark:border-pink-900/60 p-3.5 sm:p-4 rounded-xl space-y-1.5">
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
                  <span>Orders in this Cycle:</span>
                  <span className="font-black text-slate-800 dark:text-slate-100">{globalFpCycle.pendingOrdersCount} Orders</span>
                </div>
                <div className="flex justify-between items-center text-slate-600 dark:text-slate-300">
                  <span>Gross Orders Value:</span>
                  <span className="font-black text-slate-800 dark:text-slate-100">Rs. {Math.round(globalFpCycle.grossReceivable).toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center text-pink-600 dark:text-pink-400">
                  <span>Foodpanda Commission ({fpConfig.rate}%):</span>
                  <span className="font-black">- Rs. {Math.round(globalFpCycle.commissionDeducted).toLocaleString()}</span>
                </div>
                <div className="pt-2 border-t border-pink-200 dark:border-pink-900/60 flex justify-between items-center text-sm font-black text-slate-900 dark:text-slate-100">
                  <span>Expected Bank Deposit:</span>
                  <span className="text-[#D70F64]">Rs. {Math.round(globalFpCycle.netReceivable).toLocaleString()}</span>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                  Actual Amount Deposited in Bank (Rs.) *
                </label>
                <input 
                  type="number" 
                  value={settlementActualReceived} 
                  onChange={e => setSettlementActualReceived(Number(e.target.value))}
                  className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl px-4 py-2.5 text-lg font-black text-emerald-600 dark:text-emerald-400 focus:border-[#D70F64] outline-none"
                  placeholder="e.g. 7000"
                />
                {settlementActualReceived > 0 && (
                  <p className="text-[11px] font-bold mt-1 text-slate-500 dark:text-slate-400">
                    Discrepancy / Bank Fee: <span className={settlementActualReceived - Math.round(globalFpCycle.netReceivable) < 0 ? 'text-red-500' : 'text-emerald-600'}>
                      {settlementActualReceived - Math.round(globalFpCycle.netReceivable) >= 0 ? '+' : ''}
                      Rs. {(settlementActualReceived - Math.round(globalFpCycle.netReceivable)).toLocaleString()}
                    </span>
                  </p>
                )}
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                  Bank Transfer Reference / Transaction ID
                </label>
                <input 
                  type="text" 
                  value={settlementRefNo} 
                  onChange={e => setSettlementRefNo(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2 text-sm font-medium focus:border-[#D70F64] outline-none"
                  placeholder="e.g. HBL-FT-991204"
                />
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                  Bank Statement Deposit Date
                </label>
                <input 
                  type="date" 
                  value={settlementDate} 
                  onChange={e => setSettlementDate(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2 text-sm font-medium focus:border-[#D70F64] outline-none"
                />
              </div>

              <div>
                <label className="font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider block mb-1">
                  Notes (Optional)
                </label>
                <input 
                  type="text" 
                  value={settlementNotes} 
                  onChange={e => setSettlementNotes(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2 text-sm font-medium focus:border-[#D70F64] outline-none"
                  placeholder="e.g. Settled weekly cycle"
                />
              </div>

              <div className="pt-3 flex gap-3">
                <button
                  onClick={() => setIsSettlementModalOpen(false)}
                  className="flex-1 py-3 font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  disabled={isSettling}
                  onClick={handleConfirmSettlement}
                  className="flex-1 py-3 bg-[#D70F64] hover:bg-[#b00c52] text-white font-black text-sm rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {isSettling ? 'RECORDING...' : 'CONFIRM & SETTLE'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FP COMMISSION RATE SETTINGS MODAL (LAPTOP ONLY) */}
      {isLaptopWriter() && isFpSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden p-5 sm:p-6">
            <h3 className="font-black text-base sm:text-lg text-slate-800 dark:text-slate-100 mb-3 sm:mb-4">Foodpanda Commission Settings</h3>
            <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase">System-Wide Commission Rate (%)</label>
            <input 
              type="number" 
              value={tempFpRate} 
              onChange={e => setTempFpRate(Number(e.target.value))} 
              className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl px-4 py-3 text-lg font-black focus:border-[#D70F64] outline-none" 
            />
            <div className="flex justify-end gap-3 mt-5 sm:mt-6">
              <button onClick={() => setIsFpSettingsOpen(false)} className="px-4 py-2 rounded-lg font-bold text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer">CANCEL</button>
              <button onClick={handleUpdateFpConfig} className="bg-[#D70F64] hover:bg-[#b00c52] text-white font-black py-2 px-6 rounded-lg shadow-md transition-all active:scale-95 cursor-pointer">SAVE SETTINGS</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
