"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { adminCache, CACHE_TTL } from "@/lib/admin-cache";
import { 
  Printer, Calendar, DollarSign, TrendingUp, TrendingDown, 
  BarChart3, PieChart as PieChartIcon, ShoppingBag, Receipt, 
  Wallet, RefreshCw, CheckCircle2, ChevronLeft, ChevronRight, Download,
  Layers, AlertCircle, ArrowUpRight, ArrowDownRight, Clock
} from "lucide-react";
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, 
  Tooltip, PieChart, Pie, Cell, BarChart, Bar, CartesianGrid 
} from "recharts";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { modal } from "@/lib/modalStore";
import { isNetworkAvailable } from "@/lib/sync-engine";
import { isLaptopWriter } from "@/lib/device-mode";
import { loadCostLookupData, computeItemCogsFromLookup } from "@/lib/inventory-service";
import { posBus } from "@/lib/broadcast-bus";
import { 
  FinancialReportData, 
  ReportItemMix, 
  print80mmFinancialReport, 
  generateThermal80mmReportHtml 
} from "@/lib/thermal-reports";

export type TimeframeMode = 
  | 'TODAY' 
  | 'YESTERDAY' 
  | 'SINGLE_DAY' 
  | 'THIS_MONTH' 
  | 'LAST_MONTH' 
  | 'CUSTOM';

const PAYMENT_COLORS: { [key: string]: string } = {
  Cash: '#10b981',
  Card: '#3b82f6',
  JazzCash: '#f59e0b',
  EasyPaisa: '#8b5cf6',
  Foodpanda: '#ec4899',
  'Foodpanda (70% Net)': '#ec4899',
  Other: '#64748b'
};

interface AdminFinancialReportsProps {
  isActive?: boolean;
  refreshTrigger?: number;
}

export default function AdminFinancialReports({ isActive, refreshTrigger }: AdminFinancialReportsProps = {}) {
  const [timeframe, setTimeframe] = useState<TimeframeMode>('TODAY');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(new Date().toISOString().split('T')[0]);
  
  const [isLoading, setIsLoading] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);
  const [activeReportTab, setActiveReportTab] = useState<'OVERVIEW' | 'SALES_MIX' | 'EXPENSES'>('OVERVIEW');
  const [previewModalOpen, setPreviewModalOpen] = useState(false);

  // Raw fetched datasets
  const [rawOrders, setRawOrders] = useState<any[]>([]);
  const [rawExpenses, setRawExpenses] = useState<any[]>([]);
  const [rawShifts, setRawShifts] = useState<any[]>([]);

  // Compute ISO date range for selected timeframe
  const dateRange = useMemo(() => {
    const now = new Date();
    let start = new Date();
    let end = new Date();

    if (timeframe === 'TODAY') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (timeframe === 'YESTERDAY') {
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (timeframe === 'SINGLE_DAY') {
      const parts = selectedDate.split('-').map(Number);
      start = new Date(parts[0], parts[1] - 1, parts[2], 0, 0, 0, 0);
      end = new Date(parts[0], parts[1] - 1, parts[2], 23, 59, 59, 999);
    } else if (timeframe === 'THIS_MONTH') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    } else if (timeframe === 'LAST_MONTH') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    } else if (timeframe === 'CUSTOM') {
      const sParts = startDate.split('-').map(Number);
      const eParts = endDate.split('-').map(Number);
      start = new Date(sParts[0], sParts[1] - 1, sParts[2], 0, 0, 0, 0);
      end = new Date(eParts[0], eParts[1] - 1, eParts[2], 23, 59, 59, 999);
    }

    return {
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      displayLabel: timeframe === 'TODAY' 
        ? `Today (${start.toLocaleDateString('en-GB')})`
        : timeframe === 'YESTERDAY'
        ? `Yesterday (${start.toLocaleDateString('en-GB')})`
        : timeframe === 'SINGLE_DAY'
        ? `Day: ${start.toLocaleDateString('en-GB')}`
        : timeframe === 'THIS_MONTH'
        ? `This Month (${start.toLocaleString('default', { month: 'long', year: 'numeric' })})`
        : timeframe === 'LAST_MONTH'
        ? `Last Month (${start.toLocaleString('default', { month: 'long', year: 'numeric' })})`
        : `${start.toLocaleDateString('en-GB')} to ${end.toLocaleDateString('en-GB')}`
    };
  }, [timeframe, selectedDate, startDate, endDate]);

  const reportsDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const getReportCacheKey = () => {
    return `reports_${timeframe}_${selectedDate}_${startDate}_${endDate}`;
  };

  const handleStepSingleDay = (days: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    const yStr = dt.getFullYear();
    const mStr = String(dt.getMonth() + 1).padStart(2, '0');
    const dStr = String(dt.getDate()).padStart(2, '0');
    const nextDate = `${yStr}-${mStr}-${dStr}`;
    setTimeframe('SINGLE_DAY');
    setSelectedDate(nextDate);

    const key = `reports_SINGLE_DAY_${nextDate}_${startDate}_${endDate}`;
    const cached = adminCache.get<{ orders: any[]; shifts: any[]; expenses: any[] }>(key);
    if (cached) {
      setRawOrders(cached.orders);
      setRawShifts(cached.shifts);
      setRawExpenses(cached.expenses);
      setIsLoading(false);
    }
  };

  // Load report data from local Dexie + cloud with SWR caching
  const loadReportData = async (showSpinner = true, forceBypassCache = false) => {
    const key = getReportCacheKey();
    const isLive = timeframe === 'TODAY';
    const cached = adminCache.get<{ orders: any[]; shifts: any[]; expenses: any[] }>(
      key, 
      isLive ? CACHE_TTL.LIVE_TODAY : CACHE_TTL.HISTORIC_DATE
    );

    if (cached && !forceBypassCache) {
      setRawOrders(cached.orders);
      setRawShifts(cached.shifts);
      setRawExpenses(cached.expenses);
      setIsLoading(false);
      return;
    } else if (showSpinner) {
      setIsLoading(true);
    }

    const { startISO, endISO } = dateRange;

    try {
      // 1. Instant local Dexie load with dynamic COGS enrichment
      const [localOrders, localShifts, localExpenses, lookup] = await Promise.all([
        db.orders.toArray(),
        db.shifts.toArray(),
        db.expenses.toArray(),
        loadCostLookupData()
      ]);

      const filteredLocalOrders = localOrders.filter(o => o.created_at >= startISO && o.created_at <= endISO);
      const filteredLocalShifts = localShifts.filter(s => s.opened_at >= startISO && s.opened_at <= endISO);
      const filteredLocalExpenses = localExpenses.filter(e => e.created_at >= startISO && e.created_at <= endISO);

      const enrichedLocalOrders = filteredLocalOrders.map(o => ({
        ...o,
        items: (o.items || []).map((it: any) => ({
          ...it,
          cogs_total: computeItemCogsFromLookup(it, lookup)
        }))
      }));

      if (!cached) {
        setRawOrders(enrichedLocalOrders);
        setRawShifts(filteredLocalShifts);
        setRawExpenses(filteredLocalExpenses);
      }

      // 2. If phone viewer and online, fetch complete cloud mirror data
      if (!isLaptopWriter() && isNetworkAvailable()) {
        const [cloudOrdersRes, cloudItemsRes, cloudExpRes, cloudShiftsRes] = await Promise.all([
          supabase.from('orders')
            .select('*')
            .gte('created_at', startISO)
            .lte('created_at', endISO)
            .order('created_at', { ascending: false }),
          supabase.from('order_items')
            .select('*'),
          supabase.from('expenses')
            .select('*')
            .gte('created_at', startISO)
            .lte('created_at', endISO)
            .order('created_at', { ascending: false }),
          supabase.from('cashier_shifts')
            .select('*')
            .gte('opened_at', startISO)
            .lte('opened_at', endISO)
        ]);

        let finalOrders = filteredLocalOrders;
        let finalExpenses = filteredLocalExpenses;
        let finalShifts = filteredLocalShifts;

        if (cloudOrdersRes.data && cloudOrdersRes.data.length > 0) {
          const itemsByOrder: { [orderId: string]: any[] } = {};
          (cloudItemsRes.data || []).forEach((item: any) => {
            if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
            itemsByOrder[item.order_id].push(item);
          });

          finalOrders = ((cloudOrdersRes.data || []) as any[]).map((o: any) => ({
            ...o,
            items: itemsByOrder[o.id] || []
          }));
          setRawOrders(finalOrders);
        }

        if (cloudExpRes.data) {
          finalExpenses = cloudExpRes.data;
          setRawExpenses(finalExpenses);
        }

        if (cloudShiftsRes.data) {
          finalShifts = cloudShiftsRes.data;
          setRawShifts(finalShifts);
        }

        // Cache the combined cloud data for instant retrieval
        adminCache.set(key, {
          orders: finalOrders,
          shifts: finalShifts,
          expenses: finalExpenses
        });
      }
    } catch (err) {
      console.error("[Reports] Error loading financial report data:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const key = getReportCacheKey();
    const cached = adminCache.get<{ orders: any[]; shifts: any[]; expenses: any[] }>(key);
    if (cached) {
      setRawOrders(cached.orders);
      setRawShifts(cached.shifts);
      setRawExpenses(cached.expenses);
      setIsLoading(false);
      return;
    }

    if (reportsDebounceRef.current) clearTimeout(reportsDebounceRef.current);
    reportsDebounceRef.current = setTimeout(() => {
      loadReportData(true, false);
    }, 60);

    return () => {
      if (reportsDebounceRef.current) clearTimeout(reportsDebounceRef.current);
    };
  }, [dateRange]);

  // Realtime Event Subscription: Auto-refetch when orders, expenses, or shifts change
  useEffect(() => {
    const unsub = posBus.subscribe((msg) => {
      if (
        msg.type === 'EXPENSE_LOGGED' ||
        msg.type === 'SHIFT_CLOSED' ||
        msg.type === 'ORDER_CREATED' ||
        msg.type === 'ORDER_COMPLETED' ||
        msg.type === 'ORDER_UPDATED' ||
        msg.type === 'ORDER_CANCELLED' ||
        msg.type === 'STOCK_UPDATED' ||
        msg.type === 'MANUAL_REFRESH' ||
        (msg.type === 'ADMIN_TAB_SELECTED' && msg.tab === 'REPORTS')
      ) {
        adminCache.invalidate(getReportCacheKey());
        loadReportData(false, true);
      }
    });
    return () => unsub();
  }, [dateRange, timeframe]);

  // Direct prop-driven refresh from top executive header
  useEffect(() => {
    if (refreshTrigger) {
      adminCache.invalidate(getReportCacheKey());
      loadReportData(true, true);
    }
  }, [refreshTrigger, dateRange, timeframe]);

  // Auto-refresh when report tab is made active
  useEffect(() => {
    if (isActive) {
      adminCache.invalidate(getReportCacheKey());
      loadReportData(false, true);
    }
  }, [isActive]);

  // Aggregate metrics and report calculations
  const reportData: FinancialReportData = useMemo(() => {
    let grossSales = 0;
    let discounts = 0;
    let netSales = 0;
    let totalCogs = 0;

    let cashSales = 0;
    let cardSales = 0;
    let jazzcashSales = 0;
    let easypaisaSales = 0;
    let foodpandaGross = 0;
    let foodpandaNet = 0;

    const itemMixMap: { [name: string]: ReportItemMix } = {};

    rawOrders.forEach(o => {
      // Exclude voided / cancelled orders
      if (o.status === 'CANCELLED' || o.status === 'VOID') return;

      const orderSub = Number(o.subtotal || 0);
      const orderDisc = Number(o.discount || 0);
      const orderNet = Number(o.net_total || 0);

      grossSales += orderSub;
      discounts += orderDisc;

      // Payment breakdowns & Foodpanda 70% Net Revenue
      const method = (o.payment_method || '').toUpperCase();
      const isFoodpanda = o.order_type === 'FOODPANDA' || method.includes('FOODPANDA');

      if (isFoodpanda) {
        foodpandaGross += orderNet;
        const commPct = Number(o.foodpanda_commission_pct || 30);
        const netAfterCommission = orderNet * (1 - commPct / 100);
        foodpandaNet += netAfterCommission;
        // Count 70% Net Revenue towards total net sales so gross profit and margin use (70% Net - COGS)
        netSales += netAfterCommission;
      } else {
        netSales += orderNet;
        if (method === 'CASH') {
          cashSales += orderNet;
        } else if (method === 'CARD') {
          cardSales += orderNet;
        } else if (method.includes('JAZZ')) {
          jazzcashSales += orderNet;
        } else if (method.includes('EASY')) {
          easypaisaSales += orderNet;
        } else {
          cashSales += orderNet;
        }
      }

      // Order Items mix & COGS
      const items = Array.isArray(o.items) ? o.items : [];
      items.forEach((item: any) => {
        const itemName = item.item_name || 'Item';
        const qty = Number(item.quantity || 1);
        const itemPrice = Number(item.total_price || (item.unit_price * qty) || 0);
        const itemCogs = Number(item.cogs_total || 0);

        totalCogs += itemCogs;

        // Foodpanda item revenue after 30% commission
        const effectiveItemRevenue = isFoodpanda ? itemPrice * 0.7 : itemPrice;

        if (!itemMixMap[itemName]) {
          itemMixMap[itemName] = {
            name: itemName,
            quantity: 0,
            revenue: 0,
            cogs: 0,
            profit: 0
          };
        }
        itemMixMap[itemName].quantity += qty;
        itemMixMap[itemName].revenue += effectiveItemRevenue;
        itemMixMap[itemName].cogs += itemCogs;
        itemMixMap[itemName].profit += (effectiveItemRevenue - itemCogs);
      });
    });

    // Expenses aggregation: clearly differentiate shift drawer payouts vs general overheads
    const expensesByCategory: { [cat: string]: number } = {};
    let totalExpenses = 0;
    let drawerExpenses = 0;
    let overheadExpenses = 0;

    rawExpenses.forEach(e => {
      const amount = Number(e.amount || 0);
      const cat = e.category || 'Misc';
      expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amount;
      totalExpenses += amount;
      const isDrawer = Boolean(
        (e.category && e.category.toLowerCase().includes('drawer')) || 
        (e.description && e.description.toLowerCase().includes('[shift drawer]'))
      );
      if (isDrawer) {
        drawerExpenses += amount;
      } else {
        overheadExpenses += amount;
      }
    });

    // Financial Profitability
    const grossProfit = netSales - totalCogs;
    const grossMarginPct = netSales > 0 ? Number(((grossProfit / netSales) * 100).toFixed(1)) : 0;
    const netProfit = grossProfit - totalExpenses;
    const netMarginPct = netSales > 0 ? Number(((netProfit / netSales) * 100).toFixed(1)) : 0;
    const totalOrders = rawOrders.length;
    const avgTicketSize = totalOrders > 0 ? Math.round(netSales / totalOrders) : 0;

    // Cash Drawer Reconciliation (strictly uses direct shift drawer payouts)
    let openingCash = 0;
    let actualCounted = 0;
    if (rawShifts.length > 0) {
      openingCash = rawShifts.reduce((sum, s) => sum + Number(s.starting_cash || 0), 0);
      actualCounted = rawShifts.reduce((sum, s) => sum + Number(s.actual_cash || 0), 0);
    }
    const expectedDrawerCash = openingCash + cashSales - drawerExpenses;
    const variance = actualCounted > 0 ? (actualCounted - expectedDrawerCash) : 0;

    // Top selling items sorted by quantity sold & revenue
    const topSellingItems = Object.values(itemMixMap).sort((a, b) => b.quantity - a.quantity);

    let reportTitle = "FINANCIAL SUMMARY REPORT";
    if (timeframe === 'TODAY' || timeframe === 'YESTERDAY' || timeframe === 'SINGLE_DAY') {
      reportTitle = "DAILY CLOSING REPORT (Z-REPORT)";
    } else if (timeframe === 'THIS_MONTH' || timeframe === 'LAST_MONTH') {
      reportTitle = "MONTHLY P&L FINANCIAL REPORT";
    }

    return {
      title: reportTitle,
      periodLabel: dateRange.displayLabel,
      generatedAt: new Date().toLocaleString('en-GB'),
      generatedBy: "Store Manager",
      totalOrders,
      grossSales,
      discounts,
      netSales,
      avgTicketSize,
      paymentMethods: {
        cash: cashSales,
        card: cardSales,
        jazzcash: jazzcashSales,
        easypaisa: easypaisaSales,
        foodpandaGross,
        foodpandaNet
      },
      expensesByCategory,
      totalExpenses,
      drawerExpenses,
      overheadExpenses,
      totalCogs,
      grossProfit,
      grossMarginPct,
      netProfit,
      netMarginPct,
      cashDrawer: {
        openingCash,
        cashSales,
        cashExpenses: drawerExpenses,
        expectedCash: expectedDrawerCash,
        actualCash: actualCounted > 0 ? actualCounted : undefined,
        variance: actualCounted > 0 ? variance : undefined
      },
      topSellingItems
    };
  }, [rawOrders, rawExpenses, rawShifts, dateRange, timeframe]);

  // Chart data: Daily trend
  const dailyTrendData = useMemo(() => {
    const daysMap: { [day: string]: { date: string; sales: number; orders: number } } = {};
    rawOrders.forEach(o => {
      const day = new Date(o.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
      if (!daysMap[day]) daysMap[day] = { date: day, sales: 0, orders: 0 };
      const method = (o.payment_method || '').toUpperCase();
      const isFp = o.order_type === 'FOODPANDA' || method.includes('FOODPANDA');
      const orderNet = Number(o.net_total || 0);
      const effectiveSales = isFp ? orderNet * (1 - (Number(o.foodpanda_commission_pct || 30) / 100)) : orderNet;
      daysMap[day].sales += effectiveSales;
      daysMap[day].orders += 1;
    });
    return Object.values(daysMap);
  }, [rawOrders]);

  // Chart data: Payment breakdown
  const paymentChartData = useMemo(() => {
    const pm = reportData.paymentMethods;
    return [
      { name: 'Cash', value: pm.cash },
      { name: 'Card', value: pm.card },
      { name: 'JazzCash', value: pm.jazzcash },
      { name: 'EasyPaisa', value: pm.easypaisa },
      { name: 'Foodpanda (70% Net)', value: pm.foodpandaNet },
    ].filter(p => p.value > 0);
  }, [reportData.paymentMethods]);

  // Handle thermal print
  const handlePrintThermalReport = () => {
    setIsPrinting(true);
    try {
      print80mmFinancialReport(reportData);
      modal.toast.success("Financial report sent to 80mm thermal printer!");
    } catch (err: any) {
      console.error("Print error:", err);
      modal.toast.error("Printer communication failed: " + (err.message || 'Check USB connection'));
    } finally {
      setIsPrinting(false);
    }
  };

  // Save report snapshot
  const handleSaveSnapshot = async () => {
    try {
      const snapshot = {
        title: reportData.title,
        period: reportData.periodLabel,
        netSales: reportData.netSales,
        totalExpenses: reportData.totalExpenses,
        netProfit: reportData.netProfit,
        ordersCount: reportData.totalOrders,
        createdAt: new Date().toISOString()
      };

      if (typeof window !== 'undefined') {
        localStorage.setItem(`report_snapshot_${Date.now()}`, JSON.stringify(snapshot));
      }

      modal.toast.success("Report snapshot saved permanently to local ledger.");
    } catch (err: any) {
      modal.toast.error("Failed to save snapshot: " + err.message);
    }
  };

  return (
    <div className="flex flex-col gap-5 pb-16 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* ==================== TOP CONTROLS & TIMEFRAME HEADER ==================== */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3 sm:p-4 shadow-xs flex flex-col gap-2.5">
        {/* ROW 1: Title & Action Buttons (Preview, Print, Download, Refresh) */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center p-1.5 border border-blue-200 dark:border-blue-800 shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100 tracking-tight truncate">
                Financial Reports
              </h2>
            </div>
          </div>

          {/* Action Buttons: Preview Slip, 80mm Print, Snapshot, Refresh */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              onClick={() => setPreviewModalOpen(true)}
              className="p-1.5 sm:px-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-200 font-bold text-[11px] transition-all cursor-pointer shadow-xs flex items-center gap-1"
              title="Preview 80mm Receipt Slip"
            >
              <Receipt className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span className="hidden sm:inline">Preview</span>
            </button>
            {isLaptopWriter() && (
              <button
                onClick={handlePrintThermalReport}
                disabled={isPrinting}
                className="p-1.5 sm:px-3 rounded-xl bg-slate-900 hover:bg-black dark:bg-blue-600 dark:hover:bg-blue-700 text-white font-black text-[11px] tracking-wider transition-all shadow-md active:scale-95 cursor-pointer disabled:opacity-50 flex items-center gap-1"
                title="Print 80mm ESC/POS Thermal Receipt"
              >
                <Printer className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Print 80mm</span>
              </button>
            )}
            <button
              onClick={handleSaveSnapshot}
              className="p-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 cursor-pointer transition-colors"
              title="Save Snapshot to Cloud & Local Audit Ledger"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => loadReportData(true, true)}
              disabled={isLoading}
              className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-all cursor-pointer shadow-2xs active:scale-95 disabled:opacity-50"
              title="Force Refresh Report Data"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-600 dark:text-blue-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* ROW 2: Timeframe Selector Pills & Date Stepper (Single Row, Zero Wrapping) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 w-full">
          {/* TIMEFRAME SELECTOR PILLS */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] shrink-0">
            <button
              onClick={() => setTimeframe('TODAY')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                timeframe === 'TODAY'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-bold'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setTimeframe('YESTERDAY')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                timeframe === 'YESTERDAY'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-bold'
              }`}
            >
              Yesterday
            </button>
            <button
              onClick={() => setTimeframe('SINGLE_DAY')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                timeframe === 'SINGLE_DAY'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-bold'
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setTimeframe('THIS_MONTH')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                timeframe === 'THIS_MONTH'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-bold'
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setTimeframe('LAST_MONTH')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                timeframe === 'LAST_MONTH'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-bold'
              }`}
            >
              Last Month
            </button>
            <button
              onClick={() => setTimeframe('CUSTOM')}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                timeframe === 'CUSTOM'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-bold'
              }`}
            >
              Custom
            </button>
          </div>

          {/* Dynamic Timeline Date Stepper for SINGLE_DAY */}
          {timeframe === 'SINGLE_DAY' && (
            <div className="flex items-center gap-0.5 bg-white dark:bg-slate-800 px-1.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs shrink-0">
              <button
                onClick={() => handleStepSingleDay(-1)}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title="Previous Day"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <div className="flex items-center gap-1 px-1">
                <Calendar className="w-3 h-3 text-blue-600 dark:text-blue-400 shrink-0" />
                <input
                  type="date"
                  value={selectedDate}
                  onChange={e => setSelectedDate(e.target.value)}
                  className="bg-transparent text-[11px] font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer w-[105px]"
                />
              </div>
              <button
                onClick={() => handleStepSingleDay(1)}
                className="p-1 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                title="Next Day"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Custom Date Range Picker for CUSTOM */}
          {timeframe === 'CUSTOM' && (
            <div className="flex items-center gap-1.5 bg-white dark:bg-slate-800 px-2 py-1 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs shrink-0">
              <input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="bg-transparent text-[11px] font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer w-[100px]"
              />
              <span className="text-slate-400 text-[10px] font-black">to</span>
              <input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="bg-transparent text-[11px] font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer w-[100px]"
              />
            </div>
          )}
        </div>
      </div>

      {/* ==================== EXECUTIVE FINANCIAL KPI CARDS ==================== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {/* Net Sales */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-xs">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Net Sales</p>
          <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100 mt-1">
            Rs. {Math.round(reportData.netSales).toLocaleString()}
          </p>
          <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 mt-0.5 block">
            {reportData.totalOrders} Orders Sold
          </span>
        </div>

        {/* COGS */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-xs">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Cost of Goods (COGS)</p>
          <p className="text-lg sm:text-xl font-black text-red-600 dark:text-red-400 mt-1">
            Rs. {Math.round(reportData.totalCogs).toLocaleString()}
          </p>
          <span className="text-[10px] font-bold text-slate-400 mt-0.5 block">
            {reportData.netSales > 0 ? ((reportData.totalCogs / reportData.netSales) * 100).toFixed(1) : '0'}% Food Cost
          </span>
        </div>

        {/* Gross Profit */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-xs">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Gross Operating Profit</p>
          <p className="text-lg sm:text-xl font-black text-blue-600 dark:text-blue-400 mt-1">
            Rs. {Math.round(reportData.grossProfit).toLocaleString()}
          </p>
          <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 mt-0.5 block">
            {reportData.grossMarginPct}% Gross Margin
          </span>
        </div>

        {/* Total Expenses */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-xs">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Operating Expenses</p>
          <p className="text-lg sm:text-xl font-black text-amber-600 dark:text-amber-400 mt-1">
            Rs. {Math.round(reportData.totalExpenses).toLocaleString()}
          </p>
          <span className="text-[10px] font-bold text-slate-400 mt-0.5 block">
            {Object.keys(reportData.expensesByCategory).length} Categories
          </span>
        </div>

        {/* Net Profit */}
        <div className={`border rounded-2xl p-3.5 shadow-xs ${
          reportData.netProfit >= 0 
            ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60' 
            : 'bg-red-50/60 dark:bg-red-950/20 border-red-200 dark:border-red-800/60'
        }`}>
          <p className={`text-[10px] font-black uppercase tracking-wider ${
            reportData.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
          }`}>Net Bottomline Profit</p>
          <p className={`text-lg sm:text-xl font-black mt-1 ${
            reportData.netProfit >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'
          }`}>
            Rs. {Math.round(reportData.netProfit).toLocaleString()}
          </p>
          <span className={`text-[10px] font-black mt-0.5 block ${
            reportData.netProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }`}>
            {reportData.netMarginPct}% Net Margin
          </span>
        </div>

        {/* Expected Cash in Register */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-3.5 shadow-xs">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Cash in Register</p>
          <p className="text-lg sm:text-xl font-black text-slate-900 dark:text-slate-100 mt-1">
            Rs. {Math.round(reportData.cashDrawer?.expectedCash || reportData.paymentMethods.cash).toLocaleString()}
          </p>
          <span className="text-[10px] font-bold text-slate-400 mt-0.5 block">
            Avg: Rs. {reportData.avgTicketSize} / order
          </span>
        </div>
      </div>

      {/* ==================== VISUAL CHARTS ROW ==================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Sales Trend Chart (7 cols) */}
        <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-800 dark:text-slate-100">
                Revenue &amp; Sales Trajectory
              </h3>
              <p className="text-[11px] font-semibold text-slate-400">Order timeline volume during period</p>
            </div>
            <span className="text-xs font-black text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800">
              Rs. {Math.round(reportData.netSales).toLocaleString()} Total
            </span>
          </div>

          <div className="h-[220px] w-full min-w-0 overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrendData.length > 0 ? dailyTrendData : [{ date: 'Today', sales: reportData.netSales, orders: 1 }]}>
                <defs>
                  <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} tickFormatter={(v) => `Rs.${v}`} />
                <Tooltip 
                  formatter={(val: any) => [`Rs. ${Number(val).toLocaleString()}`, 'Revenue']}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff' }}
                />
                <Area type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#salesGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Payment Channels Breakdown (5 cols) */}
        <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col justify-between">
          <div>
            <h3 className="font-black text-sm sm:text-base text-slate-800 dark:text-slate-100">
              Payment Settlement Distribution
            </h3>
            <p className="text-[11px] font-semibold text-slate-400">Cash vs Cards vs QR &amp; Foodpanda</p>
          </div>

          <div className="h-[180px] w-full min-w-0 overflow-hidden flex items-center justify-center my-2">
            {paymentChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={paymentChartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {paymentChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={PAYMENT_COLORS[entry.name] || '#64748b'} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(val: any) => [`Rs. ${Number(val).toLocaleString()}`, 'Amount']}
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '12px', color: '#fff' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="text-xs font-bold text-slate-400">No payment records in selected period</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {paymentChartData.map(p => (
              <div key={p.name} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <span className="flex items-center gap-1.5 font-bold text-slate-600 dark:text-slate-300">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: PAYMENT_COLORS[p.name] || '#64748b' }} />
                  {p.name}
                </span>
                <span className="font-black text-slate-900 dark:text-slate-100">
                  Rs. {Math.round(p.value).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ==================== SEGMENTED DETAILS SECTION (SALES MIX & EXPENSES) ==================== */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs">
        {/* Navigation Tabs */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveReportTab('OVERVIEW')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeReportTab === 'OVERVIEW'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Settlement Channels ({paymentChartData.length})
            </button>
            <button
              onClick={() => setActiveReportTab('SALES_MIX')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeReportTab === 'SALES_MIX'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Hot-Selling Menu Mix ({reportData.topSellingItems.length})
            </button>
            <button
              onClick={() => setActiveReportTab('EXPENSES')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                activeReportTab === 'EXPENSES'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-300 shadow-xs'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Expenses Breakdown ({rawExpenses.length})
            </button>
          </div>
          <span className="text-[11px] font-bold text-slate-400 hidden sm:inline">
            Period: {reportData.periodLabel}
          </span>
        </div>

        {/* Tab 1: OVERVIEW / SETTLEMENTS */}
        {activeReportTab === 'OVERVIEW' && (
          <div className="p-4 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h4 className="font-black text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Reconciliation &amp; Float
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <span className="text-slate-500">Opening Cash Float:</span>
                  <span className="font-black text-slate-900 dark:text-slate-100">
                    Rs. {Math.round(reportData.cashDrawer?.openingCash || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <span className="text-slate-500">+ Cash Sales Inflow:</span>
                  <span className="font-black text-emerald-600 dark:text-emerald-400">
                    +Rs. {Math.round(reportData.cashDrawer?.cashSales || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <span className="text-slate-500">- Drawer Cash Payouts:</span>
                  <span className="font-black text-red-600 dark:text-red-400">
                    -Rs. {Math.round(reportData.cashDrawer?.cashExpenses || 0).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-sm font-black">
                  <span className="text-blue-950 dark:text-blue-200">EXPECTED DRAWER CASH:</span>
                  <span className="text-blue-700 dark:text-blue-300">
                    Rs. {Math.round(reportData.cashDrawer?.expectedCash || 0).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="font-black text-xs text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Foodpanda Third-Party Settlement
              </h4>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <span className="text-slate-500">Foodpanda Gross Orders:</span>
                  <span className="font-black text-slate-900 dark:text-slate-100">
                    Rs. {Math.round(reportData.paymentMethods.foodpandaGross).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800">
                  <span className="text-slate-500">Est. Commission &amp; Deductions:</span>
                  <span className="font-black text-red-600 dark:text-red-400">
                    -Rs. {Math.round(reportData.paymentMethods.foodpandaGross - reportData.paymentMethods.foodpandaNet).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between p-3 rounded-xl bg-pink-50 dark:bg-pink-950/40 border border-pink-200 dark:border-pink-800 text-sm font-black">
                  <span className="text-pink-950 dark:text-pink-200">FOODPANDA NET RECEIVABLE:</span>
                  <span className="text-pink-700 dark:text-pink-300">
                    Rs. {Math.round(reportData.paymentMethods.foodpandaNet).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: SALES MIX & HOT SELLING ITEMS */}
        {activeReportTab === 'SALES_MIX' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-100 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-[10px] font-black uppercase text-slate-400">
                <tr>
                  <th className="py-3 px-4">Rank &amp; Item</th>
                  <th className="py-3 px-4 text-center">Volume Sold</th>
                  <th className="py-3 px-4 text-right">Revenue (Rs.)</th>
                  <th className="py-3 px-4 text-right">COGS (Rs.)</th>
                  <th className="py-3 px-4 text-right">Gross Profit</th>
                  <th className="py-3 px-4 text-right">Margin %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-bold">
                {reportData.topSellingItems.map((item, idx) => {
                  const margin = item.revenue > 0 ? ((item.profit / item.revenue) * 100).toFixed(1) : '0';
                  return (
                    <tr key={item.name} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 flex items-center justify-center text-[10px] font-black">
                            {idx + 1}
                          </span>
                          <span className="font-black text-slate-800 dark:text-slate-100">{item.name}</span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-black text-blue-600 dark:text-blue-400">
                        {item.quantity} units
                      </td>
                      <td className="py-3 px-4 text-right font-black text-slate-900 dark:text-slate-100">
                        Rs. {Math.round(item.revenue).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-red-600 dark:text-red-400">
                        Rs. {Math.round(item.cogs).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-emerald-600 dark:text-emerald-400 font-black">
                        Rs. {Math.round(item.profit).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                          Number(margin) >= 50 
                            ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' 
                            : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                        }`}>
                          {margin}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: EXPENSES LIST */}
        {activeReportTab === 'EXPENSES' && (
          <div className="p-4 sm:p-5 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50">
                <span className="text-[10px] font-black uppercase text-amber-700 dark:text-amber-400">Shift Drawer Cash Payouts</span>
                <p className="text-base font-black text-amber-800 dark:text-amber-300 mt-0.5">
                  Rs. {Math.round(reportData.drawerExpenses || 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-amber-600/80 dark:text-amber-400/80">Paid directly out of counter drawer float</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] font-black uppercase text-slate-500 dark:text-slate-400">General Overheads</span>
                <p className="text-base font-black text-slate-800 dark:text-slate-100 mt-0.5">
                  Rs. {Math.round(reportData.overheadExpenses || 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-400">Rent, utilities, off-book vendor supplies</p>
              </div>
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50">
                <span className="text-[10px] font-black uppercase text-red-600 dark:text-red-400">Total Operating Expenses</span>
                <p className="text-base font-black text-red-700 dark:text-red-300 mt-0.5">
                  Rs. {Math.round(reportData.totalExpenses || 0).toLocaleString()}
                </p>
                <p className="text-[10px] text-red-600/80 dark:text-red-400/80">All operating deductions</p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs divide-y divide-slate-100 dark:divide-slate-800">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-[10px] font-black uppercase text-slate-400">
                  <tr>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Type &amp; Category</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">Officer</th>
                    <th className="py-3 px-4 text-right">Amount (Rs.)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-bold">
                  {rawExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">No expenses recorded for this timeframe</td>
                    </tr>
                  ) : (
                    rawExpenses.map((exp) => {
                      const isDrawer = Boolean(
                        (exp.category && exp.category.toLowerCase().includes('drawer')) || 
                        (exp.description && exp.description.toLowerCase().includes('[shift drawer]'))
                      );
                      return (
                        <tr key={exp.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4 text-slate-500">
                            {new Date(exp.created_at).toLocaleDateString('en-GB')}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {isDrawer ? (
                                <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-black border border-amber-500/30">
                                  Drawer Payout
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-black border border-slate-200 dark:border-slate-700">
                                  Overhead
                                </span>
                              )}
                              <span className="text-xs text-slate-700 dark:text-slate-200 font-bold">{exp.category}</span>
                            </div>
                          </td>
                          <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                            {exp.description || '—'}
                          </td>
                          <td className="py-3 px-4 text-slate-500">
                            {exp.logged_by || 'Admin'}
                          </td>
                          <td className="py-3 px-4 text-right font-black text-red-600 dark:text-red-400">
                            Rs. {Math.round(exp.amount).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ==================== 80MM THERMAL SLIP PREVIEW MODAL ==================== */}
      {previewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[92vh] overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/60">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                <h3 className="font-black text-sm text-slate-800 dark:text-slate-100">
                  80mm Thermal Receipt Slip Preview
                </h3>
              </div>
              <button onClick={() => setPreviewModalOpen(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                ✕
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 bg-slate-100 dark:bg-slate-950 flex justify-center">
              <div 
                className="bg-white text-black p-4 rounded-xl shadow-lg font-mono text-xs w-[320px] max-w-full leading-snug border border-slate-200"
                dangerouslySetInnerHTML={{ __html: generateThermal80mmReportHtml(reportData) }}
              />
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex gap-2">
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 font-bold text-xs cursor-pointer text-slate-700 dark:text-slate-300"
              >
                Close Preview
              </button>
              <button
                onClick={() => {
                  handlePrintThermalReport();
                  setPreviewModalOpen(false);
                }}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-xs cursor-pointer shadow-md"
              >
                Print 80mm Slip
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

