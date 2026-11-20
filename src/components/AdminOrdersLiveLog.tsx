"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { adminCache, CACHE_TTL } from "@/lib/admin-cache";
import { 
  Search, RefreshCw, Send, CheckCircle2, Clock, 
  Utensils, Printer, AlertTriangle, Eye, FileText, Bike,
  Calendar, Check, RotateCcw, AlertCircle, ChevronLeft, ChevronRight, X,
  ShoppingBag, Filter, Trash2, ClipboardList
} from "lucide-react";
import { db } from "@/lib/db";
import { posBus } from "@/lib/broadcast-bus";
import { cancelAndRestockOrder } from "@/lib/inventory-service";
import { modal } from "@/lib/modalStore";
import { supabase } from "@/lib/supabase";
import { isLaptopWriter } from "@/lib/device-mode";

interface OrderItemDetail {
  id?: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  modifiers_json?: { name: string; qty?: number; price?: number }[];
}

interface AdminOrderRecord {
  id: string;
  token_number: number;
  order_type: 'TAKEAWAY' | 'DINE_IN' | 'FOODPANDA';
  payment_method: string;
  table_number?: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'OPEN_TAB';
  subtotal: number;
  discount: number;
  net_total: number;
  foodpanda_commission_pct: number;
  fp_payout_status?: string;
  created_at: string;
  shift_id?: string;
  order_items: OrderItemDetail[];
}

interface AdminOrdersLiveLogProps {
  refreshTrigger?: number;
}

export default function AdminOrdersLiveLog({ refreshTrigger }: AdminOrdersLiveLogProps = {}) {
  const [selectedDate, setSelectedDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [dateMode, setDateMode] = useState<'DATE' | 'ACTIVE_SHIFT'>('DATE');
  const [orders, setOrders] = useState<AdminOrderRecord[]>([]);
  const [shifts, setShifts] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'OPEN_TAB' | 'COMPLETED' | 'CANCELLED'>('ALL');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'DINE_IN' | 'TAKEAWAY' | 'FOODPANDA'>('ALL');
  const [selectedShiftFilter, setSelectedShiftFilter] = useState<string>('ALL');
  const [selectedOrderForSlip, setSelectedOrderForSlip] = useState<AdminOrderRecord | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [isActionProcessing, setIsActionProcessing] = useState(false);
  const isLaptop = isLaptopWriter();

  const ordersDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const getOrdersCacheKey = useCallback(() => {
    return `orders_${dateMode}_${selectedDate}`;
  }, [dateMode, selectedDate]);

  const handleStepDate = (days: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    const yStr = dt.getFullYear();
    const mStr = String(dt.getMonth() + 1).padStart(2, '0');
    const dStr = String(dt.getDate()).padStart(2, '0');
    const nextDate = `${yStr}-${mStr}-${dStr}`;
    setDateMode('DATE');
    setSelectedDate(nextDate);

    // Instant cache check for 0ms stepping
    const key = `orders_DATE_${nextDate}`;
    const cached = adminCache.get<{ orders: AdminOrderRecord[]; shifts: any[] }>(key);
    if (cached) {
      setOrders(cached.orders);
      setShifts(cached.shifts);
      setIsLoading(false);
    }
  };

  const fetchOrdersForDate = useCallback(async (showLoadingSpinner = true, forceBypassCache = false) => {
    const key = getOrdersCacheKey();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const isLive = dateMode === 'ACTIVE_SHIFT' || selectedDate === todayStr;

    const cached = adminCache.get<{ orders: AdminOrderRecord[]; shifts: any[] }>(
      key, 
      isLive ? CACHE_TTL.LIVE_TODAY : CACHE_TTL.HISTORIC_DATE
    );

    if (cached && !forceBypassCache) {
      setOrders(cached.orders);
      setShifts(cached.shifts);
      setIsLoading(false);
      return;
    }

    if (showLoadingSpinner) {
      setIsLoading(true);
    }

    // Offline Local Dexie Fallback
    const loadFromDexieFallback = async () => {
      try {
        const localShifts = await db.shifts.toArray();
        const localOrders = await db.orders.toArray();

        if (dateMode === 'ACTIVE_SHIFT') {
          const activeShift = localShifts.find(s => s.status === 'OPEN') || localShifts[localShifts.length - 1];
          if (activeShift) {
            setShifts([activeShift]);
            const filteredOrders = localOrders
              .filter(o => o.created_at >= activeShift.opened_at)
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const mappedOrders = filteredOrders.map(o => ({
              ...o,
              order_items: (o.items || []) as any[]
            })) as AdminOrderRecord[];
            setOrders(mappedOrders);
            return;
          }
        }

        // Date mode filter: compare in user's local timezone (en-CA -> YYYY-MM-DD)
        const filteredOrders = localOrders
          .filter(o => {
            if (!o.created_at) return false;
            try {
              const orderDateStr = new Date(o.created_at).toLocaleDateString('en-CA');
              return orderDateStr === selectedDate || o.created_at.startsWith(selectedDate);
            } catch {
              return o.created_at.startsWith(selectedDate);
            }
          })
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        const mappedOrders = filteredOrders.map(o => ({
          ...o,
          order_items: (o.items || []) as any[]
        })) as AdminOrderRecord[];
        setOrders(mappedOrders);

        const filteredShifts = localShifts.filter(s => {
          if (!s.opened_at) return false;
          try {
            const shiftDateStr = new Date(s.opened_at).toLocaleDateString('en-CA');
            return shiftDateStr === selectedDate || s.opened_at.startsWith(selectedDate);
          } catch {
            return s.opened_at.startsWith(selectedDate);
          }
        });
        setShifts(filteredShifts);
      } catch (localErr) {
        console.warn("[AdminOrders] Local fallback error:", localErr);
      }
    };

    // Remote Supabase query for Vercel / Mobile phone viewer
    const loadFromSupabase = async () => {
      try {
        let ordersQuery = supabase.from('orders').select('*');
        let shiftsQuery = supabase.from('cashier_shifts').select('*');

        if (dateMode === 'ACTIVE_SHIFT') {
          const { data: latestShifts } = await supabase.from('cashier_shifts').select('*').order('opened_at', { ascending: false }).limit(1);
          if (latestShifts && latestShifts.length > 0) {
            setShifts(latestShifts);
            const activeShift = latestShifts[0];
            const [shiftOrdersRes, orderItemsRes] = await Promise.all([
              supabase
                .from('orders')
                .select('*')
                .gte('created_at', activeShift.opened_at)
                .order('created_at', { ascending: false }),
              supabase.from('order_items').select('*')
            ]);

            const shiftOrders = shiftOrdersRes.data || [];
            const itemsByOrder = new Map<string, any[]>();
            (orderItemsRes.data || []).forEach((it: any) => {
              if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
              itemsByOrder.get(it.order_id)!.push(it);
            });

            const mapped = shiftOrders.map((o: any) => ({
              ...o,
              order_items: (Array.isArray(o.items) && o.items.length > 0 ? o.items : (itemsByOrder.get(o.id) || [])) as any[]
            })) as AdminOrderRecord[];
            setOrders(mapped);
            return;
          }
        }

        const startOfDay = `${selectedDate}T00:00:00.000Z`;
        const endOfDay = `${selectedDate}T23:59:59.999Z`;

        const [ordersRes, shiftsRes, itemsRes] = await Promise.all([
          ordersQuery.gte('created_at', startOfDay).lte('created_at', endOfDay).order('created_at', { ascending: false }),
          shiftsQuery.gte('opened_at', startOfDay).lte('opened_at', endOfDay).order('opened_at', { ascending: false }),
          supabase.from('order_items').select('*')
        ]);

        const remoteOrders = ordersRes.data || [];
        const remoteShifts = shiftsRes.data || [];
        const remoteItems = itemsRes.data || [];

        const itemsByOrder = new Map<string, any[]>();
        remoteItems.forEach((it: any) => {
          if (!itemsByOrder.has(it.order_id)) itemsByOrder.set(it.order_id, []);
          itemsByOrder.get(it.order_id)!.push(it);
        });

        const mapped = remoteOrders.map((o: any) => ({
          ...o,
          order_items: (Array.isArray(o.items) && o.items.length > 0 ? o.items : (itemsByOrder.get(o.id) || [])) as any[]
        })) as AdminOrderRecord[];

        setOrders(mapped);
        setShifts(remoteShifts);
      } catch (remoteErr) {
        console.warn("[AdminOrders] Remote Supabase error:", remoteErr);
      }
    };

    if (isLaptopWriter()) {
      await loadFromDexieFallback();
    } else {
      await loadFromSupabase();
    }
    setIsLoading(false);
  }, [selectedDate, dateMode, getOrdersCacheKey]);

  useEffect(() => {
    const key = getOrdersCacheKey();
    const cached = adminCache.get<{ orders: AdminOrderRecord[]; shifts: any[] }>(key);
    if (cached) {
      setOrders(cached.orders);
      setShifts(cached.shifts);
      setIsLoading(false);
      return;
    }

    if (ordersDebounceRef.current) clearTimeout(ordersDebounceRef.current);
    ordersDebounceRef.current = setTimeout(() => {
      fetchOrdersForDate(true, false);
    }, 60);

    return () => {
      if (ordersDebounceRef.current) clearTimeout(ordersDebounceRef.current);
    };
  }, [selectedDate, dateMode, fetchOrdersForDate, getOrdersCacheKey]);

  // Remote Cloud Realtime WebSockets: instant live ticket arrivals on owner's phone
  useEffect(() => {
    if (isLaptopWriter()) return;

    const channel = supabase
      .channel('realtime_admin_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        adminCache.invalidate(`orders_${dateMode}_${selectedDate}`);
        fetchOrdersForDate(false, true);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDate, dateMode, fetchOrdersForDate]);

  // Remote Cloud 20s Background Polling Fallback (Q23: A)
  useEffect(() => {
    if (isLaptopWriter()) return;
    const interval = setInterval(() => {
      fetchOrdersForDate(false, true);
    }, 20000);
    return () => clearInterval(interval);
  }, [fetchOrdersForDate]);

  useEffect(() => {
    const unsubBus = posBus.subscribe((msg: any) => {
      if (['ORDER_CREATED', 'ORDER_COMPLETED', 'ORDER_UPDATED', 'MANUAL_REFRESH', 'SHIFT_CLOSED', 'SHIFT_OPENED'].includes(msg?.type)) {
        adminCache.invalidate(`orders_${dateMode}_${selectedDate}`);
        fetchOrdersForDate(false, true);
      }
    });

    return () => {
      unsubBus();
    };
  }, [selectedDate, dateMode, fetchOrdersForDate]);

  // Direct prop-driven refresh from top executive header
  useEffect(() => {
    if (refreshTrigger) {
      adminCache.invalidate(`orders_${dateMode}_${selectedDate}`);
      fetchOrdersForDate(true, true);
    }
  }, [refreshTrigger, selectedDate, dateMode, fetchOrdersForDate]);

  const showNotification = (msg: string) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(null), 4000);
  };

  // Re-dispatch order to KDS
  const handleResendToKitchen = async (order: AdminOrderRecord) => {
    if (!isLaptopWriter()) return;
    setIsActionProcessing(true);
    try {
      const targetStatus = order.order_type === 'DINE_IN' ? 'OPEN_TAB' : 'PENDING';
      await db.orders.update(order.id, { status: targetStatus, sync_status: 'PENDING' });
      posBus.publish('KOT_SENT', {
        orderId: order.id,
        tokenNumber: order.token_number,
        orderType: order.order_type,
        tableNumber: order.table_number
      });
      modal.toast.success(`Order #${order.token_number.toString().padStart(3, '0')} re-dispatched to Kitchen Display!`);
      await fetchOrdersForDate();
    } catch (err: any) {
      modal.error("Re-dispatch Failed", "Failed to re-send to KDS: " + err.message);
    } finally {
      setIsActionProcessing(false);
    }
  };

  // Mark Completed
  const handleMarkCompleted = async (order: AdminOrderRecord) => {
    if (!isLaptopWriter()) return;
    setIsActionProcessing(true);
    try {
      await db.orders.update(order.id, { status: 'COMPLETED', sync_status: 'PENDING' });
      posBus.publish('ORDER_COMPLETED', {
        orderId: order.id,
        tokenNumber: order.token_number,
        orderType: order.order_type,
        fullOrder: order
      });
      modal.toast.success(`Order #${order.token_number} marked as COMPLETED.`);
      await fetchOrdersForDate();
    } catch (err: any) {
      modal.error("Status Update Failed", "Failed to update status: " + err.message);
    } finally {
      setIsActionProcessing(false);
    }
  };

  // Void/Cancel order with ingredient restocking
  const handleCancelOrder = async (order: AdminOrderRecord) => {
    if (!isLaptopWriter()) return;
    const ok = await modal.confirm({
      title: `Void Order #${order.token_number}?`,
      message: `Are you sure you want to VOID/CANCEL Order #${order.token_number}?\nIngredients deducted for this order will be automatically RESTOCKED back into inventory.`,
      confirmText: "Void & Restock",
      isDanger: true
    });
    if (!ok) return;

    setIsActionProcessing(true);
    try {
      const res = await cancelAndRestockOrder(order.id, "Admin voided order from Live Log");
      if (res.success) {
        modal.success("Order Voided & Restocked", `Order #${order.token_number} was voided.\nIngredients have been reversed and restored to inventory.`);
        await fetchOrdersForDate();
      } else {
        modal.error("Void Failed", res.message);
      }
    } catch (err: any) {
      modal.error("Void Failed", "Failed to void order: " + err.message);
    } finally {
      setIsActionProcessing(false);
    }
  };

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && o.order_type !== typeFilter) return false;
      if (selectedShiftFilter !== 'ALL' && o.shift_id !== selectedShiftFilter) return false;

      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const matchesToken = o.token_number.toString().includes(q) || `#${o.token_number}`.includes(q);
        const matchesTable = o.table_number?.toLowerCase().includes(q);
        const matchesType = o.order_type.toLowerCase().includes(q);
        const matchesPayment = o.payment_method?.toLowerCase().includes(q);
        const matchesItem = (o.order_items || []).some(i => (i.item_name || '').toLowerCase().includes(q));
        return matchesToken || matchesTable || matchesType || matchesPayment || matchesItem;
      }

      return true;
    });
  }, [orders, statusFilter, typeFilter, selectedShiftFilter, searchQuery]);

  // Statistics for selected date
  const stats = useMemo(() => {
    let pendingCount = 0;
    let openTabCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let totalNetSales = 0;
    let fpCount = 0;
    let fpNetSales = 0;

    orders.forEach(o => {
      if (o.status === 'PENDING') pendingCount++;
      else if (o.status === 'OPEN_TAB') openTabCount++;
      else if (o.status === 'COMPLETED') {
        completedCount++;
        totalNetSales += Number(o.net_total || 0);
      } else if (o.status === 'CANCELLED') {
        cancelledCount++;
      }

      if (o.order_type === 'FOODPANDA') {
        fpCount++;
        fpNetSales += Number(o.net_total || 0) * (1 - (Number(o.foodpanda_commission_pct || 30) / 100));
      }
    });

    return {
      total: orders.length,
      pendingCount,
      openTabCount,
      completedCount,
      cancelledCount,
      totalNetSales,
      fpCount,
      fpNetSales
    };
  }, [orders]);

  const isToday = useMemo(() => {
    const d = new Date();
    const todayIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return selectedDate === todayIso;
  }, [selectedDate]);

  return (
    <div className="space-y-6 animate-in fade-in pb-12 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* Top Header */}
      <div className="bg-white dark:bg-slate-900 p-3 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col gap-2.5">
        {/* ROW 1: Title & Refresh Button */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center p-1.5 shadow-xs shrink-0 border border-amber-200 dark:border-amber-800">
              <ClipboardList className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100 tracking-tight flex items-center gap-1.5 truncate">
                <span className="truncate">Orders &amp; Kitchen Live Log</span>
                <span className="text-[9px] font-bold bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800 shrink-0">
                  {dateMode === 'ACTIVE_SHIFT' ? 'Shift' : isToday ? 'Live' : 'Log'}
                </span>
              </h2>
            </div>
          </div>

          {/* Force Refresh Button in Header Row */}
          <button
            onClick={() => fetchOrdersForDate(true, true)}
            disabled={isLoading}
            className="p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-all cursor-pointer shadow-2xs active:scale-95 disabled:opacity-50 shrink-0"
            title="Force Refresh Orders Data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-blue-600 dark:text-blue-400' : ''}`} />
          </button>
        </div>

        {/* ROW 2: Date Selector & Quick Pills (Sleek, Single Row, Zero Wrapping) */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 w-full">
          {/* Calendar Date Stepper Picker */}
          <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xs shrink-0 transition-all">
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
                value={selectedDate}
                onChange={(e) => {
                  setDateMode('DATE');
                  setSelectedDate(e.target.value);
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

          {/* Quick Selection Segmented Pills */}
          <div className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700 text-[11px] font-bold shrink-0">
            <button
              onClick={() => {
                setDateMode('ACTIVE_SHIFT');
              }}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                dateMode === 'ACTIVE_SHIFT' ? 'bg-amber-500 text-slate-950 shadow-xs font-black' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              ⚡ Shift
            </button>
            <button
              onClick={() => {
                setDateMode('DATE');
                const d = new Date();
                setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
              }}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                dateMode === 'DATE' && isToday ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => {
                setDateMode('DATE');
                const d = new Date();
                d.setDate(d.getDate() - 1);
                setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
              }}
              className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                dateMode === 'DATE' && !isToday ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs font-black' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Yesterday
            </button>
          </div>
        </div>
      </div>

      {/* Action Notification */}
      {actionSuccessMsg && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-4 rounded-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-xs font-bold animate-in slide-in-from-top-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{actionSuccessMsg}</span>
        </div>
      )}

      {/* Metric Cards for Selected Date */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider block">Total Orders</span>
          <span className="text-2xl font-black text-slate-800 dark:text-slate-100">{stats.total}</span>
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block mt-0.5">{shifts.length} Shift(s) Combined</span>
        </div>

        <div className="bg-white dark:bg-amber-950/20 p-4 rounded-xl border border-amber-200 dark:border-amber-900/50 shadow-xs">
          <span className="text-[10px] font-black text-amber-500 dark:text-amber-400 uppercase tracking-wider block">In Kitchen (Pending)</span>
          <span className="text-2xl font-black text-amber-600 dark:text-amber-400">{stats.pendingCount}</span>
          <span className="text-[10px] font-bold text-amber-500/80 dark:text-amber-400/80 block mt-0.5">Cooking now</span>
        </div>

        <div className="bg-white dark:bg-blue-950/20 p-4 rounded-xl border border-blue-200 dark:border-blue-900/50 shadow-xs">
          <span className="text-[10px] font-black text-blue-500 dark:text-blue-400 uppercase tracking-wider block">Active Dine-In</span>
          <span className="text-2xl font-black text-blue-600 dark:text-blue-400">{stats.openTabCount}</span>
          <span className="text-[10px] font-bold text-blue-500/80 dark:text-blue-400/80 block mt-0.5">Tables Eating</span>
        </div>

        <div className="bg-white dark:bg-emerald-950/20 p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/50 shadow-xs">
          <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">Completed</span>
          <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{stats.completedCount}</span>
          <span className="text-[10px] font-bold text-emerald-600/80 dark:text-emerald-400/80 block mt-0.5">Served &amp; Paid</span>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-wider block">Net Revenue</span>
          <span className="text-2xl font-black text-blue-700 dark:text-blue-400">Rs. {Math.round(stats.totalNetSales).toLocaleString()}</span>
          <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 block mt-0.5">From completed</span>
        </div>

        <div className="bg-white dark:bg-pink-950/20 p-4 rounded-xl border border-pink-200 dark:border-pink-900/50 shadow-xs">
          <span className="text-[10px] font-black text-pink-600 dark:text-pink-400 uppercase tracking-wider block">Foodpanda</span>
          <span className="text-2xl font-black text-[#D70F64] dark:text-pink-400">{stats.fpCount} <span className="text-xs text-slate-400 dark:text-slate-500 font-bold">orders</span></span>
          <span className="text-[10px] font-bold text-pink-600 dark:text-pink-400/80 block mt-0.5">Rs. {Math.round(stats.fpNetSales).toLocaleString()} net</span>
        </div>
      </div>

      {/* Shift Unification Banner (if multiple shifts exist on date) */}
      {shifts.length > 1 && (
        <div className="bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 p-3.5 rounded-xl flex flex-wrap items-center justify-between text-xs text-blue-900 dark:text-blue-300 gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <span>
              <strong>{shifts.length} Cashier Shifts</strong> occurred on this date. All shift tickets are unified below.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-500 dark:text-slate-400">Filter Shift:</span>
            <select
              value={selectedShiftFilter}
              onChange={(e) => setSelectedShiftFilter(e.target.value)}
              className="bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 rounded-lg px-2.5 py-1 text-xs font-bold text-blue-800 dark:text-blue-300 outline-none cursor-pointer"
            >
              <option value="ALL" className="dark:bg-slate-900 dark:text-slate-100">All Combined Shifts ({shifts.length})</option>
              {shifts.map((s, idx) => (
                <option key={s.id} value={s.id} className="dark:bg-slate-900 dark:text-slate-100">
                  Shift #{idx + 1} ({new Date(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}) - {s.status}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-white dark:bg-slate-900 p-3.5 sm:p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 px-3.5 py-2 rounded-xl">
          <Search className="w-4 h-4 text-slate-400 shrink-0" />
          <input 
            type="text"
            id="orders-live-search"
            name="searchQuery"
            placeholder="Search Token #, Table, Item, or Payment..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full text-xs font-medium bg-transparent outline-none text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Pills Controls Container */}
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
          {/* Status Filter Tabs */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-950 p-1 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-800 shrink-0 overflow-x-auto">
            {[
              { id: 'ALL', label: `All (${orders.length})` },
              { id: 'PENDING', label: `In Kitchen (${stats.pendingCount})` },
              { id: 'OPEN_TAB', label: `Tabs (${stats.openTabCount})` },
              { id: 'COMPLETED', label: `Completed (${stats.completedCount})` },
              { id: 'CANCELLED', label: `Void (${stats.cancelledCount})` },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  statusFilter === tab.id 
                    ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs font-black' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Channel Filter Tabs */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-950 p-1 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-800 shrink-0 overflow-x-auto">
            {[
              { id: 'ALL', label: 'All Types' },
              { id: 'TAKEAWAY', label: 'Takeaway' },
              { id: 'DINE_IN', label: 'Dine-In' },
              { id: 'FOODPANDA', label: 'Foodpanda' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setTypeFilter(tab.id as any)}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                  typeFilter === tab.id 
                    ? 'bg-white dark:bg-slate-800 text-blue-700 dark:text-blue-400 shadow-xs font-black' 
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Container: Mobile Card View + Desktop Table View */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        
        {/* 1. MOBILE ORDERS CARD VIEW (block md:hidden) */}
        <div className="block md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {isLoading && orders.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500 font-bold text-xs">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
              Loading orders for {selectedDate}...
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500 font-bold text-xs">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-20" />
              No orders found matching the filter for {selectedDate}.
            </div>
          ) : (
            filteredOrders.map((order) => {
              const itemsList = order.order_items || [];
              const orderDate = new Date(order.created_at);
              const elapsedMinutes = Math.floor((Date.now() - orderDate.getTime()) / 60000);

              const statusBadge = 
                order.status === 'COMPLETED' ? { bg: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', text: '✅ COMPLETED' } :
                order.status === 'PENDING' ? { bg: 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800', text: '⏳ IN KITCHEN' } :
                order.status === 'OPEN_TAB' ? { bg: 'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800', text: '🍽️ ACTIVE TABLE' } :
                { bg: 'bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800', text: '❌ CANCELLED' };

              const typeBadge = 
                order.order_type === 'FOODPANDA' ? 'bg-pink-100 dark:bg-pink-950/50 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800' :
                order.order_type === 'DINE_IN' ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' :
                'bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';

              return (
                <div key={order.id} className="p-4 flex flex-col gap-3 hover:bg-slate-50/60 dark:hover:bg-slate-850/40 transition-colors">
                  {/* Top Row: Token # + Elapsed Time + Status Badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-base sm:text-lg text-slate-900 dark:text-slate-100">
                        #{order.token_number?.toString().padStart(3, '0')}
                      </span>
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {orderDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        ({elapsedMinutes > 0 ? `${elapsedMinutes}m ago` : 'Just now'})
                      </span>
                    </div>

                    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${statusBadge.bg}`}>
                      {statusBadge.text}
                    </span>
                  </div>

                  {/* Channel & Table Badges */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-black border ${typeBadge}`}>
                      {order.order_type.replace('_', ' ')}
                    </span>
                    {order.table_number && (
                      <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
                        Table #{order.table_number}
                      </span>
                    )}
                    <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md border border-slate-200 dark:border-slate-700">
                      {order.payment_method?.replace('_', ' ') || 'PENDING'}
                    </span>
                  </div>

                  {/* Items List */}
                  <div className="bg-slate-50 dark:bg-slate-850/60 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1 text-xs">
                    {itemsList.map((it: any, idx: number) => (
                      <div key={idx} className="text-slate-800 dark:text-slate-200 leading-tight">
                        <span className="font-black text-slate-900 dark:text-slate-100 mr-1.5">{it.quantity}x</span>
                        <span className="font-bold">{it.item_name}</span>
                        {it.modifiers_json && it.modifiers_json.length > 0 && (
                          <div className="pl-4 mt-0.5 flex flex-wrap gap-1">
                            {it.modifiers_json.map((m: any, mIdx: number) => (
                              <span key={mIdx} className="text-[10px] font-black text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1.5 py-0.2 rounded">
                                +{m.qty || 1} {m.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Bottom Row: Net Total + Touch-friendly Action Buttons */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div>
                      <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase block">Net Amount</span>
                      <span className="font-black text-base sm:text-lg text-slate-900 dark:text-slate-100">
                        Rs. {Number(order.net_total || 0).toLocaleString()}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Slip Preview Button */}
                      <button
                        onClick={() => setSelectedOrderForSlip(order)}
                        className="min-h-[40px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors flex items-center gap-1 text-xs font-bold cursor-pointer"
                        title="View / Print Receipt Slip"
                      >
                        <Printer className="w-3.5 h-3.5" />
                        <span>Slip</span>
                      </button>

                      {/* Re-send to KDS if needed */}
                      {isLaptop && order.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleResendToKitchen(order)}
                          disabled={isActionProcessing}
                          className="min-h-[40px] px-3 rounded-xl bg-amber-500/10 dark:bg-amber-950/40 hover:bg-amber-500 text-amber-700 dark:text-amber-300 hover:text-white border border-amber-300 dark:border-amber-800 text-xs font-black transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                          title="Re-send order ticket to Kitchen Display"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>KDS</span>
                        </button>
                      )}

                      {/* Mark Complete */}
                      {isLaptop && order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleMarkCompleted(order)}
                          disabled={isActionProcessing}
                          className="min-h-[40px] px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer shadow-sm"
                          title="Mark as completed"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Done</span>
                        </button>
                      )}

                      {/* Void / Cancel & Restock (Counter Only - Q17: A) */}
                      {isLaptop && order.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleCancelOrder(order)}
                          disabled={isActionProcessing}
                          className="min-h-[40px] px-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white border border-red-200 dark:border-red-900 text-xs font-black transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                          title="Void / Cancel order and automatically restock ingredients"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Void</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 2. DESKTOP ORDERS TABLE VIEW (hidden md:block) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-850 text-slate-500 dark:text-slate-400 uppercase font-black tracking-wider border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-3.5 px-4">Token #</th>
                <th className="py-3.5 px-4">Time Placed</th>
                <th className="py-3.5 px-4">Type &amp; Table</th>
                <th className="py-3.5 px-4 max-w-sm">Items &amp; Modifiers</th>
                <th className="py-3.5 px-4 text-right">Net Total</th>
                <th className="py-3.5 px-4">Payment</th>
                <th className="py-3.5 px-4 text-center">Kitchen Status</th>
                <th className="py-3.5 px-4 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading && orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 dark:text-slate-500 font-bold">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Loading orders for {selectedDate}...
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 dark:text-slate-500 font-bold">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-20" />
                    No orders found matching the filter for {selectedDate}.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const itemsList = order.order_items || [];
                  const orderDate = new Date(order.created_at);
                  const elapsedMinutes = Math.floor((Date.now() - orderDate.getTime()) / 60000);

                  const statusBadge = 
                    order.status === 'COMPLETED' ? { bg: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', text: '✅ COMPLETED' } :
                    order.status === 'PENDING' ? { bg: 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800', text: '⏳ IN KITCHEN' } :
                    order.status === 'OPEN_TAB' ? { bg: 'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800', text: '🍽️ ACTIVE TABLE' } :
                    { bg: 'bg-red-100 dark:bg-red-950/50 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800', text: '❌ CANCELLED' };

                  const typeBadge = 
                    order.order_type === 'FOODPANDA' ? 'bg-pink-100 dark:bg-pink-950/50 text-pink-700 dark:text-pink-300 border-pink-200 dark:border-pink-800' :
                    order.order_type === 'DINE_IN' ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' :
                    'bg-orange-100 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800';

                  return (
                    <tr key={order.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-850/50 transition-colors">
                      {/* Token */}
                      <td className="py-3 px-4 font-black text-slate-900 dark:text-slate-100 text-sm">
                        #{order.token_number?.toString().padStart(3, '0')}
                      </td>

                      {/* Time */}
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-400 font-medium">
                        <span className="font-bold text-slate-800 dark:text-slate-200 block">
                          {orderDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {elapsedMinutes > 0 ? `${elapsedMinutes}m ago` : 'Just now'}
                        </span>
                      </td>

                      {/* Type & Table */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col items-start gap-1">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${typeBadge}`}>
                            {order.order_type.replace('_', ' ')}
                          </span>
                          {order.table_number && (
                            <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                              Table #{order.table_number}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Items & Modifiers */}
                      <td className="py-3 px-4 max-w-sm">
                        <div className="space-y-1">
                          {itemsList.map((it: any, idx: number) => (
                            <div key={idx} className="text-slate-800 dark:text-slate-200 leading-tight">
                              <span className="font-black text-slate-900 dark:text-slate-100 mr-1">{it.quantity}x</span>
                              <span className="font-bold">{it.item_name}</span>
                              {it.modifiers_json && it.modifiers_json.length > 0 && (
                                <span className="ml-1 inline-flex flex-wrap gap-1">
                                  {it.modifiers_json.map((m: any, mIdx: number) => (
                                    <span key={mIdx} className="text-[10px] font-black text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 px-1 rounded">
                                      +{m.qty || 1} {m.name}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </td>

                      {/* Net Total */}
                      <td className="py-3 px-4 text-right font-black text-slate-900 dark:text-slate-100 text-sm">
                        Rs. {Number(order.net_total || 0).toLocaleString()}
                      </td>

                      {/* Payment */}
                      <td className="py-3 px-4 font-bold text-[11px] text-slate-600 dark:text-slate-400">
                        {order.payment_method?.replace('_', ' ') || 'PENDING'}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 text-center">
                        <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${statusBadge.bg}`}>
                          {statusBadge.text}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {/* Slip Preview */}
                          <button
                            onClick={() => setSelectedOrderForSlip(order)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                            title="View / Print Receipt Slip"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          {/* Re-send to KDS if needed */}
                          {isLaptop && order.status !== 'CANCELLED' && (
                            <button
                              onClick={() => handleResendToKitchen(order)}
                              disabled={isActionProcessing}
                              className="px-2.5 py-1 rounded-lg bg-amber-500/10 dark:bg-amber-950/40 hover:bg-amber-500 text-amber-700 dark:text-amber-300 hover:text-white border border-amber-300 dark:border-amber-800 text-[10px] font-black transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                              title="Re-send order ticket to Kitchen Display"
                            >
                              <Send className="w-3 h-3" /> Re-send KDS
                            </button>
                          )}

                          {/* Mark Complete */}
                          {isLaptop && order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                            <button
                              onClick={() => handleMarkCompleted(order)}
                              disabled={isActionProcessing}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-black transition-all flex items-center gap-1 active:scale-95 cursor-pointer shadow-xs"
                              title="Mark as completed"
                            >
                              <Check className="w-3 h-3" /> Complete
                            </button>
                          )}

                          {/* Void / Cancel & Restock (Counter Only - Q17: A) */}
                          {isLaptop && order.status !== 'CANCELLED' && (
                            <button
                              onClick={() => handleCancelOrder(order)}
                              disabled={isActionProcessing}
                              className="px-2 py-1 rounded-lg bg-red-50 dark:bg-red-950/40 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white border border-red-200 dark:border-red-900 text-[10px] font-black transition-all flex items-center gap-1 active:scale-95 cursor-pointer"
                              title="Void / Cancel order and automatically restock ingredients"
                            >
                              <X className="w-3 h-3" /> Void
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        <div className="p-4 bg-slate-50 dark:bg-slate-850 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-500 dark:text-slate-400 gap-2">
          <span>Showing <strong>{filteredOrders.length}</strong> of <strong>{orders.length}</strong> orders for {selectedDate}.</span>
          <span className="font-semibold">Multiple cashier shifts on this date are merged automatically.</span>
        </div>
      </div>

      {/* Slip / KOT Modal Preview */}
      {selectedOrderForSlip && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-6 font-mono text-slate-800 dark:text-slate-100 flex flex-col max-h-[85vh]">
            <div className="flex items-center justify-between pb-3 border-b border-dashed border-slate-300 dark:border-slate-700 mb-4">
              <span className="font-black text-base uppercase">MUCHACHOS</span>
              <button 
                onClick={() => setSelectedOrderForSlip(null)} 
                className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded cursor-pointer text-slate-400 dark:text-slate-300"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center pb-3 border-b border-dashed border-slate-300 dark:border-slate-700 mb-3">
              <h3 className="text-3xl font-black">
                #{selectedOrderForSlip.token_number.toString().padStart(3, '0')}
              </h3>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mt-1">
                {selectedOrderForSlip.order_type.replace('_', ' ')}
                {selectedOrderForSlip.table_number ? ` - TABLE ${selectedOrderForSlip.table_number}` : ''}
              </p>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                {new Date(selectedOrderForSlip.created_at).toLocaleString()}
              </p>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto space-y-2 py-2 border-b border-dashed border-slate-300 dark:border-slate-700 text-xs">
              {selectedOrderForSlip.order_items.map((item, idx) => (
                <div key={idx} className="flex flex-col">
                  <div className="flex justify-between font-bold">
                    <span>{item.quantity}x {item.item_name}</span>
                    <span>Rs. {Number(item.total_price || item.unit_price * item.quantity || 0).toFixed(0)}</span>
                  </div>
                  {item.modifiers_json && item.modifiers_json.length > 0 && (
                    <ul className="pl-3 text-[11px] text-slate-500 dark:text-slate-400">
                      {item.modifiers_json.map((mod: any, mIdx: number) => (
                        <li key={mIdx}>+ {mod.qty || 1}x {mod.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-3 space-y-1 text-xs">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>Rs. {Number(selectedOrderForSlip.subtotal || 0).toFixed(0)}</span>
              </div>
              {Number(selectedOrderForSlip.discount || 0) > 0 && (
                <div className="flex justify-between text-red-500 dark:text-red-400">
                  <span>Discount:</span>
                  <span>-Rs. {Number(selectedOrderForSlip.discount).toFixed(0)}</span>
                </div>
              )}
              <div className="flex justify-between font-black text-sm pt-1 border-t border-slate-200 dark:border-slate-700">
                <span>NET TOTAL:</span>
                <span>Rs. {Number(selectedOrderForSlip.net_total || 0).toFixed(0)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                <span>Payment:</span>
                <span>{selectedOrderForSlip.payment_method?.replace('_', ' ') || 'PENDING'}</span>
              </div>
            </div>

            <div className="mt-4 pt-3 flex gap-2">
              <button
                onClick={() => window.print()}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow cursor-pointer"
              >
                <Printer className="w-4 h-4" /> Print Ticket
              </button>
              <button
                onClick={() => setSelectedOrderForSlip(null)}
                className="py-2.5 px-4 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
