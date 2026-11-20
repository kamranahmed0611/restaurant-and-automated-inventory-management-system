"use client";

import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { db } from "@/lib/db";
import { modal } from "@/lib/modalStore";
import { adminCache, CACHE_TTL } from "@/lib/admin-cache";
import { isNetworkAvailable, syncOfflineOrders, trackAndSyncDeletion } from "@/lib/sync-engine";
import { isLaptopWriter } from "@/lib/device-mode";
import { loadCostLookupData, computeItemCogsFromLookup } from "@/lib/inventory-service";
import { posBus } from "@/lib/broadcast-bus";
import { 
  Plus, Receipt, TrendingDown, Clock, Search, Filter, 
  Calendar, DollarSign, Building, Package, ArrowDownRight, 
  CheckCircle2, Trash2, PieChart as PieChartIcon, X, RefreshCw, Eye
} from "lucide-react";

interface ExpenseItem {
  id: string;
  category: string;
  amount: number;
  description: string;
  logged_by: string;
  created_at: string;
}

interface AdminExpensesProps {
  isActive?: boolean;
  refreshTrigger?: number;
}

export default function AdminExpenses({ isActive, refreshTrigger }: AdminExpensesProps = {}) {
  const [isLaptop, setIsLaptop] = useState(false);
  useEffect(() => {
    setIsLaptop(isLaptopWriter());
  }, []);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Selected Month (YYYY-MM)
  const currentMonthStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState<string>(currentMonthStr);

  // Monthly Financial Metrics
  const [monthlyMetrics, setMonthlyMetrics] = useState({
    netSales: 0,
    soldRecipesCogs: 0,
    spoilageCost: 0,
    trueCogs: 0,
    grossOperatingProfit: 0,
    manualExpenses: 0,
    drawerExpenses: 0,
    overheadExpenses: 0,
    foodpandaVarianceExpense: 0,
    totalExpenses: 0,
    trueNetProfit: 0,
    netMargin: 0
  });

  // Adding Modal
  const [isAdding, setIsAdding] = useState(false);
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState('Rent');
  const [description, setDescription] = useState('');
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split('T')[0]);

  // Filters
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const EXPENSE_CATEGORIES = [
    'Rent', 
    'Payroll / Salaries', 
    'Utilities (Electricity/Gas)', 
    'Generator Fuel', 
    'Maintenance & Repairs', 
    'Packaging & Disposables', 
    'Marketing / Social Media', 
    'Ingredients (Off-book)', 
    'Foodpanda Commission / Variance',
    'Misc'
  ];

  const expenseDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const getExpenseCacheKey = (month: string) => `expenses_${month}`;

  useEffect(() => {
    const key = getExpenseCacheKey(selectedMonth);
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const isCurrentMonth = selectedMonth === currentMonthStr;

    const cached = adminCache.get<{ expenses: ExpenseItem[]; metrics: typeof monthlyMetrics }>(
      key, 
      isCurrentMonth ? CACHE_TTL.LIVE_TODAY : CACHE_TTL.HISTORIC_DATE
    );

    if (cached) {
      setExpenses(cached.expenses);
      setMonthlyMetrics(cached.metrics);
      setIsLoading(false);
      // Closed past months are final, no need to query cloud again
      if (!isCurrentMonth) return;
    }

    if (expenseDebounceRef.current) clearTimeout(expenseDebounceRef.current);
    expenseDebounceRef.current = setTimeout(() => {
      fetchMonthlyData(!cached);
    }, cached ? 400 : 80);

    return () => {
      if (expenseDebounceRef.current) clearTimeout(expenseDebounceRef.current);
    };
  }, [selectedMonth]);

  // Invalidate cache and auto-fetch whenever the admin switches to the Expenses tab
  useEffect(() => {
    if (isActive) {
      adminCache.delete(getExpenseCacheKey(selectedMonth));
      fetchMonthlyData(false);
    }
  }, [isActive]);

  // Real-time broadcast bus subscriptions
  useEffect(() => {
    const unsubscribe = posBus.subscribe((msg) => {
      if (
        msg.type === 'EXPENSE_LOGGED' ||
        msg.type === 'SHIFT_CLOSED' ||
        msg.type === 'ORDER_CREATED' ||
        msg.type === 'ORDER_COMPLETED' ||
        msg.type === 'ORDER_CANCELLED' ||
        msg.type === 'MANUAL_REFRESH' ||
        (msg.type === 'ADMIN_TAB_SELECTED' && (msg.payload as any)?.tab === 'expenses')
      ) {
        adminCache.delete(getExpenseCacheKey(selectedMonth));
        fetchMonthlyData(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [selectedMonth]);

  // Direct prop-driven refresh from top executive header
  useEffect(() => {
    if (refreshTrigger) {
      adminCache.delete(getExpenseCacheKey(selectedMonth));
      fetchMonthlyData(true);
    }
  }, [refreshTrigger, selectedMonth]);

  const fetchMonthlyData = async (showLoadingSpinner = true) => {
    if (showLoadingSpinner) {
      setIsLoading(true);
    }
    
    // Parse start and end of selected month
    const [year, month] = selectedMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1).toISOString();
    const endDate = new Date(year, month, 0, 23, 59, 59).toISOString();

    // Local Dexie Fallback (100% Offline Capable)
    const loadExpensesFromDexie = async () => {
      try {
        const localExpenses = await db.expenses.toArray();
        const monthExpenses = localExpenses
          .filter(e => e.created_at >= startDate && e.created_at <= endDate)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        setExpenses(monthExpenses);
        
        let drawerExpenses = 0;
        let overheadExpenses = 0;
        monthExpenses.forEach(e => {
          const isDrawer = (e.category || '').toLowerCase().includes('drawer') || 
                           (e.description || '').toLowerCase().includes('[shift drawer]') ||
                           (e.category || '').toLowerCase().includes('payout');
          const amt = Number(e.amount || 0);
          if (isDrawer) {
            drawerExpenses += amt;
          } else {
            overheadExpenses += amt;
          }
        });

        const localOrders = await db.orders.toArray();
        const monthOrders = localOrders.filter(o => 
          o.created_at >= startDate && 
          o.created_at <= endDate && 
          o.status !== 'PENDING' && 
          o.status !== 'OPEN_TAB' && 
          o.status !== 'CANCELLED'
        );
        let netSales = 0;
        monthOrders.forEach(o => {
          const sale = Number(o.net_total || 0);
          netSales += o.order_type === 'FOODPANDA' ? sale * 0.7 : sale;
        });
        const manualExpTotal = monthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
        
        // Dynamic COGS calculation from local recipes & raw inventory (0ms offline)
        let soldRecipesCogs = 0;
        let spoilageCost = 0;
        try {
          const lookup = await loadCostLookupData();
          monthOrders.forEach(o => {
            const items = Array.isArray(o.items) ? o.items : [];
            items.forEach((item: any) => {
              soldRecipesCogs += computeItemCogsFromLookup(item, lookup);
            });
          });

          const localLogs = await db.inventory_logs.toArray();
          const monthSpoilageLogs = localLogs.filter(l => 
            l.created_at >= startDate && 
            l.created_at <= endDate && 
            (l.change_type === 'WASTE' || l.change_type === 'SPOILAGE')
          );
          monthSpoilageLogs.forEach(l => {
            const raw = lookup.rawInventoryMap.get(l.inventory_item_id);
            const unitCost = Number(raw?.cost_per_unit || 0);
            spoilageCost += Math.abs(Number(l.change_qty || 0)) * unitCost;
          });
        } catch (cogsErr) {
          console.warn("[AdminExpenses] COGS calculation note:", cogsErr);
        }

        const trueCogs = soldRecipesCogs + spoilageCost;
        const grossOperatingProfit = netSales - trueCogs;
        const trueNetProfit = grossOperatingProfit - manualExpTotal;
        const netMargin = netSales > 0 ? (trueNetProfit / netSales) * 100 : 0;

        setMonthlyMetrics({
          netSales,
          soldRecipesCogs,
          spoilageCost,
          trueCogs,
          grossOperatingProfit,
          manualExpenses: manualExpTotal,
          drawerExpenses,
          overheadExpenses,
          foodpandaVarianceExpense: 0,
          totalExpenses: manualExpTotal,
          trueNetProfit,
          netMargin
        });
      } catch (err) {
        console.warn("[AdminExpenses] Local fallback note:", err);
      }
    };

    if (isLaptopWriter() || !isNetworkAvailable()) {
      await loadExpensesFromDexie();
      setIsLoading(false);
      return;
    }

    try {
      // 1. Fetch Expenses in month
      const { data: expData } = await supabase
        .from('expenses')
        .select('*')
        .gte('created_at', startDate)
        .lte('created_at', endDate)
        .order('created_at', { ascending: false });

      const monthExpenses = (expData || []) as ExpenseItem[];
      setExpenses(monthExpenses);
      const manualExpTotal = monthExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      let drawerExpenses = 0;
      let overheadExpenses = 0;
      monthExpenses.forEach(e => {
        const isDrawer = (e.category || '').toLowerCase().includes('drawer') || 
                         (e.description || '').toLowerCase().includes('[shift drawer]') ||
                         (e.category || '').toLowerCase().includes('payout');
        const amt = Number(e.amount || 0);
        if (isDrawer) {
          drawerExpenses += amt;
        } else {
          overheadExpenses += amt;
        }
      });

    // 2. Fetch Orders in month (to calculate monthly business profitability)
    const { data: orders } = await supabase
      .from('orders')
      .select('id, net_total, order_type, foodpanda_commission_pct, fp_payout_status, status')
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .neq('status', 'PENDING')
      .neq('status', 'OPEN_TAB');

    let totalNetSales = 0;
    (orders || []).forEach((o: any) => {
      const sale = Number(o.net_total || 0);
      let actualNet = sale;
      if (o.order_type === 'FOODPANDA') {
        const comm = sale * (Number(o.foodpanda_commission_pct || 30) / 100);
        actualNet = sale - comm;
      }
      totalNetSales += actualNet;
    });

    // 3. Fetch Sold Recipes COGS in month
    const { data: items } = await supabase
      .from('order_items')
      .select('cogs_total, orders(created_at, status)')
      .gte('orders.created_at', startDate)
      .lte('orders.created_at', endDate);

    let soldCogs = 0;
    (items || []).forEach((i: any) => {
      const orderObj = Array.isArray(i.orders) ? i.orders[0] : i.orders;
      if (!orderObj || orderObj.status === 'PENDING' || orderObj.status === 'OPEN_TAB') return;
      soldCogs += Number(i.cogs_total || 0);
    });

    // 4. Fetch Spoilage & Waste Cost in month
    const { data: spoilageData } = await supabase
      .from('spoilage_logs')
      .select('*')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    const { data: rawInv } = await supabase.from('raw_inventory').select('id, cost_per_unit');
    const rawCostMap = new Map<string, number>((rawInv || []).map((r: any) => [r.id, Number(r.cost_per_unit || 0)]));

    const { data: recipesData } = await supabase.from('recipes').select('menu_item_id, inventory_item_id, quantity_deducted');
    const menuCostMap = new Map<string, number>();
    (recipesData || []).forEach((r: any) => {
      const unitCost = Number(rawCostMap.get(r.inventory_item_id) || 0);
      const compCost = Number(r.quantity_deducted || 0) * unitCost;
      menuCostMap.set(r.menu_item_id, (menuCostMap.get(r.menu_item_id) || 0) + compCost);
    });

    let totalWasteCost = 0;
    (spoilageData || []).forEach((s: any) => {
      const qty = Number(s.quantity_wasted || 0);
      if (s.inventory_item_id) {
        totalWasteCost += qty * Number(rawCostMap.get(s.inventory_item_id) || 0);
      } else if (s.menu_item_id) {
        totalWasteCost += qty * Number(menuCostMap.get(s.menu_item_id) || 0);
      }
    });

    const trueCogs = soldCogs + totalWasteCost;

    // 5. Fetch Foodpanda Payout Negative Variance
    const { data: fpPayouts } = await supabase
      .from('foodpanda_payouts')
      .select('*')
      .gte('created_at', startDate)
      .lte('created_at', endDate);

    let fpVarianceExpense = 0;
    (fpPayouts || []).forEach((p: any) => {
      const v = Number(p.variance || 0);
      if (v < 0) {
        fpVarianceExpense += Math.abs(v);
      }
    });

    const combinedExpenses = manualExpTotal + fpVarianceExpense;
    const grossProfit = totalNetSales - trueCogs;
    const trueNet = grossProfit - combinedExpenses;
    const margin = totalNetSales > 0 ? (trueNet / totalNetSales) * 100 : 0;

    const calculatedMetrics = {
      netSales: totalNetSales,
      soldRecipesCogs: soldCogs,
      spoilageCost: totalWasteCost,
      trueCogs: trueCogs,
      grossOperatingProfit: grossProfit,
      manualExpenses: manualExpTotal,
      drawerExpenses,
      overheadExpenses,
      foodpandaVarianceExpense: fpVarianceExpense,
      totalExpenses: combinedExpenses,
      trueNetProfit: trueNet,
      netMargin: margin
    };

    setMonthlyMetrics(calculatedMetrics);

    // Save to Cache for instant 0ms access
    adminCache.set(getExpenseCacheKey(selectedMonth), {
      expenses: monthExpenses,
      metrics: calculatedMetrics
    });
    } catch (err) {
      console.warn("Cloud monthly expenses fetch note, falling back to local Dexie:", err);
      await loadExpensesFromDexie();
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddExpense = async () => {
    if (!isLaptopWriter()) return;
    if (!amount || Number(amount) <= 0) return modal.warning("Invalid Amount", "A valid positive expense amount is required.");
    
    const newId = crypto.randomUUID();
    const payload = {
      id: newId,
      amount: Number(amount),
      category,
      description: description.trim(),
      logged_by: 'Owner',
      created_at: new Date(expenseDate).toISOString(),
      sync_status: 'PENDING'
    };

    // 1. Save to local Dexie immediately (0ms offline success)
    await db.expenses.put(payload as any);
    setExpenses(prev => [payload as any, ...prev]);
    setIsAdding(false);
    setAmount('');
    setDescription('');
    
    // Clear cache and broadcast so dashboard/reports auto-refresh instantly
    adminCache.delete(getExpenseCacheKey(selectedMonth));
    posBus.publish('EXPENSE_LOGGED', { id: newId });
    
    modal.toast.success(`Expense of Rs. ${Number(payload.amount).toLocaleString()} added.`);
    setTimeout(() => syncOfflineOrders(), 50);
    fetchMonthlyData(true);
  };

  const handleDeleteExpense = async (id: string) => {
    if (!isLaptopWriter()) return;
    const ok = await modal.confirm({
      title: "Delete Expense Entry?",
      message: "Are you sure you want to delete this expense record? This will adjust your monthly P&L ledger immediately.",
      confirmText: "Delete Entry",
      isDanger: true
    });
    if (!ok) return;

    // Track deletion tombstone and sync to Supabase
    await db.expenses.delete(id);
    await trackAndSyncDeletion('expenses', id);
    setExpenses(prev => prev.filter(e => e.id !== id));
    
    // Clear cache and broadcast so dashboard/reports auto-refresh instantly
    adminCache.delete(getExpenseCacheKey(selectedMonth));
    posBus.publish('EXPENSE_LOGGED', { id });
    
    modal.toast.success("Expense entry removed.");
    setTimeout(() => syncOfflineOrders(), 50);
    fetchMonthlyData(true);
  };

  // Category Breakdown
  const categoryTotals: Record<string, number> = {};
  expenses.forEach(e => {
    categoryTotals[e.category] = (categoryTotals[e.category] || 0) + Number(e.amount || 0);
  });
  if (monthlyMetrics.foodpandaVarianceExpense > 0) {
    categoryTotals['Foodpanda Variance / Deductions'] = monthlyMetrics.foodpandaVarianceExpense;
  }

  const filteredExpenses = expenses.filter(e => {
    const matchesCat = filterCategory === 'ALL' || e.category === filterCategory;
    const matchesQuery = !searchQuery || 
      e.description?.toLowerCase().includes(searchQuery.toLowerCase()) || 
      e.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesQuery;
  });

  // Generate Month Options (last 12 months)
  const monthOptions = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
    monthOptions.push({ val, label });
  }

  return (
    <div className="flex flex-col gap-5 sm:gap-6 relative pb-12 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* HEADER & MONTH SELECTOR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center p-2 shadow-xs shrink-0 border border-emerald-200 dark:border-emerald-800">
            <Receipt className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight">Expenses &amp; P&amp;L Ledger</h2>
            <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-slate-400">
              Monthly fixed overheads and real business bottom-line profit.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xs">
            <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <select 
              value={selectedMonth} 
              onChange={e => setSelectedMonth(e.target.value)}
              className="font-black text-xs text-slate-800 dark:text-slate-100 outline-none bg-transparent cursor-pointer"
            >
              {monthOptions.map(m => (
                <option key={m.val} value={m.val} className="dark:bg-slate-900 dark:text-slate-100">{m.label}</option>
              ))}
            </select>
          </div>

          <button 
            onClick={() => {
              adminCache.delete(getExpenseCacheKey(selectedMonth));
              fetchMonthlyData(true);
            }}
            title="Refresh Ledger"
            disabled={isLoading}
            className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-300 shadow-2xs active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-600' : ''}`} />
          </button>

          {isLaptop ? (
            <button 
              onClick={() => setIsAdding(true)}
              className="flex-1 sm:flex-none bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl font-black text-xs flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 touch-manipulation cursor-pointer"
            >
              <Plus className="w-4 h-4" /> LOG EXPENSE
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs font-bold text-amber-700 dark:text-amber-300">
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>Read-Only Mirror</span>
            </div>
          )}
        </div>
      </div>

      {/* MONTHLY TRUE BUSINESS P&L CARDS (Responsive: 2-col on mobile with Net Profit spanning full width, 5-col on desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-4">
        {/* 1. Monthly Revenue */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 rounded-2xl shadow-xs">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">1. Net Sales</p>
          <p className="text-base sm:text-xl md:text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 whitespace-nowrap overflow-visible">
            Rs. {monthlyMetrics.netSales.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 mt-0.5">Realized Revenue</p>
        </div>

        {/* 2. Monthly True Food Cost */}
        <div className="bg-white dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 p-3.5 sm:p-5 rounded-2xl shadow-xs">
          <p className="text-[10px] font-bold text-amber-500 dark:text-amber-400 uppercase tracking-wider">2. (-) Food Cost</p>
          <p className="text-base sm:text-xl md:text-2xl font-black text-amber-600 dark:text-amber-400 mt-1 whitespace-nowrap overflow-visible">
            Rs. {monthlyMetrics.trueCogs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] font-bold text-amber-700/80 dark:text-amber-400/80 mt-0.5">
            Recipes: Rs. {monthlyMetrics.soldRecipesCogs.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>

        {/* 3. Gross Operating Margin */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-3.5 sm:p-5 rounded-2xl shadow-xs">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">3. (=) Kitchen Profit</p>
          <p className="text-base sm:text-xl md:text-2xl font-black text-slate-800 dark:text-slate-100 mt-1 whitespace-nowrap overflow-visible">
            Rs. {monthlyMetrics.grossOperatingProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mt-0.5">Sales - Food Cost</p>
        </div>

        {/* 4. Total Monthly Overheads */}
        <div className="bg-white dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-3.5 sm:p-5 rounded-2xl shadow-xs">
          <p className="text-[10px] font-bold text-red-500 dark:text-red-400 uppercase tracking-wider">4. (-) Total Overheads</p>
          <p className="text-base sm:text-xl md:text-2xl font-black text-red-600 dark:text-red-400 mt-1 whitespace-nowrap overflow-visible">
            Rs. {monthlyMetrics.totalExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] font-bold text-red-500 dark:text-red-400 mt-0.5">
            {expenses.length} Logged Entries
          </p>
        </div>

        {/* 5. True Net Profit (Spans 2 columns on mobile so it's large and prominent) */}
        <div className={`col-span-2 lg:col-span-1 p-3.5 sm:p-5 rounded-2xl shadow-lg border text-white ${
          monthlyMetrics.trueNetProfit >= 0 
            ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 border-emerald-600 dark:from-emerald-600 dark:to-emerald-700 dark:border-emerald-500' 
            : 'bg-gradient-to-br from-red-500 to-red-600 border-red-600 dark:from-red-600 dark:to-red-700 dark:border-red-500'
        }`}>
          <div className="flex lg:flex-col justify-between items-center lg:items-start">
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider text-white/80">5. (=) True Net Profit</p>
              <p className="text-xl sm:text-2xl font-black mt-0.5">
                Rs. {monthlyMetrics.trueNetProfit.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <div className="text-right lg:text-left">
              <span className="text-xs sm:text-sm font-black bg-white/20 px-2.5 py-1 rounded-lg">
                Margin: {monthlyMetrics.netMargin.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* DIRECT DRAWER PAYOUTS VS GENERAL OVERHEADS SEGREGATION */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 flex items-center justify-between shadow-xs">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0"></span>
              <span className="text-[10px] sm:text-xs font-black uppercase text-amber-800 dark:text-amber-300 tracking-wider">
                Direct Shift &amp; Drawer Cash Payouts
              </span>
            </div>
            <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5 font-medium">
              Deducted at register directly from shift drawer float (e.g. daily milk, ice, petty cash)
            </p>
          </div>
          <div className="text-right pl-3 shrink-0">
            <span className="text-base sm:text-xl font-black text-amber-700 dark:text-amber-400 whitespace-nowrap">
              Rs. {monthlyMetrics.drawerExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>

        <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 dark:bg-slate-850/80 border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-xs">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0"></span>
              <span className="text-[10px] sm:text-xs font-black uppercase text-slate-700 dark:text-slate-300 tracking-wider">
                Fixed &amp; General Business Overheads
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
              Rent, electricity/gas bills, payroll, generator fuel, maintenance, marketing
            </p>
          </div>
          <div className="text-right pl-3 shrink-0">
            <span className="text-base sm:text-xl font-black text-slate-800 dark:text-slate-100 whitespace-nowrap">
              Rs. {monthlyMetrics.overheadExpenses.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
          </div>
        </div>
      </div>

      {/* CATEGORY SPENDING PILLARS */}
      {Object.keys(categoryTotals).length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 rounded-2xl shadow-xs">
          <h4 className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
            <PieChartIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            Where Money Went This Month
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
            {Object.entries(categoryTotals).map(([cat, total]) => {
              const pct = monthlyMetrics.totalExpenses > 0 ? ((total / monthlyMetrics.totalExpenses) * 100).toFixed(0) : '0';
              return (
                <div key={cat} className="p-2.5 sm:p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 rounded-xl">
                  <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase truncate" title={cat}>{cat}</p>
                  <p className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 mt-0.5">Rs. {total.toLocaleString()}</p>
                  <div className="w-full bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full mt-2 overflow-hidden">
                    <div className="bg-red-500 h-full rounded-full transition-all" style={{ width: `${pct}%` }}></div>
                  </div>
                  <span className="text-[9px] font-bold text-slate-400 dark:text-slate-500 mt-1 block">{pct}% of total</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* LOG EXPENSE MODAL (MOBILE BOTTOM-SHEET / DESKTOP CENTERED - LAPTOP ONLY) */}
      {isLaptop && isAdding && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-850">
              <h3 className="font-black text-base sm:text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-red-600 dark:text-red-400" /> Log Operational Expense
              </h3>
              <button 
                onClick={() => setIsAdding(false)} 
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-full cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-4 sm:p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Amount (Rs.) *</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-2.5 text-base font-black text-red-500 dark:text-red-400">Rs.</span>
                  <input 
                    type="number" 
                    inputMode="numeric"
                    value={amount} 
                    onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))} 
                    className="w-full border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-red-600 dark:text-red-400 rounded-xl pl-11 pr-4 py-2.5 text-xl font-black focus:border-red-500 outline-none" 
                    placeholder="5000" 
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Expense Category *</label>
                <select 
                  value={category} 
                  onChange={e => setCategory(e.target.value)} 
                  className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2.5 text-xs sm:text-sm font-bold focus:border-red-500 outline-none cursor-pointer"
                >
                  {EXPENSE_CATEGORIES.map(c => <option key={c} value={c} className="dark:bg-slate-900 dark:text-slate-100">{c}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Expense Date</label>
                <input 
                  type="date" 
                  value={expenseDate} 
                  onChange={e => setExpenseDate(e.target.value)} 
                  className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-xl px-3 py-2 text-xs sm:text-sm font-bold focus:border-red-500 outline-none cursor-pointer" 
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">Vendor / Description</label>
                <input 
                  type="text" 
                  value={description} 
                  onChange={e => setDescription(e.target.value)} 
                  className="w-full mt-1 border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 dark:placeholder-slate-500 rounded-xl px-3.5 py-2.5 text-xs sm:text-sm font-medium focus:border-red-500 outline-none" 
                  placeholder="e.g. Electric bill for September, Meat supplier" 
                />
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 flex gap-2">
              <button 
                onClick={() => setIsAdding(false)} 
                className="flex-1 py-3 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs cursor-pointer"
              >
                CANCEL
              </button>
              <button 
                onClick={handleAddExpense} 
                className="flex-[2] py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black tracking-wider uppercase text-xs shadow-md active:scale-95 transition-all touch-manipulation cursor-pointer"
              >
                SAVE EXPENSE
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EXPENSE LEDGER SECTION */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {/* Table Filters Toolbar */}
        <div className="p-3.5 sm:p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2 flex-1 max-w-sm bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl">
            <Search className="w-4 h-4 text-slate-400 shrink-0" />
            <input 
              type="text" 
              id="expense-search"
              name="expenseSearch"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search expenses by vendor or note..." 
              className="text-xs outline-none w-full bg-transparent font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400 shrink-0" />
            <select 
              value={filterCategory} 
              onChange={e => setFilterCategory(e.target.value)}
              className="text-xs font-bold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl outline-none cursor-pointer"
            >
              <option value="ALL" className="dark:bg-slate-900 dark:text-slate-100">All Categories</option>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c} className="dark:bg-slate-900 dark:text-slate-100">{c}</option>)}
            </select>
          </div>
        </div>

        {/* 1. MOBILE EXPENSE CARDS VIEW (block md:hidden) */}
        <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400 dark:text-slate-500 font-bold text-xs">Loading ledger...</div>
          ) : filteredExpenses.length === 0 ? (
            <div className="p-8 text-center text-slate-400 dark:text-slate-500 font-bold text-xs">No expenses found for this month.</div>
          ) : (
            filteredExpenses.map(exp => {
              const isDrawer = (exp.category || '').toLowerCase().includes('drawer') || 
                               (exp.description || '').toLowerCase().includes('[shift drawer]') ||
                               (exp.category || '').toLowerCase().includes('payout');
              return (
                <div key={exp.id} className="p-3.5 sm:p-4 flex flex-col gap-2 hover:bg-slate-50 dark:hover:bg-slate-850/60 transition-colors">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {isDrawer ? (
                          <span className="text-[10px] font-black bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 px-2 py-0.5 rounded-md uppercase">
                            Shift Drawer Payout
                          </span>
                        ) : (
                          <span className="text-[10px] font-black bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md uppercase">
                            {exp.category}
                          </span>
                        )}
                      </div>
                      <p className="font-black text-sm text-slate-900 dark:text-slate-100 mt-1">
                        {exp.description || 'No description'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-black text-base text-red-600 dark:text-red-400">
                        Rs. {Number(exp.amount).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-400 font-medium pt-1">
                    <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                      <Clock className="w-3.5 h-3.5 text-slate-400"/>
                      {new Date(exp.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-slate-400 dark:text-slate-400">{exp.logged_by}</span>
                      {isLaptop && (
                        <button 
                          onClick={() => handleDeleteExpense(exp.id)}
                          className="min-h-[36px] min-w-[36px] flex items-center justify-center p-1.5 text-slate-400 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer"
                          title="Delete expense entry"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 2. DESKTOP EXPENSE TABLE VIEW (hidden md:block) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-850 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-bold">
                <th className="py-3 px-5">Date</th>
                <th className="py-3 px-5">Category / Type</th>
                <th className="py-3 px-5">Description</th>
                <th className="py-3 px-5">Logged By</th>
                <th className="py-3 px-5 text-right">Amount</th>
                <th className="py-3 px-5 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400 dark:text-slate-500 font-medium">Loading ledger...</td></tr>
              ) : filteredExpenses.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400 dark:text-slate-500 font-bold">No expenses found for this month.</td></tr>
              ) : (
                filteredExpenses.map(exp => {
                  const isDrawer = (exp.category || '').toLowerCase().includes('drawer') || 
                                   (exp.description || '').toLowerCase().includes('[shift drawer]') ||
                                   (exp.category || '').toLowerCase().includes('payout');
                  return (
                    <tr key={exp.id} className="hover:bg-slate-50 dark:hover:bg-slate-850/50 transition-colors">
                      <td className="py-3.5 px-5 font-bold text-slate-600 dark:text-slate-300 flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-slate-400"/>
                        {new Date(exp.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </td>
                      <td className="py-3.5 px-5">
                        {isDrawer ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] font-black bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 px-2 py-0.5 rounded-md uppercase w-fit">
                              Shift Drawer Payout
                            </span>
                            <span className="text-[9px] font-bold text-amber-700/70 dark:text-amber-400/70">
                              {exp.category}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[10px] font-black bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md uppercase">
                            {exp.category}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-5 text-slate-800 dark:text-slate-100 font-medium">{exp.description || '-'}</td>
                      <td className="py-3.5 px-5 text-slate-500 dark:text-slate-400 font-bold">{exp.logged_by}</td>
                      <td className="py-3.5 px-5 text-right font-black text-red-600 dark:text-red-400 text-sm">
                        Rs. {Number(exp.amount).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-5 text-center">
                        {isLaptop ? (
                          <button 
                            onClick={() => handleDeleteExpense(exp.id)}
                            className="text-slate-300 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 transition-colors p-1.5 rounded-lg cursor-pointer"
                            title="Delete entry"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        ) : (
                          <span className="text-[10px] text-slate-400">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

