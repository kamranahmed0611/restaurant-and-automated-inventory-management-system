"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { Order, OrderItem } from "@/types/database";
import { Check, Clock, Flame, RotateCcw, X, History, AlertCircle, UtensilsCrossed, ShoppingBag, Bike, Utensils, Trash2, Tv, MonitorOff } from "lucide-react";
import { db } from "@/lib/db";
import { posBus } from "@/lib/broadcast-bus";
import MuchachosBrand, { MuchachosSymbol } from "./MuchachosBrand";
import TeddopsBranding from "./TeddopsBranding";
import { getKdsDisplayEnabled, setKdsDisplayEnabled } from "@/lib/kds-config";
import { openAppRoute } from "@/lib/window-navigation";

type KdsOrder = Order & { items: OrderItem[] };
type CompletedKdsOrder = KdsOrder & { completedAt: string };

export const isAddonItem = (item: any): boolean => {
  if (!item) return false;
  if (item.is_addon) return true;
  let swaps = item.deal_swaps_json;
  if (typeof swaps === 'string') {
    try { swaps = JSON.parse(swaps); } catch { swaps = []; }
  }
  if (Array.isArray(swaps)) {
    return swaps.some((s: any) => s && s.is_addon);
  }
  return false;
};

export function consolidateKdsItems(items: OrderItem[], orderSubtotal?: number): OrderItem[] {
  if (!items || items.length <= 1) return items || [];

  const groupedMap = new Map<string, OrderItem>();
  const seenIds = new Set<string>();

  for (const item of items) {
    if (item.id && seenIds.has(item.id)) continue;
    if (item.id) seenIds.add(item.id);

    const isItemAddon = isAddonItem(item);
    
    // Create a stable, sorted key for modifiers
    let modsKey = "";
    if (item.modifiers_json && item.modifiers_json.length > 0) {
      const sortedMods = [...item.modifiers_json].sort((a: any, b: any) => (a.modifier_id || a.id || '').localeCompare(b.modifier_id || b.id || ''));
      modsKey = sortedMods.map((m: any) => `${m.modifier_id || m.id}_${m.qty}`).join('|');
    }
    
    // Create a stable key for deal swaps
    let swapsKey = "";
    if (item.deal_swaps_json && item.deal_swaps_json.length > 0) {
      swapsKey = item.deal_swaps_json.map((s: any) => `${s.original_item}_${s.swapped_with}`).join('|');
    }

    const uniqueKey = `${item.item_name}::${isItemAddon}::${modsKey}::${swapsKey}`;

    if (groupedMap.has(uniqueKey)) {
      const existing = groupedMap.get(uniqueKey)!;
      const unitPrice = Number(item.unit_price || existing.unit_price || 0);

      // Prevent ghost duplicate rows where total line cost exceeds order subtotal
      if (unitPrice > 0 && orderSubtotal && orderSubtotal > 0 && (Number(existing.quantity || 1) * unitPrice) >= orderSubtotal) {
        continue;
      }

      groupedMap.set(uniqueKey, {
        ...existing,
        quantity: Number(existing.quantity || 1) + Number(item.quantity || 1),
        total_price: Number(existing.total_price || 0) + Number(item.total_price || 0)
      });
    } else {
      groupedMap.set(uniqueKey, { ...item });
    }
  }

  return Array.from(groupedMap.values());
}

export default function KdsView() {
  const [orders, setOrders] = useState<KdsOrder[]>([]);
  const [recentCompleted, setRecentCompleted] = useState<CompletedKdsOrder[]>([]);
  const recentCompletedRef = useRef<CompletedKdsOrder[]>([]);
  recentCompletedRef.current = recentCompleted;
  const [isLoading, setIsLoading] = useState(true);
  const [confirmingOrderId, setConfirmingOrderId] = useState<string | null>(null);
  const [showRecentDrawer, setShowRecentDrawer] = useState(false);
  const [dealComponentsMap, setDealComponentsMap] = useState<Record<string, any[]>>({});
  const [kdsEnabled, setKdsEnabled] = useState(true);
  const confirmTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setKdsEnabled(getKdsDisplayEnabled());
    const unsub = posBus.subscribe((msg: any) => {
      if (msg.type === 'KDS_TOGGLED') {
        setKdsEnabled(Boolean(msg.kdsEnabled));
      }
    });
    return () => unsub();
  }, []);

  // Load deal components for unpacking fixed/legacy deals on tickets
  useEffect(() => {
    const loadDealComps = async () => {
      try {
        // 1. Instant local Dexie load (0ms offline guarantee)
        const localDeals = await db.deal_components.toArray();
        if (localDeals && localDeals.length > 0) {
          const map: Record<string, any[]> = {};
          localDeals.forEach(dc => {
            if (!map[dc.deal_id]) map[dc.deal_id] = [];
            map[dc.deal_id].push(dc);
          });
          setDealComponentsMap(map);
        }


      } catch (err) {
        console.warn('Could not load deal components in KDS:', err);
      }
    };
    loadDealComps();
  }, []);

  // Play subtle web audio notification chime
  const playChime = useCallback(() => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.3);
    } catch {
      // AudioContext may be blocked before interaction, safe to ignore
    }
  }, []);

  interface ClearedDineInRecord {
    itemCount: number;
    clearedAt: string;
  }

  const getClearedDineInRecords = (): Record<string, ClearedDineInRecord> => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const raw = localStorage.getItem(`kds_cleared_dine_in_${today}`);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const records: Record<string, ClearedDineInRecord> = {};
        parsed.forEach(id => {
          records[id] = { itemCount: 999, clearedAt: new Date().toISOString() };
        });
        return records;
      }
      return parsed;
    } catch {
      return {};
    }
  };

  const addClearedDineInId = (orderId: string, itemCount: number) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const records = getClearedDineInRecords();
      records[orderId] = { itemCount, clearedAt: new Date().toISOString() };
      localStorage.setItem(`kds_cleared_dine_in_${today}`, JSON.stringify(records));
    } catch (e) {
      console.error(e);
    }
  };

  const removeClearedDineInId = (orderId: string) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const records = getClearedDineInRecords();
      delete records[orderId];
      localStorage.setItem(`kds_cleared_dine_in_${today}`, JSON.stringify(records));
    } catch (e) {
      console.error(e);
    }
  };

  const fetchActiveOrders = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    // 24-hour cutoff prevents cross-midnight shift bugs while filtering out stale test orders
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    try {
      // 1. Query local Dexie DB FIRST for guaranteed 0ms response
      let localOrders: any[] = [];
      try {
        const rawLocal = await db.orders
          .where('status')
          .anyOf('PENDING', 'OPEN_TAB')
          .toArray();
        localOrders = (rawLocal || []).filter(o => o.created_at >= cutoff);
      } catch (dexErr) {
        console.warn("[KDS] Local Dexie read note:", dexErr);
      }

      // 2. Build unified order map from local Dexie orders
      const orderMap = new Map<string, any>();
      for (const local of (localOrders || [])) {
        orderMap.set(local.id, {
          ...local,
          items: local.items || []
        });
      }

      const clearedRecords = getClearedDineInRecords();
      const recentIds = new Set(recentCompletedRef.current.map(r => r.id));
      const formattedOrders: KdsOrder[] = [];

      orderMap.forEach(o => {
        const orderItems = consolidateKdsItems(o.items || [], Number(o.subtotal || o.net_total || 0));
        const currentItemCount = orderItems.length;
        const clearedInfo = clearedRecords[o.id];
        const isDineIn = o.order_type === 'DINE_IN';

        // Check if new items were added to this Dine-In tab after it was previously marked ready
        const hasNewUnpreparedItems = isDineIn && clearedInfo && currentItemCount > clearedInfo.itemCount;

        if (hasNewUnpreparedItems) {
          // Food was added to this table! Un-dismiss immediately so kitchen prepares it
          removeClearedDineInId(o.id);
          setRecentCompleted(prev => prev.filter(r => r.id !== o.id));
        } else {
          // Never show orders already in the recent completed drawer unless new items were added
          if (recentIds.has(o.id)) return;
          // Never show dine-in orders that were cleared unless new items were added
          if (isDineIn && clearedInfo && currentItemCount <= clearedInfo.itemCount) return;
        }

        formattedOrders.push({
          ...o,
          items: orderItems
        } as KdsOrder);
      });

      // Sort chronological
      formattedOrders.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      setOrders(prev => {
        if (prev.length > 0 && formattedOrders.length > prev.length) {
          playChime();
        }
        return formattedOrders;
      });
    } catch (e) {
      console.error("KDS auto-fetch error:", e);
    } finally {
      if (!silent) setIsLoading(false);
    }
  }, [playChime]);

  // Handle auto-reset timeout for confirmation
  const handleStartConfirm = (orderId: string) => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setConfirmingOrderId(orderId);
    confirmTimeoutRef.current = setTimeout(() => {
      setConfirmingOrderId(prev => (prev === orderId ? null : prev));
    }, 7000); // 7 seconds auto-cancel if not confirmed
  };

  const handleCancelConfirm = () => {
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    setConfirmingOrderId(null);
  };

  useEffect(() => {
    // Initial fetch
    fetchActiveOrders();

    // 1. Background Heartbeat Polling: Auto-fetches silently every 3.5 seconds
    // Guarantees KDS is ALWAYS synchronized with ZERO manual refresh!
    const pollInterval = setInterval(() => {
      fetchActiveOrders(true);
    }, 3500);

    // 2. Instant 0-millisecond cross-tab broadcast bus listener
    const unsubBus = posBus.subscribe((msg) => {
      if (msg.orderId && (msg.type === 'KOT_SENT' || msg.type === 'ORDER_UPDATED')) {
        removeClearedDineInId(msg.orderId);
        setRecentCompleted(prev => prev.filter(r => r.id !== msg.orderId));
      } else if (msg.type === 'KDS_DINE_IN_CLEARED' && msg.orderId) {
        addClearedDineInId(msg.orderId, msg.itemCount || 999);
        if (msg.fullOrder) {
          const record = { ...msg.fullOrder, completedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
          setRecentCompleted(prev => [record, ...prev.filter(r => r.id !== msg.orderId)].slice(0, 20));
        }
      } else if (msg.type === 'ORDER_COMPLETED' && msg.orderId && msg.fullOrder) {
        const record = { ...msg.fullOrder, completedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        setRecentCompleted(prev => [record, ...prev.filter(r => r.id !== msg.orderId)].slice(0, 20));
      }
      
      fetchActiveOrders(true);
      if (msg.type === 'ORDER_CREATED' || msg.type === 'KOT_SENT' || msg.type === 'ORDER_UPDATED') {
        playChime();
      }
    });

    return () => {
      clearInterval(pollInterval);
      unsubBus();
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, [fetchActiveOrders, playChime]);

  // STEP 2: Final execution of Mark as Ready
  const markAsReady = async (orderId: string) => {
    handleCancelConfirm();
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    // Push into recently completed history buffer (up to 20 items)
    const completedRecord: CompletedKdsOrder = {
      ...order,
      completedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    setRecentCompleted(prev => [completedRecord, ...prev.filter(o => o.id !== orderId)].slice(0, 20));

    // Remove from active screen immediately
    setOrders(prev => prev.filter(o => o.id !== orderId));
    
    try {
      if (order.order_type !== 'DINE_IN') {
        // Update local Dexie DB IMMEDIATELY (0ms) so it is never re-queried as active!
        await db.orders.update(orderId, { status: 'COMPLETED', sync_status: 'PENDING' });
        posBus.publish('ORDER_COMPLETED', { orderId, tokenNumber: order.token_number });
      } else {
        // For Dine-In, kitchen is done preparing current items, but tab remains open in POS for payment
        addClearedDineInId(orderId, order.items.length);
      }
    } catch (err) {
      console.error("Failed to mark order as ready:", err);
    }
  };

  // RECALL / UNDO: Restore an order that was accidentally dismissed
  const recallOrder = async (orderId: string) => {
    const orderToRecall = recentCompleted.find(o => o.id === orderId);
    if (!orderToRecall) return;

    setRecentCompleted(prev => prev.filter(o => o.id !== orderId));
    removeClearedDineInId(orderId);

    const targetStatus = orderToRecall.order_type === 'DINE_IN' ? 'OPEN_TAB' : 'PENDING';
    try {
      // 1. Update local Dexie immediately (0ms)
      await db.orders.update(orderId, { status: targetStatus, sync_status: 'PENDING' });
      posBus.publish('KOT_SENT', { orderId, tokenNumber: orderToRecall.token_number });
    } catch (err) {
      console.error("Failed to recall order:", err);
    }

    // Re-add to active orders immediately
    setOrders(prev => {
      if (prev.find(o => o.id === orderId)) return prev;
      return [...prev, orderToRecall].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });

    playChime();
  };

  if (!kdsEnabled) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 text-amber-500 border border-amber-500/20 flex items-center justify-center mb-6 shadow-inner">
            <MonitorOff className="w-8 h-8" />
          </div>
          <div className="flex items-center gap-2 mb-2">
            <MuchachosSymbol size={28} color="#E11D2A" />
            <h1 className="text-xl font-black tracking-tight text-white">MUCHACHOS KDS</h1>
          </div>
          <p className="text-xs font-bold text-amber-500 uppercase tracking-widest mb-4">
            Screen Display Inactive
          </p>
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/80 mb-6 text-left space-y-2">
            <p className="text-xs text-slate-300 font-semibold leading-relaxed">
              &bull; Kitchen ticket display is currently disabled by Admin.
            </p>
            <p className="text-xs text-slate-300 font-semibold leading-relaxed">
              &bull; Kitchen processes are operating via <span className="text-emerald-400 font-bold">Physical Printed Tokens</span>.
            </p>
            <p className="text-xs text-slate-300 font-semibold leading-relaxed">
              &bull; The Cashier is managing token matching and clearing via <span className="text-amber-400 font-bold">POS Kitchen Queue (F2)</span>.
            </p>
          </div>
          <div className="flex flex-col gap-2 w-full">
            <button
              onClick={() => {
                setKdsDisplayEnabled(true);
                setKdsEnabled(true);
              }}
              className="w-full py-3 px-4 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs transition-all shadow-md active:scale-95 cursor-pointer flex items-center justify-center gap-2"
            >
              <Tv className="w-4 h-4" />
              <span>Override &amp; Enable KDS Screen</span>
            </button>
            <button
              type="button"
              onClick={() => openAppRoute('pos')}
              className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-all text-center cursor-pointer"
            >
              Switch to POS Terminal &rarr;
            </button>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-800/80 w-full flex justify-center">
            <TeddopsBranding variant="compact" className="text-slate-400" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-6 font-sans flex flex-col">
      {/* KDS Header */}
      <header className="flex flex-wrap items-center justify-between pb-6 border-b border-slate-800 mb-6 gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#E11D2A] text-white flex items-center justify-center p-2 shadow-lg border border-red-500/40 shrink-0">
            <MuchachosSymbol size={36} color="#FFFFFF" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                MUCHACHOS <span className="text-[#E11D2A] font-extrabold text-xs sm:text-sm bg-red-950/60 border border-red-500/30 px-2 py-0.5 rounded-md">KDS</span>
              </h1>
              <span className="text-xs font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-orange-400 animate-pulse" /> Live Kitchen
              </span>
            </div>
            <p className="text-slate-400 text-xs font-semibold flex items-center gap-2 mt-0.5">
              <span className="font-serif italic text-red-300">An Oasis Of Taste</span> &bull; 2-Step Verification &bull; Realtime Sync
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Official Teddops Badge */}
          <TeddopsBranding variant="badge" className="hidden lg:inline-flex bg-slate-900 border-slate-800" />

          {/* Recently Completed Drawer Toggle */}
          <button
            onClick={() => setShowRecentDrawer(!showRecentDrawer)}
            className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all border ${
              showRecentDrawer
                ? 'bg-slate-800 text-white border-slate-700'
                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
            }`}
          >
            <History className="w-4 h-4 text-emerald-400" />
            <span>Recently Ready ({recentCompleted.length})</span>
          </button>

          <div className="bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-sm">
            <Clock className="w-5 h-5 text-amber-400" />
            <span className="font-black text-amber-400 text-base">{orders.length}</span>
            <span className="text-slate-400 text-sm font-bold">Active in Kitchen</span>
          </div>
        </div>
      </header>

      {/* Collapsible Recently Ready Drawer */}
      {showRecentDrawer && (
        <div className="mb-6 p-4 bg-slate-900/90 border border-emerald-500/30 rounded-2xl shadow-2xl animate-in slide-in-from-top-4 duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-emerald-400" />
              <h3 className="font-black text-sm text-emerald-300 uppercase tracking-wider">
                Recently Completed Orders (Click Recall to Restore if Cleared by Mistake)
              </h3>
            </div>
            <button
              onClick={() => setShowRecentDrawer(false)}
              className="text-slate-400 hover:text-white p-1 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {recentCompleted.length === 0 ? (
            <p className="text-sm text-slate-500 py-3 text-center">No orders have been marked ready yet in this session.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {recentCompleted.map((rec) => (
                <div
                  key={rec.id}
                  className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex items-center justify-between shadow"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-lg text-white">#{rec.token_number.toString().padStart(3, '0')}</span>
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                        {rec.order_type.replace('_', ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Ready at <span className="font-semibold text-emerald-400">{rec.completedAt}</span> &bull; {rec.items.length} item(s)
                    </p>
                  </div>
                  <button
                    onClick={() => recallOrder(rec.id)}
                    className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/40 rounded-lg text-xs font-black transition-all flex items-center gap-1 active:scale-95 shadow"
                    title="Restore back to active kitchen board"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> RECALL
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main KDS Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center flex-1 py-20">
          <div className="flex flex-col items-center gap-3">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-500"></div>
            <p className="text-slate-400 text-sm font-bold">Connecting to live kitchen feed...</p>
          </div>
        </div>
      ) : orders.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 py-24 text-slate-500">
          <div className="p-6 rounded-full bg-slate-900/60 border border-slate-800/80 mb-4">
            <UtensilsCrossed className="w-16 h-16 text-slate-600" />
          </div>
          <h2 className="text-2xl font-black text-slate-300">Kitchen is All Clear!</h2>
          <p className="text-slate-500 font-medium mt-1">Waiting for incoming tickets from Cashier POS...</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 items-start">
          {orders.map((order) => {
            const isConfirming = confirmingOrderId === order.id;

            const typeColor = 
              order.order_type === 'DINE_IN' ? 'border-blue-500 shadow-blue-950/20' :
              order.order_type === 'FOODPANDA' ? 'border-pink-500 shadow-pink-950/20' :
              'border-orange-500 shadow-orange-950/20';

            const badgeBg =
              order.order_type === 'DINE_IN' ? 'bg-blue-500/20 text-blue-300 border-blue-500/30' :
              order.order_type === 'FOODPANDA' ? 'bg-pink-500/20 text-pink-300 border-pink-500/30' :
              'bg-orange-500/20 text-orange-300 border-orange-500/30';

            // Calculate elapsed minutes
            const elapsedMinutes = Math.floor((Date.now() - new Date(order.created_at).getTime()) / 60000);
            const isDelayed = elapsedMinutes >= 15;

            return (
              <div 
                key={order.id} 
                className={`bg-slate-900 rounded-2xl border-t-4 ${typeColor} shadow-2xl overflow-hidden flex flex-col max-h-[640px] transition-all relative ${
                  isConfirming ? 'ring-2 ring-emerald-500 bg-slate-900/95' : ''
                }`}
              >
                {/* Header */}
                <div className="p-4 border-b border-slate-800 bg-slate-900/70 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-4xl font-black text-white">#{order.token_number.toString().padStart(3, '0')}</h3>
                      {isDelayed && (
                        <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/40 animate-pulse">
                          DELAYED
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs font-black uppercase tracking-wider px-2 py-0.5 rounded border ${badgeBg}`}>
                        {order.order_type.replace('_', ' ')}
                      </span>
                      {order.table_number && (
                        <span className="text-xs font-black text-white bg-blue-600/40 border border-blue-400/40 px-2 py-0.5 rounded">
                          TBL #{order.table_number}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-400 bg-slate-800/80 px-2.5 py-1 rounded block">
                      {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`text-[11px] font-bold mt-1 block ${isDelayed ? 'text-red-400 font-black' : 'text-slate-500'}`}>
                      {elapsedMinutes}m ago
                    </span>
                  </div>
                </div>

                {/* Packaging Directive Banner */}
                {order.order_type === 'DINE_IN' ? (
                  <div className="bg-blue-950/90 border-b border-blue-800/80 px-3 py-1.5 text-xs font-black text-blue-200 flex items-center justify-between uppercase tracking-wide">
                    <span className="flex items-center gap-1.5">
                      <Utensils className="w-3.5 h-3.5 text-blue-400" />
                      <span>PACKING: DINE-IN TRAYS / PLATES</span>
                    </span>
                    {order.table_number && (
                      <span className="bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded font-black">
                        TBL #{order.table_number}
                      </span>
                    )}
                  </div>
                ) : order.order_type === 'FOODPANDA' ? (
                  <div className="bg-pink-950/90 border-b border-pink-800/80 px-3 py-1.5 text-xs font-black text-pink-200 flex items-center justify-between uppercase tracking-wide">
                    <span className="flex items-center gap-1.5">
                      <Bike className="w-3.5 h-3.5 text-pink-400" />
                      <span>PACKING: SEAL FOODPANDA BAG + STAPLE SLIP</span>
                    </span>
                    <span className="bg-pink-600 text-white text-[10px] px-2 py-0.5 rounded font-black">
                      FOODPANDA
                    </span>
                  </div>
                ) : (
                  <div className="bg-orange-950/90 border-b border-orange-800/80 px-3 py-1.5 text-xs font-black text-orange-200 flex items-center justify-between uppercase tracking-wide">
                    <span className="flex items-center gap-1.5">
                      <ShoppingBag className="w-3.5 h-3.5 text-orange-400" />
                      <span>PACKING: TAKEAWAY BOXES & CARRY BAG</span>
                    </span>
                    <span className="bg-orange-600 text-white text-[10px] px-2 py-0.5 rounded font-black">
                      TAKEAWAY
                    </span>
                  </div>
                )}

                {/* Prominent Banner if ticket contains newly added table add-ons */}
                {order.items.some(i => isAddonItem(i)) && (
                  <div className="bg-amber-500 text-slate-950 px-3 py-1.5 font-black text-xs uppercase tracking-wider flex items-center justify-between border-y border-amber-600 shadow-sm animate-pulse">
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-ping inline-block" />
                      <span>ADD-ON TICKET UPDATED</span>
                    </span>
                    <span className="bg-slate-950 text-white text-[10px] px-2 py-0.5 rounded font-black">
                      PREPARE NEW ITEMS
                    </span>
                  </div>
                )}

                {/* Items List */}
                <div className="p-4 flex-1 overflow-y-auto space-y-3">
                  {order.items.length === 0 ? (
                    <div className="py-8 text-center text-slate-400 text-xs font-bold animate-pulse flex flex-col items-center gap-2">
                      <RotateCcw className="w-5 h-5 animate-spin text-amber-500" />
                      <span>Syncing kitchen items...</span>
                    </div>
                  ) : (
                    order.items.map((item, idx) => {
                      const isItemAddon = isAddonItem(item);
                      const ticketHasAddons = order.items.some(i => isAddonItem(i));

                      return (
                        <div 
                          key={idx} 
                          className={`flex flex-col transition-all ${
                            isItemAddon 
                              ? 'p-3 rounded-xl bg-amber-500/15 border-2 border-amber-500/60 shadow-md ring-2 ring-amber-500/20' 
                              : 'pb-3 border-b border-slate-800/60 last:border-b-0 opacity-90'
                          }`}
                        >
                          {isItemAddon && (
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-black uppercase text-amber-300 bg-amber-500/30 px-2 py-0.5 rounded-full border border-amber-500/40 flex items-center gap-1">
                                🔥 NEW ADD-ON (PREPARE NOW)
                              </span>
                            </div>
                          )}

                          <div className="flex items-start gap-3">
                            <span className={`text-xl font-black w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${
                              isItemAddon 
                                ? 'bg-amber-400 text-slate-950 border-amber-300 shadow font-black' 
                                : 'text-white bg-slate-800/90 border-slate-700'
                            }`}>
                              {item.quantity}
                            </span>
                            <div className="flex flex-col flex-1">
                              {(() => {
                                const itemSwaps = typeof item.deal_swaps_json === 'string'
                                  ? (() => { try { return JSON.parse(item.deal_swaps_json); } catch { return []; } })()
                                  : (item.deal_swaps_json || []);

                                const customDealItems = Array.isArray(itemSwaps) 
                                  ? itemSwaps.filter((s: any) => s && (s.item_name || s.menu_item_id) && !s.is_addon)
                                  : [];

                                const dbDealComps = dealComponentsMap[item.menu_item_id] || [];
                                const isDeal = customDealItems.length > 0 || dbDealComps.length > 0;

                                const dealConstituents = customDealItems.length > 0
                                  ? customDealItems
                                  : dbDealComps.map(dc => ({
                                      item_name: dc.child?.name || 'Deal Item',
                                      quantity: Number(dc.quantity || 1),
                                      modifiers: []
                                    }));

                                return (
                                  <>
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        {isDeal && (
                                          <span className="text-[10px] font-black uppercase text-amber-300 bg-amber-500/25 px-1.5 py-0.5 rounded border border-amber-500/40">
                                            DEAL
                                          </span>
                                        )}
                                        <span className={`text-lg font-black leading-tight ${isItemAddon ? 'text-amber-200' : 'text-slate-100'}`}>
                                          {item.item_name}
                                        </span>
                                      </div>
                                      {ticketHasAddons && !isItemAddon && (
                                        <span className="text-[9px] font-bold text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded">
                                          Original
                                        </span>
                                      )}
                                    </div>

                                    {/* Deal Constituent Breakdown */}
                                    {dealConstituents.length > 0 && (
                                      <div className="mt-2 space-y-1.5 border-l-2 border-amber-400/50 pl-2.5 py-0.5">
                                        {dealConstituents.map((comp: any, cIdx: number) => {
                                          const compTotalQty = Number(comp.quantity || 1) * Number(item.quantity || 1);
                                          return (
                                            <div key={cIdx} className="text-xs">
                                              <div className="flex items-center gap-1.5 text-slate-200 font-bold">
                                                <span className="text-amber-400 font-black">&bull;</span>
                                                <span className="font-black text-amber-300 bg-amber-500/20 px-1 rounded text-[11px] min-w-[20px] text-center">
                                                  {compTotalQty}x
                                                </span>
                                                <span className="text-slate-100 font-bold">{comp.item_name}</span>
                                              </div>
                                              {comp.modifiers && comp.modifiers.length > 0 && (
                                                <div className="ml-4 mt-0.5 flex flex-wrap gap-1">
                                                  {comp.modifiers.map((m: any, mIdx: number) => (
                                                    <span key={mIdx} className="text-[10px] font-black text-amber-300 bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.2 rounded">
                                                      ↳ +{m.qty || 1} {m.name}
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Item-level Modifiers */}
                                    {item.modifiers_json && item.modifiers_json.length > 0 && (
                                      <ul className="mt-1.5 space-y-1">
                                        {item.modifiers_json.map((mod: any, mIdx: number) => (
                                          <li 
                                            key={mIdx} 
                                            className={`text-xs font-black px-2 py-0.5 rounded flex items-center gap-1.5 w-fit ${
                                              isItemAddon 
                                                ? 'text-amber-300 bg-amber-500/20 border border-amber-500/40' 
                                                : 'text-amber-400 bg-amber-500/10 border border-amber-500/20'
                                            }`}
                                          >
                                            <span>+</span> {mod.qty || 1}x {mod.name}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* 2-STEP "MARK READY" ACTION SECTION */}
                <div className="p-4 bg-slate-900 border-t border-slate-800 mt-auto">
                  {isConfirming ? (
                    <div className="space-y-2 animate-in fade-in zoom-in-95 duration-150">
                      <div className="flex items-center justify-center gap-1 text-xs font-bold text-amber-400 bg-amber-500/10 py-1 px-2 rounded-lg border border-amber-500/20">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Step 2: Please confirm order completion</span>
                      </div>
                      <div className="flex gap-2 w-full">
                        <button 
                          onClick={handleCancelConfirm}
                          className="flex-1 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm tracking-wide transition-all border border-slate-700 active:scale-95 flex items-center justify-center gap-1.5"
                        >
                          <X className="w-4 h-4 text-slate-400" />
                          <span>Cancel</span>
                        </button>
                        <button 
                          onClick={() => markAsReady(order.id)}
                          className="flex-[2] py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-sm tracking-wide shadow-lg shadow-emerald-950/60 animate-pulse active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                          <Check className="w-5 h-5" />
                          <span>CONFIRM READY & DISPATCH</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleStartConfirm(order.id)}
                      className="w-full py-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black tracking-wide text-base shadow-lg shadow-emerald-950/50 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                      <Check className="w-5 h-5" />
                      <span>MARK READY</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* KDS Footer Bar with Live Time, Operational Status & Teddops Engineering Branding */}
      <footer className="mt-auto pt-5 border-t border-slate-800/80 flex flex-wrap items-center justify-between text-xs text-slate-500 gap-3">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-slate-400 font-bold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Kitchen Display System &bull; Live Realtime Order Bus
          </span>
          <span className="text-slate-700 hidden sm:inline">&bull;</span>
          <span className="text-slate-400 font-semibold hidden sm:inline">
            Press <kbd className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono text-slate-300">F11</kbd> for Fullscreen TV Mode
          </span>
        </div>
        <TeddopsBranding variant="compact" className="text-slate-400" />
      </footer>
    </div>
  );
}
