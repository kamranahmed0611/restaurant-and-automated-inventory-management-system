"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { 
  X, Search, RefreshCw, Send, CheckCircle2, Clock, 
  Utensils, Printer, AlertTriangle, Eye, FileText, Bike,
  ShoppingBag, Check, RotateCcw, AlertCircle, Plus, Trash2,
  Tv, ExternalLink
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { db, LocalOrder } from "@/lib/db";
import { syncOfflineOrders } from "@/lib/sync-engine";
import { cancelAndRestockOrder } from "@/lib/inventory-service";
import { posBus } from "@/lib/broadcast-bus";
import { getKdsDisplayEnabled, setKdsDisplayEnabled } from "@/lib/kds-config";
import { usePosStore } from "@/lib/store";
import { modal } from "@/lib/modalStore";
import ThermalReceiptPreviewModal from "./ThermalReceiptPreviewModal";
import { consolidateKdsItems } from "./KdsView";
import { MuchachosSymbol } from "./MuchachosBrand";

interface CashierOrderAuditModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AuditOrder {
  id: string;
  token_number: number;
  order_type: 'TAKEAWAY' | 'DINE_IN' | 'FOODPANDA';
  payment_method: string;
  table_number?: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'OPEN_TAB';
  subtotal: number;
  discount: number;
  net_total: number;
  created_at: string;
  shift_id?: string;
  items: any[];
  sync_status?: string;
  fp_payout_status?: string;
}

export default function CashierOrderAuditModal({ isOpen, onClose }: CashierOrderAuditModalProps) {
  const [orders, setOrders] = useState<AuditOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'OPEN_TAB' | 'COMPLETED' | 'CANCELLED'>('ALL');
  const [selectedOrderForSlip, setSelectedOrderForSlip] = useState<AuditOrder | null>(null);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);
  const [isActionProcessing, setIsActionProcessing] = useState(false);
  const [kdsEnabled, setKdsEnabled] = useState(false);

  useEffect(() => {
    setKdsEnabled(getKdsDisplayEnabled());
    const unsub = posBus.subscribe((msg: any) => {
      if (msg.type === 'KDS_TOGGLED') {
        setKdsEnabled(Boolean(msg.kdsEnabled));
      }
    });
    return () => unsub();
  }, []);

  const handleToggleKds = () => {
    const next = !kdsEnabled;
    setKdsDisplayEnabled(next);
    setKdsEnabled(next);
    modal.toast.success(next ? "Kitchen Display Screen (KDS) Display Enabled" : "Kitchen Display Screen (KDS) Display Disabled");
  };

  const handleOpenKdsWindow = () => {
    window.open('/kds', 'MuchachosKDS', 'width=1280,height=800,menubar=no,toolbar=no,location=no,status=no');
  };

  const fetchTodaysOrders = useCallback(async () => {
    try {
      const today = new Date().toISOString().split('T')[0];

      // 1. FAST LOCAL READ: Read from Dexie in 0ms so UI displays instantly!
      const localOrders = await db.orders
        .where('created_at')
        .startsWith(today)
        .toArray();

      const orderMap = new Map<string, AuditOrder>();

      localOrders.forEach(o => {
        orderMap.set(o.id, {
          ...o,
          items: consolidateKdsItems(o.items || [], Number(o.subtotal || o.net_total || 0)),
          sync_status: o.sync_status || 'PENDING'
        });
      });

      const merged = Array.from(orderMap.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setOrders(merged);
    } catch (err) {
      console.warn("Failed to fetch today's orders for audit:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    fetchTodaysOrders();

    const unsubBus = posBus.subscribe(() => {
      fetchTodaysOrders();
    });

    const channel = supabase
      .channel('cashier_order_audit')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        fetchTodaysOrders();
      })
      .subscribe();

    return () => {
      unsubBus();
      supabase.removeChannel(channel);
    };
  }, [isOpen, fetchTodaysOrders]);

  const showNotification = (msg: string) => {
    setActionSuccessMsg(msg);
    setTimeout(() => setActionSuccessMsg(null), 4000);
  };

  // Re-send to kitchen display with instant optimistic UI update
  const handleResendToKitchen = async (order: AuditOrder) => {
    const newStatus = order.order_type === 'DINE_IN' ? 'OPEN_TAB' : 'PENDING';
    
    // 1. Instant optimistic UI update in 0ms
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));
    showNotification(`Token #${order.token_number.toString().padStart(3, '0')} Re-dispatched to Kitchen!`);

    // 2. Background persistence
    try {
      await db.orders.update(order.id, { 
        status: newStatus,
        sync_status: 'PENDING'
      });

      try {
        const today = new Date().toISOString().split('T')[0];
        const clearedKey = `kds_cleared_dine_in_${today}`;
        const raw = localStorage.getItem(clearedKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            localStorage.setItem(clearedKey, JSON.stringify(parsed.filter((id: string) => id !== order.id)));
          } else if (typeof parsed === 'object') {
            delete parsed[order.id];
            localStorage.setItem(clearedKey, JSON.stringify(parsed));
          }
        }
      } catch {}

      syncOfflineOrders();
      posBus.publish('KOT_SENT', {
        orderId: order.id,
        tokenNumber: order.token_number,
        orderType: order.order_type,
        tableNumber: order.table_number
      });
    } catch (err) {
      console.warn("Failed to resend order in background:", err);
    }
  };

  // Mark order completed manually with instant optimistic UI update
  const handleMarkCompleted = async (order: AuditOrder) => {
    setIsActionProcessing(true);
    try {
      if (order.order_type === 'DINE_IN') {
        // For Dine-in, NEVER mark it COMPLETED until paid! Just hide it from the KDS view.
        posBus.publish('KDS_DINE_IN_CLEARED', { orderId: order.id, itemCount: order.items?.length || 999, fullOrder: order });
        modal.toast.success(`Table ${order.table_number || ''} (Token #${order.token_number}) cleared from Kitchen Display!`);
      } else {
        // 1. Instant optimistic UI update
        setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'COMPLETED' } : o));
        modal.toast.success(`Token #${order.token_number.toString().padStart(3, '0')} Marked as Completed!`);

        // 2. Background persistence
        await db.orders.update(order.id, { status: 'COMPLETED', sync_status: 'PENDING' });
        syncOfflineOrders();
        posBus.publish('ORDER_COMPLETED', {
          orderId: order.id,
          tokenNumber: order.token_number,
          orderType: order.order_type,
          fullOrder: order
        });
      }
    } catch (err) {
      console.warn("Failed to mark order completed:", err);
    } finally {
      setIsActionProcessing(false);
    }
  };

  // Void/Cancel order with immediate ingredient restocking
  const handleCancelOrder = async (order: AuditOrder) => {
    const isFpOrder = order.order_type === 'FOODPANDA' || (order as any).payment_method === 'FOODPANDA_RECEIVABLE';
    if (isFpOrder && (order.fp_payout_status === 'RECEIVED' || order.fp_payout_status === 'SETTLED')) {
      modal.warning(
        "Cannot Void Order",
        `Order #${order.token_number} cannot be voided because its Foodpanda payout has already been cleared and deposited.`
      );
      return;
    }

    const ok = await modal.confirm({
      title: `Void Order #${order.token_number}?`,
      message: `Are you sure you want to VOID/CANCEL Order #${order.token_number}?\nIngredients deducted for this order will be automatically RESTOCKED back into inventory.`,
      confirmText: "Void & Restock",
      isDanger: true
    });
    if (!ok) return;

    setIsActionProcessing(true);
    try {
      const res = await cancelAndRestockOrder(order.id, "Cashier cancelled via Order Audit");
      if (res.success) {
        syncOfflineOrders();
        posBus.publish('ORDER_CANCELLED', {
          orderId: order.id,
          tokenNumber: order.token_number,
          orderType: order.order_type
        });
        modal.success("Order Voided", `Order #${order.token_number} voided.\nIngredients have been automatically restocked.`);
        await fetchTodaysOrders();
      } else {
        modal.error("Void Failed", res.message);
      }
    } catch (err: any) {
      console.error(err);
      modal.error("Void Error", "Error voiding order: " + err.message);
    } finally {
      setIsActionProcessing(false);
    }
  };

  const { startAmendingBill } = usePosStore();

  const handleStartAmend = (order: AuditOrder) => {
    startAmendingBill({
      originalOrderId: order.id,
      originalTokenNumber: order.token_number,
      originalNetTotal: Number(order.net_total || 0),
      originalPaymentMethod: order.payment_method || 'CASH',
      originalOrderType: order.order_type,
      originalItems: (order.items || []).map((i: any) => ({
        ...i,
        total_price: Number(i.total_price || (i.unit_price * i.quantity) || 0)
      }))
    });
    onClose();
  };

  // Filtered orders
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
      // Status filter
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;

      // Search query
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase().trim();
        const matchesToken = o.token_number.toString().includes(q) || `#${o.token_number}`.includes(q);
        const matchesTable = o.table_number?.toLowerCase().includes(q);
        const matchesType = o.order_type.toLowerCase().includes(q);
        const matchesItem = o.items.some(i => (i.item_name || '').toLowerCase().includes(q));
        return matchesToken || matchesTable || matchesType || matchesItem;
      }

      return true;
    });
  }, [orders, statusFilter, searchQuery]);

  // Statistics Summary
  const stats = useMemo(() => {
    let pendingCount = 0;
    let openTabCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;
    let totalSales = 0;

    orders.forEach(o => {
      if (o.status === 'PENDING') pendingCount++;
      else if (o.status === 'OPEN_TAB') openTabCount++;
      else if (o.status === 'COMPLETED') {
        completedCount++;
        totalSales += o.net_total || 0;
      } else if (o.status === 'CANCELLED') cancelledCount++;
    });

    return {
      total: orders.length,
      pendingCount,
      openTabCount,
      completedCount,
      cancelledCount,
      totalSales
    };
  }, [orders]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-1.5 sm:p-3 animate-in fade-in duration-150">
      <div className="bg-card w-[98vw] max-w-[1550px] h-[95vh] rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden text-foreground">
        
        {/* Header */}
        <div className="p-5 border-b border-border bg-background/80 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E11D2A] text-white flex items-center justify-center p-2 shadow-sm shrink-0 border border-red-500/40">
              <MuchachosSymbol size={28} color="#FFFFFF" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black tracking-tight flex items-center gap-1.5">
                  MUCHACHOS <span className="text-mutedForeground font-bold text-base">&bull; Order Audit</span>
                </h2>
                <span className="text-xs font-bold bg-muted px-2.5 py-0.5 rounded-full border border-border">
                  Combined Shifts &bull; {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                </span>
              </div>
              <p className="text-xs text-mutedForeground mt-0.5 flex items-center gap-1.5">
                <span className="font-serif italic text-red-500 dark:text-red-400 font-bold">An Oasis Of Taste</span> &bull; 
                Active tickets, modifiers inspection, and KDS re-dispatch
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* KDS Extended Screen Controls for Cashier */}
            <div className="flex items-center gap-1.5 bg-muted/60 border border-border px-2.5 py-1 rounded-xl">
              <div className="flex items-center gap-1.5 text-xs font-bold">
                <Tv className="w-3.5 h-3.5 text-mutedForeground" />
                <span className="hidden sm:inline text-mutedForeground text-[11px]">KDS Screen:</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                  kdsEnabled 
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30' 
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}>
                  {kdsEnabled ? 'ACTIVE' : 'OFF'}
                </span>
              </div>

              <button
                onClick={handleToggleKds}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  kdsEnabled 
                    ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-2xs' 
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-2xs'
                }`}
                title="Toggle Kitchen Display Screen ON/OFF (Does not affect kitchen token printing)"
              >
                {kdsEnabled ? 'Turn OFF' : 'Turn ON'}
              </button>

              <button
                onClick={handleOpenKdsWindow}
                className="px-2.5 py-1 rounded-lg text-xs font-black bg-card hover:bg-muted text-foreground border border-border transition-colors flex items-center gap-1 cursor-pointer"
                title="Open KDS in a separate popup window (Drag to secondary kitchen monitor or customer TV)"
              >
                <ExternalLink className="w-3 h-3 text-[#E11D2A]" />
                <span className="hidden md:inline">Open Window</span>
              </button>
            </div>

            <button
              onClick={() => fetchTodaysOrders()}
              disabled={isLoading}
              className="px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-foreground text-xs font-bold flex items-center gap-1.5 transition-colors border border-border cursor-pointer"
              title="Refresh Orders"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-mutedForeground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Action Success Alert Notification */}
        {actionSuccessMsg && (
          <div className="bg-emerald-500/10 border-b border-emerald-500/30 px-5 py-2.5 flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-bold animate-in slide-in-from-top-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
        )}

        {/* Top Summary Metric Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 p-4 bg-muted/40 border-b border-border text-xs">
          <div className="p-3 bg-card rounded-xl border border-border shadow-sm">
            <span className="text-mutedForeground font-bold uppercase tracking-wider block text-[10px]">Today&apos;s Orders</span>
            <span className="text-xl font-black text-foreground">{stats.total}</span>
          </div>
          <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 shadow-sm">
            <span className="text-amber-600 dark:text-amber-400 font-bold uppercase tracking-wider block text-[10px]">In Kitchen (Pending)</span>
            <span className="text-xl font-black text-amber-600 dark:text-amber-400">{stats.pendingCount}</span>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-xl border border-blue-500/20 shadow-sm">
            <span className="text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wider block text-[10px]">Active Tables (Open)</span>
            <span className="text-xl font-black text-blue-600 dark:text-blue-400">{stats.openTabCount}</span>
          </div>
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shadow-sm">
            <span className="text-emerald-600 dark:text-emerald-400 font-bold uppercase tracking-wider block text-[10px]">Completed</span>
            <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">{stats.completedCount}</span>
          </div>
          <div className="p-3 bg-card rounded-xl border border-border shadow-sm col-span-2 sm:col-span-1">
            <span className="text-mutedForeground font-bold uppercase tracking-wider block text-[10px]">Completed Sales</span>
            <span className="text-xl font-black text-primary">Rs. {stats.totalSales.toLocaleString()}</span>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="p-4 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-background">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-mutedForeground absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              id="audit-search-query"
              name="searchQuery"
              placeholder="Search by Token # (e.g. 005), Table #, or Item name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-muted/50 border border-border rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: 'ALL', label: `All (${orders.length})` },
              { id: 'PENDING', label: `In Kitchen (${stats.pendingCount})` },
              { id: 'OPEN_TAB', label: `Active Tables (${stats.openTabCount})` },
              { id: 'COMPLETED', label: `Completed (${stats.completedCount})` },
              { id: 'CANCELLED', label: `Void (${stats.cancelledCount})` },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id as any)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap border ${
                  statusFilter === tab.id
                    ? 'bg-primary text-primaryForeground border-primary shadow-sm'
                    : 'bg-card text-mutedForeground border-border hover:border-primary/50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Orders List Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
          {isLoading && orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-mutedForeground">
              <RefreshCw className="w-8 h-8 animate-spin mb-2" />
              <p className="text-sm font-bold">Loading today&apos;s orders...</p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-mutedForeground">
              <FileText className="w-12 h-12 mb-2 opacity-20" />
              <p className="text-base font-bold">No orders found matching the filter.</p>
              <p className="text-xs text-mutedForeground mt-1">Try resetting the search or filter tab.</p>
            </div>
          ) : (
            filteredOrders.map((order) => {
              const orderTime = new Date(order.created_at);
              const elapsedMinutes = Math.floor((Date.now() - orderTime.getTime()) / 60000);

              // Status styles
              const statusBadge = 
                order.status === 'PENDING' ? { bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30', text: 'IN KITCHEN' } :
                order.status === 'OPEN_TAB' ? { bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30', text: 'ACTIVE TABLE' } :
                order.status === 'COMPLETED' ? { bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', text: 'COMPLETED' } :
                { bg: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30', text: 'CANCELLED' };

              const typeBadge =
                order.order_type === 'DINE_IN' ? { bg: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', text: 'DINE IN' } :
                order.order_type === 'FOODPANDA' ? { bg: 'bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300', text: 'FOODPANDA' } :
                { bg: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300', text: 'TAKEAWAY' };

              const isFpOrder = order.order_type === 'FOODPANDA' || (order as any).payment_method === 'FOODPANDA_RECEIVABLE';
              const isFpCleared = isFpOrder && (order.fp_payout_status === 'RECEIVED' || order.fp_payout_status === 'SETTLED');

              return (
                <div 
                  key={order.id} 
                  className="bg-card border border-border rounded-xl p-4 shadow-sm hover:border-primary/40 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                >
                  {/* Left Section: Order Identity */}
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center justify-center p-3 rounded-xl bg-muted border border-border w-20 shrink-0">
                      <span className="text-2xl font-black text-foreground">
                        #{order.token_number.toString().padStart(3, '0')}
                      </span>
                      <span className="text-[10px] font-bold text-mutedForeground uppercase tracking-wider">
                        Token
                      </span>
                    </div>

                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${typeBadge.bg}`}>
                          {typeBadge.text}
                        </span>
                        {order.table_number && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                            TABLE {order.table_number}
                          </span>
                        )}
                        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${statusBadge.bg}`}>
                          {statusBadge.text}
                        </span>
                        <span className="text-xs text-mutedForeground font-medium">
                          {orderTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &bull; {elapsedMinutes}m ago
                        </span>
                      </div>

                      {/* Items & Add-ons Breakdown */}
                      <div className="pt-1">
                        <div className="space-y-1">
                          {order.items.map((item, idx) => (
                            <div key={idx} className="text-xs text-foreground/90 font-medium">
                              <span className="font-black text-foreground mr-1.5">{item.quantity}x</span>
                              <span className="font-bold">{item.item_name}</span>
                              {item.modifiers_json && item.modifiers_json.length > 0 && (
                                <span className="ml-2 inline-flex flex-wrap gap-1">
                                  {item.modifiers_json.map((mod: any, mIdx: number) => (
                                    <span key={mIdx} className="text-[10px] font-black text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 rounded">
                                      +{mod.qty || 1} {mod.name}
                                    </span>
                                  ))}
                                </span>
                              )}
                              {item.deal_swaps_json && item.deal_swaps_json.length > 0 && (
                                <div className="ml-4 mt-1 space-y-0.5 border-l-2 border-amber-400/60 dark:border-amber-500/40 pl-2">
                                  {item.deal_swaps_json.map((comp: any, cIdx: number) => (
                                    <div key={cIdx} className="text-[11px] text-mutedForeground">
                                      <span className="font-bold text-foreground/90">&bull; {comp.quantity || 1}x {comp.item_name}</span>
                                      {comp.modifiers && comp.modifiers.length > 0 && (
                                        <span className="text-amber-600 dark:text-amber-400 font-bold ml-1">
                                          (+{comp.modifiers.map((m: any) => `${m.qty > 1 ? m.qty + 'x ' : ''}${m.name}`).join(', ')})
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Section: Price & Cashier Mismanagement Action Buttons */}
                  <div className="flex items-center justify-between md:justify-end gap-3 pt-3 md:pt-0 border-t md:border-t-0 border-border">
                    <div className="text-right pr-2">
                      <span className="text-base font-black text-foreground block">
                        Rs. {Number(order.net_total || 0).toLocaleString()}
                      </span>
                      <span className="text-[10px] font-bold text-mutedForeground uppercase tracking-wider block">
                        {order.payment_method ? order.payment_method.replace('_', ' ') : 'PENDING'}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* View / Print Slip */}
                      <button
                        onClick={() => setSelectedOrderForSlip(order)}
                        className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-foreground transition-colors border border-border"
                        title="View & Print Slip"
                      >
                        <Printer className="w-4 h-4 text-mutedForeground" />
                      </button>

                      {/* Re-send to Kitchen / KDS */}
                      {order.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleResendToKitchen(order)}
                          disabled={isActionProcessing}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500 text-amber-600 hover:text-slate-950 dark:text-amber-400 border border-amber-500/30 text-xs font-black transition-all flex items-center gap-1 active:scale-95 shadow-sm"
                          title="If ticket was lost or missed in kitchen, click to send back to KDS immediately"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>Re-send to KDS</span>
                        </button>
                      )}

                      {/* Mark Completed */}
                      {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleMarkCompleted(order)}
                          disabled={isActionProcessing}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition-all flex items-center gap-1.5 active:scale-95 shadow-sm cursor-pointer"
                          title="Click to clear token and mark order as handed over / ready"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>CLEAR / READY</span>
                        </button>
                      )}

                      {/* Add Items to Bill */}
                      {order.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleStartAmend(order)}
                          className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-black transition-all flex items-center gap-1 active:scale-95 shadow-sm cursor-pointer"
                          title="Add more items or drinks to this customer's bill"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add to Bill</span>
                        </button>
                      )}

                      {/* Void / Cancel */}
                      {order.status !== 'CANCELLED' && (
                        <button
                          onClick={() => handleCancelOrder(order)}
                          disabled={isActionProcessing || isFpCleared}
                          className={`p-2 rounded-lg transition-colors ${
                            isFpCleared 
                              ? "opacity-30 cursor-not-allowed text-mutedForeground" 
                              : "hover:bg-red-500/10 text-mutedForeground hover:text-red-500 cursor-pointer"
                          }`}
                          title={isFpCleared ? "Cannot void: Foodpanda payout already cleared/deposited" : "Void / Cancel Order"}
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Status Bar */}
        <div className="p-4 border-t border-border bg-background flex flex-wrap items-center justify-between text-xs text-mutedForeground gap-2">
          <span>Showing <strong>{filteredOrders.length}</strong> of <strong>{orders.length}</strong> total orders today.</span>
          <span className="font-medium">All shifts of the current date are unified automatically.</span>
        </div>
      </div>

      {/* Authentic Cropped Thermal Slip & KOT Preview Modal */}
      {selectedOrderForSlip && (
        <ThermalReceiptPreviewModal
          isOpen={true}
          onClose={() => setSelectedOrderForSlip(null)}
          order={selectedOrderForSlip}
          items={selectedOrderForSlip.items}
          initialTab="RECEIPT"
          onPrintCompleted={() => setSelectedOrderForSlip(null)}
        />
      )}
    </div>
  );
}
