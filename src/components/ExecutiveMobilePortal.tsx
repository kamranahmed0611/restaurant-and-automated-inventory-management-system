"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { 
  LayoutDashboard, ClipboardList, Package, Store, TrendingUp, 
  RefreshCw, LogOut, Search, Filter, AlertTriangle, 
  Clock, DollarSign, Bike, Receipt, X, ChevronRight, 
  ChevronLeft, Sun, Moon, ChevronDown, ChevronUp, Calendar
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { db } from "@/lib/db";
import { isLaptopWriter } from "@/lib/device-mode";
import { loadCostLookupData } from "@/lib/inventory-service";
import MuchachosBrand from "@/components/MuchachosBrand";

export type MobileTab = 'DASHBOARD' | 'ORDERS' | 'STOCK' | 'SHIFTS' | 'ANALYTICS';
export type MobileTimeRange = 'TODAY' | 'CURRENT_SHIFT' | 'YESTERDAY' | '7_DAYS' | 'THIS_MONTH' | 'CUSTOM_DATE';

interface OrderItemDetail {
  id?: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  modifiers_json?: { name: string; qty?: number; price?: number }[];
}

interface MobileOrder {
  id: string;
  token_number: number;
  order_type: 'TAKEAWAY' | 'DINE_IN' | 'FOODPANDA';
  payment_method: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'OPEN_TAB';
  subtotal: number;
  discount: number;
  net_total: number;
  foodpanda_commission_pct?: number;
  fp_payout_status?: string;
  table_number?: string;
  created_at: string;
  shift_id?: string;
  items?: any[];
  order_items?: OrderItemDetail[];
}

interface MobileShift {
  id: string;
  cashier_id?: string | null;
  cashier_name?: string | null;
  opened_at: string;
  closed_at?: string | null;
  starting_cash: number;
  closing_cash?: number | null;
  expected_cash?: number | null;
  actual_cash?: number | null;
  cash_difference?: number | null;
  total_sales: number;
  card_sales: number;
  cash_sales: number;
  foodpanda_sales: number;
  total_discount: number;
  drawer_expenses: number;
  deficit_settlement_cost?: number;
  status: 'OPEN' | 'CLOSED';
  notes?: string | null;
}

interface RawInventoryItem {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  cost_per_unit: number;
  min_stock_alert: number;
  bulk_unit?: string;
  conversion_rate?: number;
  bulk_cost?: number;
}

interface SpoilageLog {
  id: string;
  inventory_item_id?: string;
  item_name?: string;
  quantity: number;
  cost_loss: number;
  reason?: string;
  logged_by?: string;
  created_at: string;
}

interface MobileExpense {
  id: string;
  category: string;
  amount: number;
  description?: string;
  shift_id?: string | null;
  is_drawer_expense?: boolean;
  created_at: string;
}

export default function ExecutiveMobilePortal() {
  const router = useRouter();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Navigation & Time range
  const [activeTab, setActiveTab] = useState<MobileTab>('DASHBOARD');
  const [timeRange, setTimeRange] = useState<MobileTimeRange>('TODAY');
  const [selectedCustomDate, setSelectedCustomDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  // Profit calculation toggle: include pending Foodpanda net profit?
  const [includePendingFp, setIncludePendingFp] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('muchachos_include_pending_fp') === 'true';
    }
    return false;
  });

  // Raw data
  const [orders, setOrders] = useState<MobileOrder[]>([]);
  const [shifts, setShifts] = useState<MobileShift[]>([]);
  const [inventory, setInventory] = useState<RawInventoryItem[]>([]);
  const [spoilageLogs, setSpoilageLogs] = useState<SpoilageLog[]>([]);
  const [expenses, setExpenses] = useState<MobileExpense[]>([]);
  const [costLookup, setCostLookup] = useState<any>(null);

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedReceiptOrder, setSelectedReceiptOrder] = useState<MobileOrder | null>(null);
  const [expandedShiftId, setExpandedShiftId] = useState<string | null>(null);
  const [stockSubTab, setStockSubTab] = useState<'INVENTORY' | 'SPOILAGE'>('INVENTORY');

  // Search & Filters in Tabs
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderChannelFilter, setOrderChannelFilter] = useState<'ALL' | 'DINE_IN' | 'TAKEAWAY' | 'FOODPANDA'>('ALL');
  const [orderStatusFilter, setOrderStatusFilter] = useState<'ALL' | 'COMPLETED' | 'PENDING' | 'CANCELLED'>('ALL');
  const [inventorySearchQuery, setInventorySearchQuery] = useState('');
  const [inventoryFilter, setInventoryFilter] = useState<'ALL' | 'DEFICIT' | 'LOW'>('ALL');

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleIncludeFp = () => {
    const next = !includePendingFp;
    setIncludePendingFp(next);
    if (typeof window !== 'undefined') {
      localStorage.setItem('muchachos_include_pending_fp', String(next));
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // ignore
    }
    router.replace('/login');
  };

  // Date Range Bounds Calculator
  const dateBounds = useMemo(() => {
    const now = new Date();
    let start = new Date();
    let end: Date | null = null;

    if (timeRange === 'TODAY') {
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (timeRange === 'YESTERDAY') {
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
    } else if (timeRange === 'CURRENT_SHIFT') {
      const activeShift = shifts.find(s => s.status === 'OPEN') || shifts[shifts.length - 1];
      if (activeShift) {
        start = new Date(activeShift.opened_at);
      } else {
        start.setHours(0, 0, 0, 0);
      }
    } else if (timeRange === '7_DAYS') {
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
    } else if (timeRange === 'THIS_MONTH') {
      start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    } else if (timeRange === 'CUSTOM_DATE') {
      const [y, m, d] = selectedCustomDate.split('-').map(Number);
      start = new Date(y, m - 1, d, 0, 0, 0, 0);
      end = new Date(y, m - 1, d, 23, 59, 59, 999);
    }

    return {
      startIso: start.toISOString(),
      endIso: end ? end.toISOString() : undefined,
    };
  }, [timeRange, selectedCustomDate, shifts]);

  // Primary Data Fetcher
  const loadData = useCallback(async (showSpinner = true) => {
    if (showSpinner) setIsLoading(true);
    setIsRefreshing(true);

    try {
      const laptop = isLaptopWriter();

      if (laptop) {
        const [localOrders, localShifts, localInv, localExpenses, localLogs, lookup] = await Promise.all([
          db.orders.toArray(),
          db.shifts.toArray(),
          db.raw_inventory.toArray(),
          db.expenses.toArray(),
          db.inventory_logs.toArray(),
          loadCostLookupData().catch(() => null)
        ]);

        const formattedOrders: MobileOrder[] = (localOrders || []).map(o => ({
          id: o.id,
          token_number: o.token_number,
          order_type: o.order_type as any,
          payment_method: o.payment_method,
          status: o.status as any,
          subtotal: Number(o.subtotal || 0),
          discount: Number(o.discount || 0),
          net_total: Number(o.net_total || 0),
          foodpanda_commission_pct: Number((o as any).foodpanda_commission_pct || 30),
          fp_payout_status: o.fp_payout_status,
          table_number: o.table_number,
          created_at: o.created_at,
          shift_id: o.shift_id,
          items: o.items || [],
          order_items: (o.items || []).map((it: any) => ({
            item_name: it.item_name || 'Item',
            quantity: Number(it.quantity || 1),
            unit_price: Number(it.unit_price || 0),
            total_price: Number(it.total_price || (it.unit_price * it.quantity) || 0),
            modifiers_json: it.modifiers_json || it.modifiers || []
          }))
        }));

        const formattedShifts: MobileShift[] = (localShifts || []).map(s => {
          const shiftAny = s as any;
          return {
            id: s.id,
            cashier_id: s.cashier_id,
            cashier_name: s.cashier_name,
            opened_at: s.opened_at,
            closed_at: s.closed_at,
            starting_cash: Number(s.starting_cash || 0),
            closing_cash: s.closing_cash !== undefined ? s.closing_cash : undefined,
            expected_cash: s.expected_cash !== undefined ? s.expected_cash : undefined,
            actual_cash: s.actual_cash !== undefined ? s.actual_cash : undefined,
            cash_difference: shiftAny.cash_difference !== undefined ? Number(shiftAny.cash_difference) : undefined,
            total_sales: Number(shiftAny.total_sales || 0),
            card_sales: Number(shiftAny.card_sales || 0),
            cash_sales: Number(shiftAny.cash_sales || 0),
            foodpanda_sales: Number(shiftAny.foodpanda_sales || 0),
            total_discount: Number(shiftAny.total_discount || 0),
            drawer_expenses: Number(shiftAny.drawer_expenses || 0),
            deficit_settlement_cost: Number(shiftAny.deficit_settlement_cost || 0),
            status: s.status as any,
            notes: s.notes
          };
        });

        const formattedInv: RawInventoryItem[] = (localInv || []).map(i => {
          const invAny = i as any;
          return {
            id: i.id,
            name: i.name,
            current_stock: Number(i.current_stock || 0),
            unit: i.unit || 'Units',
            cost_per_unit: Number(i.cost_per_unit || 0),
            min_stock_alert: Number(i.min_stock_alert || 5),
            bulk_unit: invAny.bulk_unit,
            conversion_rate: Number(invAny.conversion_rate || 1),
            bulk_cost: Number(invAny.bulk_cost || 0)
          };
        });

        const rawSpoilage = (localLogs || []).filter(l => l.change_type === 'SPOILAGE').map(l => {
          const inv = formattedInv.find(i => i.id === l.inventory_item_id);
          const qty = Math.abs(Number(l.change_qty || 0));
          const unitCost = inv ? inv.cost_per_unit : 0;
          return {
            id: l.id,
            inventory_item_id: l.inventory_item_id,
            item_name: inv ? inv.name : 'Raw Ingredient',
            quantity: qty,
            cost_loss: qty * unitCost,
            reason: l.reason || 'Spoilage / Waste',
            logged_by: 'Staff',
            created_at: l.created_at
          };
        });

        const formattedExpenses: MobileExpense[] = (localExpenses || []).map(e => {
          const expAny = e as any;
          return {
            id: e.id,
            category: e.category,
            amount: Number(e.amount || 0),
            description: e.description,
            shift_id: e.shift_id,
            is_drawer_expense: Boolean(expAny.is_drawer_expense),
            created_at: e.created_at
          };
        });

        setOrders(formattedOrders);
        setShifts(formattedShifts);
        setInventory(formattedInv);
        setSpoilageLogs(rawSpoilage);
        setExpenses(formattedExpenses);
        setCostLookup(lookup);
      } else {
        // Remote phone on Vercel: read from Supabase mirror
        const [
          ordersRes, 
          shiftsRes, 
          rawInvRes, 
          spoilageRes, 
          expensesRes,
          menuRes,
          recipesRes
        ] = await Promise.all([
          supabase.from('orders').select('*').order('created_at', { ascending: false }).limit(200),
          supabase.from('cashier_shifts').select('*').order('opened_at', { ascending: false }).limit(60),
          supabase.from('raw_inventory').select('*').order('name', { ascending: true }),
          supabase.from('spoilage_logs').select('*').order('created_at', { ascending: false }).limit(60),
          supabase.from('expenses').select('*').order('created_at', { ascending: false }).limit(100),
          supabase.from('menu_items').select('*'),
          supabase.from('recipes').select('*')
        ]);

        const rawOrders = ordersRes.data || [];
        const rawShifts = shiftsRes.data || [];
        const rawInv = rawInvRes.data || [];
        const rawSpoilage = spoilageRes.data || [];
        const rawExp = expensesRes.data || [];
        const rawMenu = menuRes.data || [];
        const rawRecipes = recipesRes.data || [];

        const costMap = new Map<string, number>();
        rawInv.forEach((r: any) => costMap.set(r.id, Number(r.cost_per_unit || 0)));
        const menuCostMap = new Map<string, number>();
        rawMenu.forEach((m: any) => menuCostMap.set(m.id, Number(m.cost_price || 0)));
        const recipeMap = new Map<string, { invId: string; qty: number }[]>();
        rawRecipes.forEach((rec: any) => {
          const arr = recipeMap.get(rec.menu_item_id) || [];
          arr.push({ invId: rec.inventory_item_id, qty: Number(rec.quantity_deducted || 1) });
          recipeMap.set(rec.menu_item_id, arr);
        });
        setCostLookup({ costMap, menuCostMap, recipeMap });

        const formattedOrders: MobileOrder[] = rawOrders.map((o: any) => {
          let itemsArr = [];
          if (Array.isArray(o.items)) itemsArr = o.items;
          else if (typeof o.items === 'string') {
            try { itemsArr = JSON.parse(o.items); } catch { itemsArr = []; }
          }

          return {
            id: o.id,
            token_number: Number(o.token_number || 0),
            order_type: o.order_type,
            payment_method: o.payment_method || 'CASH',
            status: o.status || 'COMPLETED',
            subtotal: Number(o.subtotal || 0),
            discount: Number(o.discount || 0),
            net_total: Number(o.net_total || 0),
            foodpanda_commission_pct: Number(o.foodpanda_commission_pct || 30),
            fp_payout_status: o.fp_payout_status,
            table_number: o.table_number,
            created_at: o.created_at,
            shift_id: o.shift_id,
            items: itemsArr,
            order_items: itemsArr.map((it: any) => ({
              item_name: it.item_name || it.name || 'Item',
              quantity: Number(it.quantity || 1),
              unit_price: Number(it.unit_price || it.price || 0),
              total_price: Number(it.total_price || (Number(it.unit_price || 0) * Number(it.quantity || 1)) || 0),
              modifiers_json: it.modifiers || it.modifiers_json || []
            }))
          };
        });

        const formattedShifts: MobileShift[] = rawShifts.map((s: any) => ({
          id: s.id,
          cashier_id: s.cashier_id,
          cashier_name: s.cashier_name,
          opened_at: s.opened_at,
          closed_at: s.closed_at,
          starting_cash: Number(s.starting_cash || 0),
          closing_cash: s.closing_cash !== null && s.closing_cash !== undefined ? Number(s.closing_cash) : undefined,
          expected_cash: s.expected_cash !== null && s.expected_cash !== undefined ? Number(s.expected_cash) : undefined,
          actual_cash: s.actual_cash !== null && s.actual_cash !== undefined ? Number(s.actual_cash) : undefined,
          cash_difference: s.cash_difference !== null && s.cash_difference !== undefined ? Number(s.cash_difference) : undefined,
          total_sales: Number(s.total_sales || 0),
          card_sales: Number(s.card_sales || 0),
          cash_sales: Number(s.cash_sales || 0),
          foodpanda_sales: Number(s.foodpanda_sales || 0),
          total_discount: Number(s.total_discount || 0),
          drawer_expenses: Number(s.drawer_expenses || 0),
          deficit_settlement_cost: Number(s.deficit_settlement_cost || 0),
          status: s.status || 'OPEN',
          notes: s.notes
        }));

        const formattedInv: RawInventoryItem[] = rawInv.map((i: any) => ({
          id: i.id,
          name: i.name,
          current_stock: Number(i.current_stock || 0),
          unit: i.unit || 'Units',
          cost_per_unit: Number(i.cost_per_unit || 0),
          min_stock_alert: Number(i.min_stock_alert || 5),
          bulk_unit: i.bulk_unit,
          conversion_rate: Number(i.conversion_rate || 1),
          bulk_cost: Number(i.bulk_cost || 0)
        }));

        const formattedSpoilage: SpoilageLog[] = rawSpoilage.map((sp: any) => {
          const inv = formattedInv.find(i => i.id === sp.inventory_item_id);
          return {
            id: sp.id,
            inventory_item_id: sp.inventory_item_id,
            item_name: inv ? inv.name : 'Raw Ingredient',
            quantity: Number(sp.quantity || 0),
            cost_loss: Number(sp.cost_loss || 0),
            reason: sp.reason || 'Spoilage',
            logged_by: sp.logged_by || 'Staff',
            created_at: sp.created_at
          };
        });

        const formattedExpenses: MobileExpense[] = rawExp.map((e: any) => ({
          id: e.id,
          category: e.category,
          amount: Number(e.amount || 0),
          description: e.description,
          shift_id: e.shift_id,
          is_drawer_expense: Boolean(e.is_drawer_expense),
          created_at: e.created_at
        }));

        setOrders(formattedOrders);
        setShifts(formattedShifts);
        setInventory(formattedInv);
        setSpoilageLogs(formattedSpoilage);
        setExpenses(formattedExpenses);
      }
    } catch (err) {
      console.warn("[ExecutiveMobilePortal] Error loading data:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData(true);
  }, [loadData]);

  // Realtime Supabase Subscriptions
  useEffect(() => {
    if (isLaptopWriter()) return;

    const channel = supabase
      .channel('executive_mobile_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cashier_shifts' }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'raw_inventory' }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spoilage_logs' }, () => loadData(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, () => loadData(false))
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadData]);

  const activeShift = useMemo(() => {
    return shifts.find(s => s.status === 'OPEN') || null;
  }, [shifts]);

  const windowOrders = useMemo(() => {
    const { startIso, endIso } = dateBounds;
    return orders.filter(o => {
      if (o.created_at < startIso) return false;
      if (endIso && o.created_at > endIso) return false;
      return true;
    });
  }, [orders, dateBounds]);

  const windowExpenses = useMemo(() => {
    const { startIso, endIso } = dateBounds;
    return expenses.filter(e => {
      if (e.created_at < startIso) return false;
      if (endIso && e.created_at > endIso) return false;
      return true;
    });
  }, [expenses, dateBounds]);

  const windowSpoilage = useMemo(() => {
    const { startIso, endIso } = dateBounds;
    return spoilageLogs.filter(s => {
      if (s.created_at < startIso) return false;
      if (endIso && s.created_at > endIso) return false;
      return true;
    });
  }, [spoilageLogs, dateBounds]);

  const computeOrderCogs = useCallback((order: MobileOrder): number => {
    if (!costLookup) return 0;
    const { costMap, menuCostMap, recipeMap } = costLookup;
    let orderCogs = 0;

    (order.items || []).forEach((it: any) => {
      const qty = Number(it.quantity || 1);
      const menuId = it.menu_item_id || it.id;
      let unitCost = 0;

      if (menuId && recipeMap?.has(menuId)) {
        const ingredients = recipeMap.get(menuId) || [];
        for (const ing of ingredients) {
          const ingCost = costMap?.get(ing.invId) || 0;
          unitCost += ingCost * ing.qty;
        }
      } else if (menuId && menuCostMap?.has(menuId)) {
        unitCost = menuCostMap.get(menuId) || 0;
      }

      let modCost = 0;
      if (Array.isArray(it.modifiers)) {
        it.modifiers.forEach((m: any) => {
          if (m.inventory_item_id && costMap?.has(m.inventory_item_id)) {
            modCost += (costMap.get(m.inventory_item_id) || 0) * (m.qty || 1);
          }
        });
      }

      orderCogs += (unitCost * qty) + modCost;
    });

    return orderCogs;
  }, [costLookup]);

  // Top KPIs & Financial Metrics
  const metrics = useMemo(() => {
    let grossSales = 0;
    let discounts = 0;
    let netSales = 0;
    let totalCogs = 0;
    let completedCount = 0;

    let cashSales = 0;
    let digitalSales = 0;
    let jazzcashSales = 0;
    let easypaisaSales = 0;
    let foodpandaSales = 0;

    let dineInSales = 0;
    let takeawaySales = 0;
    let fpChannelSales = 0;

    windowOrders.forEach(o => {
      if (o.status === 'CANCELLED') return;

      completedCount += 1;
      const sub = Number(o.subtotal || 0);
      const disc = Number(o.discount || 0);
      const net = Number(o.net_total || 0);

      grossSales += sub;
      discounts += disc;
      netSales += net;

      totalCogs += computeOrderCogs(o);

      const method = (o.payment_method || '').toUpperCase();
      if (method === 'CASH') cashSales += net;
      else if (method === 'JAZZCASH') jazzcashSales += net;
      else if (method === 'EASYPAISA') easypaisaSales += net;
      else if (method === 'FOODPANDA' || method === 'FOODPANDA_RECEIVABLE') foodpandaSales += net;
      else digitalSales += net;

      if (o.order_type === 'DINE_IN') dineInSales += net;
      else if (o.order_type === 'FOODPANDA') fpChannelSales += net;
      else takeawaySales += net;
    });

    const spoilageLoss = windowSpoilage.reduce((sum, s) => sum + Number(s.cost_loss || 0), 0);
    const drawerExp = windowExpenses.filter(e => e.is_drawer_expense).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const nonDrawerExp = windowExpenses.filter(e => !e.is_drawer_expense).reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const totalExp = drawerExp + nonDrawerExp;

    const grossProfit = netSales - totalCogs;
    const operatingProfit = grossProfit - totalExp - spoilageLoss;

    const fpPendingOrders = orders.filter(o => 
      (o.order_type === 'FOODPANDA' || (o.payment_method || '').includes('FOODPANDA')) &&
      o.status !== 'CANCELLED' &&
      o.fp_payout_status !== 'RECEIVED' &&
      o.fp_payout_status !== 'SETTLED' &&
      o.fp_payout_status !== 'VOIDED'
    );

    let fpPendingGross = 0;
    let fpPendingComm = 0;
    let fpPendingNet = 0;

    fpPendingOrders.forEach(o => {
      const net = Number(o.net_total || 0);
      const rate = Number(o.foodpanda_commission_pct || 30);
      const comm = net * (rate / 100);
      fpPendingGross += net;
      fpPendingComm += comm;
      fpPendingNet += (net - comm);
    });

    let liveCashInDrawer = 0;
    if (activeShift) {
      const shiftCashSales = orders
        .filter(o => o.shift_id === activeShift.id && o.status !== 'CANCELLED' && (o.payment_method || '').toUpperCase() === 'CASH')
        .reduce((sum, o) => sum + Number(o.net_total || 0), 0);
      const shiftDrawerExp = expenses
        .filter(e => e.shift_id === activeShift.id && e.is_drawer_expense)
        .reduce((sum, e) => sum + Number(e.amount || 0), 0);
      liveCashInDrawer = (activeShift.starting_cash || 0) + shiftCashSales - shiftDrawerExp;
    } else {
      const latestClosed = shifts[0];
      liveCashInDrawer = latestClosed?.closing_cash || latestClosed?.expected_cash || 0;
    }

    const profitMarginPct = netSales > 0 ? ((operatingProfit / netSales) * 100) : 0;

    return {
      grossSales,
      discounts,
      netSales,
      totalCogs,
      grossProfit,
      operatingProfit,
      profitMarginPct,
      completedCount,
      cashSales,
      digitalSales,
      jazzcashSales,
      easypaisaSales,
      foodpandaSales,
      dineInSales,
      takeawaySales,
      fpChannelSales,
      spoilageLoss,
      drawerExp,
      nonDrawerExp,
      totalExp,
      liveCashInDrawer,
      fpPendingCount: fpPendingOrders.length,
      fpPendingGross,
      fpPendingComm,
      fpPendingNet
    };
  }, [windowOrders, windowExpenses, windowSpoilage, orders, shifts, expenses, activeShift, computeOrderCogs]);

  const stockDeficits = useMemo(() => {
    const negativeItems = inventory.filter(i => i.current_stock < 0);
    const lowStockItems = inventory.filter(i => i.current_stock >= 0 && i.current_stock <= (i.min_stock_alert || 5));
    const healthyItems = inventory.filter(i => i.current_stock > (i.min_stock_alert || 5));
    return {
      negativeItems,
      lowStockItems,
      healthyItems,
      totalAlerts: negativeItems.length + lowStockItems.length
    };
  }, [inventory]);

  const filteredOrdersList = useMemo(() => {
    return windowOrders.filter(o => {
      if (orderChannelFilter !== 'ALL' && o.order_type !== orderChannelFilter) return false;
      if (orderStatusFilter !== 'ALL' && o.status !== orderStatusFilter) return false;
      if (orderSearchQuery.trim()) {
        const q = orderSearchQuery.toLowerCase();
        const tokenMatch = String(o.token_number).includes(q);
        const itemMatch = (o.order_items || []).some(it => it.item_name.toLowerCase().includes(q));
        const methodMatch = (o.payment_method || '').toLowerCase().includes(q);
        if (!tokenMatch && !itemMatch && !methodMatch) return false;
      }
      return true;
    });
  }, [windowOrders, orderChannelFilter, orderStatusFilter, orderSearchQuery]);

  const filteredInventoryList = useMemo(() => {
    let list = inventory;
    if (inventoryFilter === 'DEFICIT') {
      list = list.filter(i => i.current_stock < 0);
    } else if (inventoryFilter === 'LOW') {
      list = list.filter(i => i.current_stock >= 0 && i.current_stock <= (i.min_stock_alert || 5));
    }
    if (inventorySearchQuery.trim()) {
      const q = inventorySearchQuery.toLowerCase();
      list = list.filter(i => i.name.toLowerCase().includes(q) || (i.unit || '').toLowerCase().includes(q));
    }
    return list;
  }, [inventory, inventoryFilter, inventorySearchQuery]);

  const stepCustomDate = (days: number) => {
    const [y, m, d] = selectedCustomDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    const nextStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    setSelectedCustomDate(nextStr);
    setTimeRange('CUSTOM_DATE');
  };

  const navItems = [
    { tab: 'DASHBOARD', shortLabel: 'Home', icon: LayoutDashboard },
    { tab: 'ORDERS', shortLabel: 'Orders', icon: ClipboardList },
    { tab: 'STOCK', shortLabel: 'Stock', icon: Package },
    { tab: 'SHIFTS', shortLabel: 'Shifts', icon: Store },
    { tab: 'ANALYTICS', shortLabel: 'Reports', icon: TrendingUp }
  ];

  return (
    <div className="min-h-screen w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans flex flex-col select-none pb-24 transition-colors duration-200">
      {/* 1. TOP EXECUTIVE HEADER - FITTED & IDENTICAL TO LAPTOP ADMIN THEME */}
      <header className="h-15 shrink-0 z-40 sticky top-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 flex items-center justify-between gap-2 shadow-xs w-full max-w-full min-w-0">
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <MuchachosBrand size="sm" subtitle="EXECUTIVE" />
        </div>

        {/* Right header buttons: Dark/Light Mode, Refresh, Logout (Fits in ~135px with zero overflow) */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick Dark / Light Theme Toggle */}
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

          {/* Refresh Data */}
          <button
            onClick={() => loadData(false)}
            disabled={isRefreshing}
            className="h-8 w-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-all flex items-center justify-center cursor-pointer shadow-2xs active:scale-95 shrink-0"
            title="Refresh Live Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-blue-600 dark:text-blue-400' : ''}`} />
          </button>

          {/* Log Out Button */}
          <button
            onClick={handleSignOut}
            className="h-8 px-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 rounded-xl text-xs font-black transition-all shadow-2xs active:scale-95 cursor-pointer flex items-center justify-center gap-1 shrink-0 whitespace-nowrap"
            title="Sign Out"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="font-bold">Exit</span>
          </button>
        </div>
      </header>

      {/* 2. TIME RANGE & FOODPANDA FILTER RIBBON - IDENTICAL TO LAPTOP ADMIN PILLS */}
      <section className="px-3 sm:px-4 pt-3 pb-2 space-y-2">
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar py-0.5">
          {/* Segmented Time Range Pills (Same as AdminOverview.tsx) */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
            {[
              { id: 'TODAY', label: 'Today' },
              { id: 'CURRENT_SHIFT', label: 'Shift' },
              { id: 'YESTERDAY', label: 'Yesterday' },
              { id: '7_DAYS', label: '7 Days' },
              { id: 'THIS_MONTH', label: 'Month' },
              { id: 'CUSTOM_DATE', label: 'Custom' }
            ].map(p => {
              const active = timeRange === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setTimeRange(p.id as MobileTimeRange)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Foodpanda Accrual Checkbox (Same as AdminOverview.tsx) */}
          <label className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer shrink-0">
            <input 
              type="checkbox" 
              checked={includePendingFp} 
              onChange={toggleIncludeFp} 
              className="w-3.5 h-3.5 accent-[#D70F64] rounded cursor-pointer" 
            />
            <span className="text-[10px] font-black">FP Net</span>
          </label>
        </div>

        {/* Calendar Stepper if Custom Date selected */}
        {timeRange === 'CUSTOM_DATE' && (
          <div className="flex items-center justify-between bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-1 shadow-2xs">
            <button 
              onClick={() => stepCustomDate(-1)} 
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <input
                type="date"
                value={selectedCustomDate}
                onChange={e => setSelectedCustomDate(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-800 dark:text-slate-200 outline-none cursor-pointer"
              />
            </div>
            <button 
              onClick={() => stepCustomDate(1)} 
              className="p-1.5 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </section>

      {/* 3. TOP 4 PRIMARY KPI CARDS - IDENTICAL CARD THEME */}
      <section className="px-3 sm:px-4 py-2">
        <div className="grid grid-cols-2 gap-2.5">
          {/* Card 1: Net Sales */}
          <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Net Sales</span>
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                {metrics.completedCount} orders
              </span>
            </div>
            <div>
              <div className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                Rs. {Math.round(metrics.netSales).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                Gross: Rs. {Math.round(metrics.grossSales).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Card 2: Operating Gross Profit */}
          <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Profit</span>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md border ${
                metrics.operatingProfit >= 0 
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' 
                  : 'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800'
              }`}>
                {metrics.profitMarginPct.toFixed(1)}%
              </span>
            </div>
            <div>
              <div className={`text-xl font-black tracking-tight ${metrics.operatingProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                Rs. {Math.round(metrics.operatingProfit).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                COGS: Rs. {Math.round(metrics.totalCogs).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Card 3: Real-Time Cash in Drawer */}
          <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">Drawer Cash</span>
              <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md border ${
                activeShift
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
              }`}>
                {activeShift ? 'Open' : 'Closed'}
              </span>
            </div>
            <div>
              <div className="text-xl font-black text-emerald-600 dark:text-emerald-400 tracking-tight">
                Rs. {Math.round(metrics.liveCashInDrawer).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                {activeShift ? `Float: Rs. ${activeShift.starting_cash}` : 'No active shift'}
              </div>
            </div>
          </div>

          {/* Card 4: Pending Foodpanda Accrual */}
          <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 dark:text-slate-400 mb-1">
              <span className="text-[11px] font-bold uppercase tracking-wider">FP Pending</span>
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded-md bg-pink-50 dark:bg-pink-950/60 text-[#D70F64] border border-pink-200 dark:border-pink-800">
                {metrics.fpPendingCount} orders
              </span>
            </div>
            <div>
              <div className="text-xl font-black text-[#D70F64] tracking-tight">
                Rs. {Math.round(metrics.fpPendingNet).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                Less 30%: Rs. {Math.round(metrics.fpPendingComm).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. MAIN ACTIVE VIEW TABS */}
      <main className="flex-1 px-3 sm:px-4 py-2">
        {/* ============================================================== */}
        {/* TAB 1: DASHBOARD                                              */}
        {/* ============================================================== */}
        {activeTab === 'DASHBOARD' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Deficit Warning Banner */}
            {stockDeficits.totalAlerts > 0 && (
              <div 
                onClick={() => { setActiveTab('STOCK'); setStockSubTab('INVENTORY'); }}
                className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 shadow-xs flex items-center justify-between cursor-pointer active:scale-98 transition-all"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-red-100 dark:bg-red-900/40 border border-red-200 dark:border-red-800 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                    <AlertTriangle className="w-4 h-4 animate-bounce" />
                  </div>
                  <div>
                    <div className="text-xs font-black text-red-700 dark:text-red-300">
                      {stockDeficits.negativeItems.length > 0 
                        ? `🚨 ${stockDeficits.negativeItems.length} Ingredients in Negative Deficit!`
                        : `⚠️ ${stockDeficits.lowStockItems.length} Ingredients Below Low Stock Alert!`}
                    </div>
                    <div className="text-[10px] text-red-600/80 dark:text-red-400/80 font-semibold">
                      Tap here to inspect stock &amp; deficit counts
                    </div>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-red-500" />
              </div>
            )}

            {/* Active Shift Card */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Store className="w-4 h-4 text-[#E11D2A]" />
                  <span className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">
                    Shift Cockpit
                  </span>
                </div>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                  activeShift 
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' 
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                }`}>
                  {activeShift ? `ACTIVE (${activeShift.cashier_name || 'Cashier'})` : 'NO SHIFT ACTIVE'}
                </span>
              </div>

              {activeShift ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Shift Opened</div>
                    <div className="text-xs font-black text-slate-900 dark:text-white mt-0.5">
                      {new Date(activeShift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Starting Float</div>
                    <div className="text-xs font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                      Rs. {activeShift.starting_cash.toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Shift Cash Sales</div>
                    <div className="text-xs font-black text-slate-900 dark:text-white mt-0.5">
                      Rs. {Math.round(metrics.cashSales).toLocaleString()}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Drawer Payouts</div>
                    <div className="text-xs font-black text-rose-600 dark:text-rose-400 mt-0.5">
                      Rs. {Math.round(metrics.drawerExp).toLocaleString()}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-2 text-xs text-slate-400">
                  Cash drawer closed. Open a shift on terminal to start logging.
                </div>
              )}
            </div>

            {/* Sales Channel Breakdown */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">Order Channels</span>
                <span className="text-[10px] font-semibold text-slate-400">Selected Range</span>
              </div>

              <div className="space-y-2">
                {[
                  { name: 'Dine-In', amount: metrics.dineInSales, color: 'bg-blue-600' },
                  { name: 'Takeaway', amount: metrics.takeawaySales, color: 'bg-emerald-600' },
                  { name: 'Foodpanda', amount: metrics.fpChannelSales, color: 'bg-[#D70F64]' }
                ].map(c => {
                  const pct = metrics.netSales > 0 ? ((c.amount / metrics.netSales) * 100) : 0;
                  return (
                    <div key={c.name} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-700 dark:text-slate-300">{c.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-slate-900 dark:text-white">Rs. {Math.round(c.amount).toLocaleString()}</span>
                          <span className="text-[10px] text-slate-400 font-semibold w-9 text-right">{pct.toFixed(0)}%</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className={`h-full ${c.color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Payment Method Breakdown */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">Payment Methods</span>
                <span className="text-[10px] font-semibold text-slate-400">Total Net</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase">Cash</div>
                  <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">Rs. {Math.round(metrics.cashSales).toLocaleString()}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                  <div className="text-[10px] text-rose-600 dark:text-rose-400 font-bold uppercase">JazzCash</div>
                  <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">Rs. {Math.round(metrics.jazzcashSales).toLocaleString()}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                  <div className="text-[10px] text-teal-600 dark:text-teal-400 font-bold uppercase">EasyPaisa</div>
                  <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">Rs. {Math.round(metrics.easypaisaSales).toLocaleString()}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700/60">
                  <div className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase">Card / Digital</div>
                  <div className="text-sm font-black text-slate-900 dark:text-white mt-0.5">Rs. {Math.round(metrics.digitalSales).toLocaleString()}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: ORDERS                                                 */}
        {/* ============================================================== */}
        {activeTab === 'ORDERS' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Search & Channel Filter */}
            <div className="space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search token #, item, payment..."
                  value={orderSearchQuery}
                  onChange={e => setOrderSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500 transition-all shadow-xs"
                />
              </div>

              {/* Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
                {(['ALL', 'TAKEAWAY', 'DINE_IN', 'FOODPANDA'] as const).map(ch => (
                  <button
                    key={ch}
                    onClick={() => setOrderChannelFilter(ch)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap cursor-pointer ${
                      orderChannelFilter === ch
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {ch.replace('_', ' ')}
                  </button>
                ))}
                {(['ALL', 'COMPLETED', 'PENDING', 'CANCELLED'] as const).map(st => (
                  <button
                    key={st}
                    onClick={() => setOrderStatusFilter(st)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase transition-all whitespace-nowrap cursor-pointer ${
                      orderStatusFilter === st
                        ? 'bg-slate-700 text-white'
                        : 'bg-slate-100 dark:bg-slate-850 border border-slate-200 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Orders Feed */}
            {filteredOrdersList.length === 0 ? (
              <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-2 shadow-xs">
                <ClipboardList className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="text-xs font-bold text-slate-500 dark:text-slate-400">No orders found for this filter.</div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredOrdersList.map(order => {
                  const channelBadge = {
                    DINE_IN: { label: 'Dine-In', color: 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' },
                    TAKEAWAY: { label: 'Takeaway', color: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
                    FOODPANDA: { label: 'Foodpanda', color: 'bg-pink-50 dark:bg-pink-950/60 text-[#D70F64] border border-pink-200 dark:border-pink-800' }
                  }[order.order_type] || { label: order.order_type, color: 'bg-slate-100 text-slate-700 border-slate-200' };

                  return (
                    <div
                      key={order.id}
                      onClick={() => setSelectedReceiptOrder(order)}
                      className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs active:scale-98 transition-all cursor-pointer space-y-2 hover:border-slate-300 dark:hover:border-slate-700"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-slate-900 dark:text-white tracking-tight font-mono">
                            #{order.token_number.toString().padStart(3, '0')}
                          </span>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${channelBadge.color}`}>
                            {channelBadge.label}
                            {order.table_number ? ` (T${order.table_number})` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-black text-emerald-600 dark:text-emerald-400 font-mono">
                            Rs. {Math.round(order.net_total).toLocaleString()}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        </div>
                      </div>

                      {/* Items Preview */}
                      <div className="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
                        {(order.order_items || []).slice(0, 3).map((it, idx) => (
                          <div key={idx} className="truncate flex items-center justify-between text-[11px]">
                            <span className="truncate">
                              <strong className="text-slate-900 dark:text-white font-mono">{it.quantity}x</strong> {it.item_name}
                              {it.modifiers_json && it.modifiers_json.length > 0 && (
                                <span className="text-slate-400 text-[10px]"> (+{it.modifiers_json.map(m => m.name).join(', ')})</span>
                              )}
                            </span>
                            <span className="text-slate-500 font-mono text-[10px] shrink-0 ml-2">
                              Rs. {Math.round(it.total_price).toLocaleString()}
                            </span>
                          </div>
                        ))}
                        {(order.order_items || []).length > 3 && (
                          <div className="text-[10px] text-slate-400 font-semibold italic">
                            + {(order.order_items || []).length - 3} more items...
                          </div>
                        )}
                      </div>

                      {/* Footer */}
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-400" />
                          <span>{new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-slate-600 dark:text-slate-300">{order.payment_method}</span>
                          <span className={`px-1.5 py-0.2 rounded font-black ${
                            order.status === 'COMPLETED' ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60' :
                            order.status === 'CANCELLED' ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/60' :
                            'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60'
                          }`}>
                            {order.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: STOCK                                                  */}
        {/* ============================================================== */}
        {activeTab === 'STOCK' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Sub-tab toggle */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-xs font-black">
              <button
                onClick={() => setStockSubTab('INVENTORY')}
                className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                  stockSubTab === 'INVENTORY' ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Stock &amp; Deficits ({inventory.length})
              </button>
              <button
                onClick={() => setStockSubTab('SPOILAGE')}
                className={`py-1.5 rounded-lg transition-all cursor-pointer ${
                  stockSubTab === 'SPOILAGE' ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs' : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                Spoilage Loss ({windowSpoilage.length})
              </button>
            </div>

            {stockSubTab === 'INVENTORY' ? (
              <div className="space-y-3">
                {/* Search & Stock Filter */}
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Search inventory ingredients..."
                      value={inventorySearchQuery}
                      onChange={e => setInventorySearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500 transition-all shadow-xs"
                    />
                  </div>

                  <div className="flex items-center gap-1.5">
                    {[
                      { id: 'ALL', label: `All (${inventory.length})` },
                      { id: 'DEFICIT', label: `🚨 Deficit (${stockDeficits.negativeItems.length})` },
                      { id: 'LOW', label: `⚠️ Low Stock (${stockDeficits.lowStockItems.length})` }
                    ].map(f => (
                      <button
                        key={f.id}
                        onClick={() => setInventoryFilter(f.id as any)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                          inventoryFilter === f.id
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Priority Negative Deficit Notice */}
                {stockDeficits.negativeItems.length > 0 && inventoryFilter !== 'LOW' && (
                  <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 shadow-xs space-y-2">
                    <div className="flex items-center gap-2 text-xs font-black text-red-700 dark:text-red-300">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      CRITICAL NEGATIVE STOCK IN USE ({stockDeficits.negativeItems.length})
                    </div>
                    <div className="space-y-1.5">
                      {stockDeficits.negativeItems.map(item => (
                        <div key={item.id} className="p-2 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-red-200 dark:border-red-900/60 flex items-center justify-between text-xs">
                          <div>
                            <div className="font-black text-slate-900 dark:text-white">{item.name}</div>
                            <div className="text-[10px] text-red-600 dark:text-red-400">
                              Unit Cost: Rs. {item.cost_per_unit} / {item.unit}
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black text-red-600 dark:text-red-400 font-mono">
                              {item.current_stock} {item.unit}
                            </span>
                            <div className="text-[9px] text-red-600 font-bold uppercase">DEFICIT</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Regular Stock List */}
                <div className="space-y-2">
                  {filteredInventoryList.map(item => {
                    const isDeficit = item.current_stock < 0;
                    const isLow = !isDeficit && item.current_stock <= (item.min_stock_alert || 5);

                    return (
                      <div
                        key={item.id}
                        className={`p-3 rounded-2xl border transition-all flex items-center justify-between shadow-xs ${
                          isDeficit
                            ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-900'
                            : isLow
                            ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                        }`}
                      >
                        <div>
                          <div className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-1.5">
                            {item.name}
                            {isDeficit && (
                              <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-red-600 text-white uppercase">
                                DEFICIT
                              </span>
                            )}
                            {isLow && (
                              <span className="text-[8px] font-black px-1.5 py-0.2 rounded bg-amber-600 text-white uppercase">
                                LOW
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            Cost: Rs. {item.cost_per_unit} / {item.unit} • Alert at {item.min_stock_alert} {item.unit}
                          </div>
                        </div>

                        <div className="text-right">
                          <div className={`text-sm font-mono font-black ${
                            isDeficit ? 'text-red-600 dark:text-red-400' : isLow ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                          }`}>
                            {item.current_stock} <span className="text-[10px] font-sans font-semibold text-slate-400">{item.unit}</span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Val: Rs. {Math.round(Math.max(0, item.current_stock) * item.cost_per_unit).toLocaleString()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Spoilage Loss Logs */
              <div className="space-y-3">
                <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Waste Loss</div>
                    <div className="text-xl font-black text-red-600 dark:text-red-400 mt-0.5">
                      Rs. {Math.round(metrics.spoilageLoss).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-[10px] font-black px-2 py-1 rounded-lg bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800">
                    {windowSpoilage.length} events
                  </div>
                </div>

                {windowSpoilage.length === 0 ? (
                  <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-2 shadow-xs">
                    <Package className="w-8 h-8 text-slate-400 mx-auto" />
                    <div className="text-xs font-bold text-slate-400">Zero spoilage recorded in this period.</div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {windowSpoilage.map(sp => (
                      <div key={sp.id} className="p-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-black text-slate-900 dark:text-white">{sp.item_name}</span>
                          <span className="font-mono font-black text-red-600 dark:text-red-400">
                            -Rs. {Math.round(sp.cost_loss).toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-400">
                          <span>Qty: {sp.quantity} • Reason: {sp.reason}</span>
                          <span>{new Date(sp.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 4: SHIFTS                                                 */}
        {/* ============================================================== */}
        {activeTab === 'SHIFTS' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Active Shift Card */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">Active Shift Drawer</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                  activeShift ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                }`}>
                  {activeShift ? 'CURRENT OPEN' : 'NO ACTIVE SHIFT'}
                </span>
              </div>

              {activeShift ? (
                <div className="space-y-2.5">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <div>
                      <div className="text-[10px] text-slate-400 font-bold">Cashier in Charge</div>
                      <div className="text-sm font-black text-slate-900 dark:text-white">{activeShift.cashier_name || 'Terminal Cashier'}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400 font-bold">Opened At</div>
                      <div className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                        {new Date(activeShift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                      <div className="text-[10px] text-slate-400 font-semibold">Starting Float</div>
                      <div className="text-xs font-mono font-black text-slate-900 dark:text-white mt-0.5">
                        Rs. {activeShift.starting_cash.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                      <div className="text-[10px] text-slate-400 font-semibold">Cash Sales In</div>
                      <div className="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                        + Rs. {Math.round(metrics.cashSales).toLocaleString()}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                      <div className="text-[10px] text-slate-400 font-semibold">Drawer Payouts</div>
                      <div className="text-xs font-mono font-black text-rose-600 dark:text-rose-400 mt-0.5">
                        - Rs. {Math.round(metrics.drawerExp).toLocaleString()}
                      </div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                      <div className="text-[10px] text-slate-400 font-semibold">Cash in Drawer Now</div>
                      <div className="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400 mt-0.5">
                        = Rs. {Math.round(metrics.liveCashInDrawer).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-slate-400 text-center py-2">
                  No cashier is currently signed into the terminal drawer.
                </div>
              )}
            </div>

            {/* Historical Z-Reports */}
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">Past Closed Shifts &amp; Z-Reports</span>
                <span className="text-[10px] font-semibold text-slate-400">{shifts.filter(s => s.status === 'CLOSED').length} shifts</span>
              </div>

              {shifts.filter(s => s.status === 'CLOSED').length === 0 ? (
                <div className="p-8 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-2 shadow-xs">
                  <Store className="w-8 h-8 text-slate-400 mx-auto" />
                  <div className="text-xs font-bold text-slate-400">No closed shifts recorded yet.</div>
                </div>
              ) : (
                shifts.filter(s => s.status === 'CLOSED').map(shift => {
                  const isExpanded = expandedShiftId === shift.id;
                  const diff = shift.cash_difference || 0;
                  const isShort = diff < 0;
                  const isOver = diff > 0;

                  return (
                    <div
                      key={shift.id}
                      className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-2"
                    >
                      <div 
                        onClick={() => setExpandedShiftId(isExpanded ? null : shift.id)}
                        className="flex items-center justify-between cursor-pointer"
                      >
                        <div>
                          <div className="text-xs font-black text-slate-900 dark:text-white flex items-center gap-2">
                            <span>{shift.cashier_name || 'Cashier'}</span>
                            <span className="text-[9px] font-mono text-slate-400">
                              {new Date(shift.opened_at).toLocaleDateString()}
                            </span>
                          </div>
                          <div className="text-[10px] text-slate-400 font-semibold mt-0.5">
                            Sales: Rs. {Math.round(shift.total_sales).toLocaleString()} • Net Cash: Rs. {Math.round(shift.cash_sales).toLocaleString()}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-right">
                          <div>
                            <div className="text-xs font-mono font-black text-slate-900 dark:text-white">
                              Rs. {Math.round(shift.actual_cash || 0).toLocaleString()}
                            </div>
                            <div className={`text-[10px] font-mono font-bold ${
                              isShort ? 'text-red-600 dark:text-red-400' : isOver ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'
                            }`}>
                              {isShort ? `Short: Rs. ${diff}` : isOver ? `Over: +Rs. ${diff}` : 'Balanced (0)'}
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                        </div>
                      </div>

                      {/* Expanded Z-Report Details */}
                      {isExpanded && (
                        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 text-xs space-y-2 animate-in fade-in">
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg">
                              <span className="text-slate-400">Starting Float:</span>
                              <div className="font-mono font-bold text-slate-900 dark:text-white">Rs. {shift.starting_cash}</div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg">
                              <span className="text-slate-400">Drawer Expenses:</span>
                              <div className="font-mono font-bold text-rose-600 dark:text-rose-400">Rs. {shift.drawer_expenses}</div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg">
                              <span className="text-slate-400">Expected Cash:</span>
                              <div className="font-mono font-bold text-slate-900 dark:text-white">Rs. {shift.expected_cash}</div>
                            </div>
                            <div className="bg-slate-50 dark:bg-slate-800/60 p-2 rounded-lg">
                              <span className="text-slate-400">Actual Counted:</span>
                              <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400">Rs. {shift.actual_cash}</div>
                            </div>
                          </div>
                          {shift.notes && (
                            <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/40 text-[10px] text-slate-400 italic">
                              Note: {shift.notes}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 5: ANALYTICS                                              */}
        {/* ============================================================== */}
        {activeTab === 'ANALYTICS' && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Executive P&L Statement */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">P&amp;L Statement</span>
                <span className="text-[10px] font-semibold text-slate-400">Selected Range</span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300 font-semibold">Gross Sales</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">Rs. {Math.round(metrics.grossSales).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span>Less: Discounts</span>
                  <span className="font-mono text-rose-600 dark:text-rose-400">- Rs. {Math.round(metrics.discounts).toLocaleString()}</span>
                </div>
                <div className="pt-1.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between font-bold">
                  <span className="text-slate-900 dark:text-white">Net Sales</span>
                  <span className="font-mono text-slate-900 dark:text-white">Rs. {Math.round(metrics.netSales).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span>Less: COGS (Recipes/Stock)</span>
                  <span className="font-mono text-rose-600 dark:text-rose-400">- Rs. {Math.round(metrics.totalCogs).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span>Less: Spoilage / Wastage</span>
                  <span className="font-mono text-rose-600 dark:text-rose-400">- Rs. {Math.round(metrics.spoilageLoss).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                  <span>Less: Operating Expenses</span>
                  <span className="font-mono text-rose-600 dark:text-rose-400">- Rs. {Math.round(metrics.totalExp).toLocaleString()}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-sm font-black">
                  <span className="text-slate-900 dark:text-white">True Operating Profit</span>
                  <span className={`font-mono ${metrics.operatingProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                    Rs. {Math.round(metrics.operatingProfit).toLocaleString()}
                  </span>
                </div>
                <div className="text-[10px] text-right text-slate-400 font-semibold">
                  Profit Margin: <strong className="text-emerald-600 dark:text-emerald-400">{metrics.profitMarginPct.toFixed(1)}%</strong>
                </div>
              </div>
            </div>

            {/* Foodpanda Reconciliation Hub */}
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Bike className="w-4 h-4 text-[#D70F64]" />
                  <span className="text-xs font-black text-slate-800 dark:text-white uppercase tracking-wider">Foodpanda Settlement Hub</span>
                </div>
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-pink-50 dark:bg-pink-950/60 text-[#D70F64] border border-pink-200 dark:border-pink-800">
                  30% Commission
                </span>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">Pending Orders Count:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">{metrics.fpPendingCount} orders</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">Pending Gross Orders:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">Rs. {Math.round(metrics.fpPendingGross).toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-rose-600 dark:text-rose-400">
                  <span>Estimated Foodpanda Fee (30%):</span>
                  <span className="font-mono font-bold">- Rs. {Math.round(metrics.fpPendingComm).toLocaleString()}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between font-black text-sm text-emerald-600 dark:text-emerald-400">
                  <span>Expected Bank Payout:</span>
                  <span className="font-mono">Rs. {Math.round(metrics.fpPendingNet).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 5. 80MM THERMAL RECEIPT SLIP MODAL */}
      {selectedReceiptOrder && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white text-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl p-6 font-mono text-xs flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-6">
            <div className="flex items-center justify-between pb-3 border-b-2 border-dashed border-slate-300 mb-3">
              <span className="font-black text-base tracking-widest uppercase">MUCHACHOS</span>
              <button 
                onClick={() => setSelectedReceiptOrder(null)} 
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-500 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-center pb-3 border-b-2 border-dashed border-slate-300 mb-3 space-y-0.5">
              <h3 className="text-3xl font-black">
                #{selectedReceiptOrder.token_number.toString().padStart(3, '0')}
              </h3>
              <p className="font-black text-slate-600 uppercase">
                {selectedReceiptOrder.order_type.replace('_', ' ')}
                {selectedReceiptOrder.table_number ? ` - TABLE ${selectedReceiptOrder.table_number}` : ''}
              </p>
              <p className="text-[10px] text-slate-500">
                {new Date(selectedReceiptOrder.created_at).toLocaleString()}
              </p>
            </div>

            {/* Receipt Items */}
            <div className="flex-1 overflow-y-auto space-y-2 py-2 border-b-2 border-dashed border-slate-300">
              {(selectedReceiptOrder.order_items || []).map((it, idx) => (
                <div key={idx} className="space-y-0.5">
                  <div className="flex justify-between font-bold">
                    <span>{it.quantity}x {it.item_name}</span>
                    <span>Rs. {Math.round(it.total_price).toLocaleString()}</span>
                  </div>
                  {it.modifiers_json && it.modifiers_json.length > 0 && (
                    <ul className="pl-3 text-[10px] text-slate-600">
                      {it.modifiers_json.map((m: any, mIdx: number) => (
                        <li key={mIdx}>+ {m.qty || 1}x {m.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            {/* Pricing Totals */}
            <div className="pt-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>Rs. {Math.round(selectedReceiptOrder.subtotal).toLocaleString()}</span>
              </div>
              {selectedReceiptOrder.discount > 0 && (
                <div className="flex justify-between text-red-600 font-bold">
                  <span>Discount:</span>
                  <span>- Rs. {Math.round(selectedReceiptOrder.discount).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-base font-black pt-1 border-t border-slate-300">
                <span>NET TOTAL:</span>
                <span>Rs. {Math.round(selectedReceiptOrder.net_total).toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-600 pt-1">
                <span>Paid via:</span>
                <span className="font-bold uppercase">{selectedReceiptOrder.payment_method}</span>
              </div>
            </div>

            <button
              onClick={() => setSelectedReceiptOrder(null)}
              className="mt-4 w-full py-2.5 rounded-xl bg-slate-900 text-white font-black text-xs uppercase tracking-wider cursor-pointer active:scale-98 transition-all"
            >
              Close Receipt
            </button>
          </div>
        </div>
      )}

      {/* 6. FIXED FLOATING BOTTOM DOCK - IDENTICAL TO LAPTOP ADMIN (lines 630-635) */}
      <nav className="fixed bottom-3 left-3 right-3 sm:left-6 sm:right-6 max-w-lg mx-auto z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800/90 shadow-[0_8px_30px_rgba(0,0,0,0.12)] rounded-2xl p-1.5 safe-area-pb">
        <div className="flex items-center justify-around gap-1 w-full">
          {navItems.map(({ tab, shortLabel, icon: Icon }) => {
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as MobileTab)}
                className={`flex flex-col items-center justify-center py-1.5 px-0.5 rounded-xl transition-all duration-150 active:scale-95 cursor-pointer select-none flex-1 min-w-0 ${
                  isActive 
                    ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60' 
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                }`}
              >
                <div className={`p-1 rounded-lg transition-all duration-200 ${
                  isActive 
                    ? 'text-blue-600 dark:text-blue-400 scale-105' 
                    : 'bg-transparent'
                }`}>
                  <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <span className={`text-[8.5px] sm:text-[9.5px] mt-0.5 tracking-tight truncate w-full text-center px-0.5 leading-none ${
                  isActive ? 'font-black text-blue-600 dark:text-blue-400' : 'font-semibold text-slate-400 dark:text-slate-500'
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

