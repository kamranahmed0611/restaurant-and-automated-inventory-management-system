"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { 
  Sun, Moon, Trash2, Plus, Minus, BarChart3, 
  Utensils, Grid2X2, ClipboardList, FileText, AlertCircle,
  RefreshCcw, Search, List, LayoutGrid, X, Lock, ShoppingBag, KeyRound, ShieldAlert,
  Scissors, AlertTriangle, Ban, Eye, Tv
} from "lucide-react";
import { useShallow } from 'zustand/react/shallow';
import { usePosStore } from "@/lib/store";
import { MENU_CATEGORIES as STATIC_CATEGORIES, MENU_ITEMS as STATIC_ITEMS, AVAILABLE_MODIFIERS, isDrinkOrRetailItem } from "@/lib/menu-data";
import { isLaptopWriter } from "@/lib/device-mode";
import CheckoutModal from "./CheckoutModal";
import SpoilageModal from "./SpoilageModal";
import ZReportModal from "./ZReportModal";
import CashierOrderAuditModal from "./CashierOrderAuditModal";
import ThermalReceiptPreviewModal from "./ThermalReceiptPreviewModal";
import CashierPinModal from "./CashierPinModal";
import SyncDiagnosticsModal from "./SyncDiagnosticsModal";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getNextTokenNumber, LocalOrder } from "@/lib/db";
import { printKitchenToken, getReceiptSettings } from "@/lib/receipt-printer";
import { deductOrderInventory, restockOrderInventory, populateOrderItemsCogs } from "@/lib/inventory-service";
import { 
  syncOfflineOrders, syncDownstream, loadFromLocalCache, startBackgroundSync,
  isExplicitOffline, switchPosToOffline, switchPosToOnline, performFullTwoWaySync,
  isCircuitBreakerTripped
} from "@/lib/sync-engine";
import { posBus } from "@/lib/broadcast-bus";
import { triggerDailyAutoBackup } from "@/lib/auto-backup";
import { getKdsDisplayEnabled, syncKdsDisplayFromCloud } from "@/lib/kds-config";
import { v4 as uuidv4 } from "uuid";
import { modal } from "@/lib/modalStore";
import DealCustomizerModal, { DealCustomizerResult } from "./DealCustomizerModal";
import MuchachosBrand from "./MuchachosBrand";
import TeddopsBranding from "./TeddopsBranding";
import FirstRunWizard from "./FirstRunWizard";
import { openAppRoute } from "@/lib/window-navigation";

export default function PosLayout() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const { 
    cart, subtotal, netTotal, clearCart, removeFromCart, updateQuantity, splitCartItem, splitAllCartItems, addModifier, removeModifier,
    activeOrderId, activeTableNumber, setActiveOrder, markCartAsSent, syncError,
    amendingBill, cancelAmendingBill,
    activeCashier, isRegisterLocked, lockRegister,
    activeShiftId, setActiveShift, isSyncingOrders
  } = usePosStore(useShallow(state => ({
    cart: state.cart,
    subtotal: state.subtotal,
    netTotal: state.netTotal,
    clearCart: state.clearCart,
    removeFromCart: state.removeFromCart,
    updateQuantity: state.updateQuantity,
    splitCartItem: state.splitCartItem,
    splitAllCartItems: state.splitAllCartItems,
    addModifier: state.addModifier,
    removeModifier: state.removeModifier,
    activeOrderId: state.activeOrderId,
    activeTableNumber: state.activeTableNumber,
    setActiveOrder: state.setActiveOrder,
    markCartAsSent: state.markCartAsSent,
    syncError: state.syncError,
    amendingBill: state.amendingBill,
    cancelAmendingBill: state.cancelAmendingBill,
    activeCashier: state.activeCashier,
    isRegisterLocked: state.isRegisterLocked,
    lockRegister: state.lockRegister,
    activeShiftId: state.activeShiftId,
    setActiveShift: state.setActiveShift,
    isSyncingOrders: state.isSyncingOrders
  })));

  const [isMounted, setIsMounted] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [viewMode, setViewMode] = useState<'MENU' | 'TABLES'>('MENU');
  const [activeCategory, setActiveCategory] = useState<string>('ALL');
  const [menuSearch, setMenuSearch] = useState<string>('');
  const [menuDisplayMode, setMenuDisplayModeState] = useState<'LIST' | 'GRID'>('GRID');
  const [isLaptop, setIsLaptop] = useState(true);

  useEffect(() => {
    setIsMounted(true);
    const laptop = isLaptopWriter();
    setIsLaptop(laptop);

    // First-run wizard: only on laptop, only if wizard hasn't been dismissed and no cashiers exist
    if (laptop) {
      const wizardDone = (() => { try { return !!localStorage.getItem('muchachos_wizard_done'); } catch { return false; } })();
      if (!wizardDone) {
        db.cashiers.count().then(count => {
          if (count === 0) setShowWizard(true);
        }).catch(() => {});
      }
    }

    try {
      const saved = localStorage.getItem('pos_menu_display_mode');
      if (saved === 'LIST' || saved === 'GRID') {
        setMenuDisplayModeState(saved);
      } else {
        localStorage.setItem('pos_menu_display_mode', 'GRID');
      }
    } catch {}
  }, []);

  const setMenuDisplayMode = (mode: 'LIST' | 'GRID') => {
    setMenuDisplayModeState(mode);
    try {
      localStorage.setItem('pos_menu_display_mode', mode);
    } catch {}
  };
  const [menuItems, setMenuItems] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [rawCategories, setRawCategories] = useState<any[]>([]);
  const [rawInventory, setRawInventory] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [dealComponents, setDealComponents] = useState<any[]>([]);
  const [availableModifiers, setAvailableModifiers] = useState<any[]>(AVAILABLE_MODIFIERS);
  const [customizingDealItem, setCustomizingDealItem] = useState<any | null>(null);
  const [isDealCustomizerOpen, setIsDealCustomizerOpen] = useState(false);
  const [kdsEnabled, setKdsEnabled] = useState(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false);

  // Live Reactive Dexie Queries - 100% Instant Real-time updates without manual refresh
  const liveRawInventory = useLiveQuery(() => db.raw_inventory.toArray(), []);
  const liveMenuItems = useLiveQuery(() => db.menu_items.toArray(), []);
  const liveCategories = useLiveQuery(() => db.categories.orderBy('sort_order').toArray(), []);
  const liveRecipes = useLiveQuery(() => db.recipes.toArray(), []);
  const liveDealComponents = useLiveQuery(() => db.deal_components.toArray(), []);
  const liveModifiers = useLiveQuery(() => db.modifiers.toArray(), []);

  useEffect(() => {
    if (liveRawInventory && liveRawInventory.length > 0) {
      setRawInventory(liveRawInventory);
    }
  }, [liveRawInventory]);

  useEffect(() => {
    if (liveMenuItems && liveMenuItems.length > 0) {
      setMenuItems(liveMenuItems);
    }
  }, [liveMenuItems]);

  useEffect(() => {
    if (liveCategories && liveCategories.length > 0) {
      setRawCategories(liveCategories);
      setCategories(liveCategories.map(c => c.name));
    }
  }, [liveCategories]);

  useEffect(() => {
    if (liveRecipes && liveRecipes.length > 0) {
      setRecipes(liveRecipes);
    }
  }, [liveRecipes]);

  useEffect(() => {
    if (liveDealComponents && liveDealComponents.length > 0) {
      setDealComponents(liveDealComponents);
    }
  }, [liveDealComponents]);

  useEffect(() => {
    if (liveModifiers && liveModifiers.length > 0) {
      setAvailableModifiers(liveModifiers);
    }
  }, [liveModifiers]);

  const loadMenuData = async (showToast = false) => {
    try {
      // 1. ALWAYS read local Dexie cache immediately (True 0ms Local-First)
      try {
        const [cached, localMods] = await Promise.all([
          loadFromLocalCache(),
          db.modifiers.toArray()
        ]);
        if (cached && (cached.menuItems.length > 0 || cached.categories.length > 0)) {
          setRawCategories(cached.categories || []);
          setCategories((cached.categories || []).map((c: any) => c.name));
          setMenuItems(cached.menuItems || []);
          setRawInventory(cached.rawInventory || []);
          setRecipes(cached.recipes || []);
          setDealComponents(cached.dealComponents || []);
        }
        if (localMods && localMods.length > 0) {
          setAvailableModifiers(localMods);
        }
      } catch (localErr) {
        console.warn("[POS] Local cache read warning:", localErr);
      }

      if (!navigator.onLine) {
        if (showToast) modal.toast.success("Offline mode — using cached local menu.");
        return;
      }

      if (showToast) modal.toast.success("Checking latest menu from cloud...");

      // 2. Cloud pull in background (silent downstream sync)
      const cloudData = await syncDownstream();
      if (cloudData && cloudData.menuItems && cloudData.menuItems.length > 0) {
        setRawCategories(cloudData.categories || []);
        setCategories((cloudData.categories || []).map((c: any) => c.name));
        setMenuItems(cloudData.menuItems || []);
        setRawInventory(cloudData.rawInventory || []);
        setRecipes(cloudData.recipes || []);
        setDealComponents(cloudData.dealComponents || []);
        if (showToast) modal.toast.success("Menu updated successfully!");
      }
    } catch (err) {
      console.warn("[POS] Background downstream sync note:", err);
    }
  };

  useEffect(() => {
    setKdsEnabled(getKdsDisplayEnabled());
    syncKdsDisplayFromCloud().then(setKdsEnabled);

    const unsub = posBus.subscribe((msg: any) => {
      if (msg.type === 'KDS_TOGGLED') {
        setKdsEnabled(Boolean(msg.kdsEnabled));
      }
    });

    return () => {
      unsub();
    };
  }, []);

  useEffect(() => {
    // 0ms instant local load
    loadMenuData(false);

    // Listen to local bus for menu changes, live stock deductions, void restocks and cashier PIN updates
    const unsubBus = posBus.subscribe((msg: any) => {
      if ([
        'MENU_UPDATED',
        'STOCK_UPDATED',
        'INVENTORY_DEDUCTED',
        'INVENTORY_RESTOCKED',
        'ORDER_CREATED',
        'ORDER_COMPLETED',
        'ORDER_CANCELLED'
      ].includes(msg?.type)) {
        loadMenuData();
      }
      if (msg.type === 'CASHIER_PIN_UPDATED') {
        const active = usePosStore.getState().activeCashier;
        if (active && (!msg.cashierId || msg.cashierId === active.id)) {
          console.warn('[POS] Cashier PIN updated via bus. Locking register immediately.');
          usePosStore.getState().lockRegister();
          modal.toast.warning("Cashier PIN updated! Please re-enter your new PIN to unlock.");
        }
      }
    });

    // Start 5-minute background pulse & sync scheduler
    const stopBackgroundSync = startBackgroundSync();

    // Run automated daily transactional Dexie JSON backup to disk & USB
    triggerDailyAutoBackup().catch((e) => console.warn('[AutoBackup] Startup backup note:', e));

    return () => {
      unsubBus();
      if (typeof stopBackgroundSync === 'function') {
        stopBackgroundSync();
      }
    };
  }, []);
  const [activeCartItemId, setActiveCartItemId] = useState<string | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isSpoilageOpen, setIsSpoilageOpen] = useState(false);
  const [isZReportOpen, setIsZReportOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [leftoverShift, setLeftoverShift] = useState<{ id: string; opened_at: string } | null>(null);

  const [kotPreviewData, setKotPreviewData] = useState<{
    order: any;
    items: any[];
    addonItems?: any[];
    isAddon: boolean;
  } | null>(null);

  const newAddons = amendingBill ? cart.filter(i => !i.is_original) : [];
  const additionalDue = amendingBill ? newAddons.reduce((sum, i) => sum + i.total_price, 0) : 0;
  const newGrandTotal = amendingBill ? (amendingBill.originalNetTotal + additionalDue) : netTotal;

  useEffect(() => {
    const fetchActiveShift = async () => {
      // 1. Instant local Dexie check (Local-First!)
      let resolvedShift: any = null;
      try {
        const localOpenShift = await db.shifts.where('status').equals('OPEN').first();
        const savedShiftId = typeof window !== 'undefined' ? localStorage.getItem('muchachos_active_shift_id') : null;
        
        resolvedShift = localOpenShift || null;
        if (!resolvedShift && savedShiftId) {
          resolvedShift = (await db.shifts.get(savedShiftId)) || null;
        }

        if (resolvedShift && resolvedShift.status === 'OPEN') {
          setActiveShift(resolvedShift.id);
          const shiftDay = new Date(resolvedShift.opened_at).toDateString();
          const today = new Date().toDateString();
          if (shiftDay !== today) {
            setLeftoverShift({ id: resolvedShift.id, opened_at: resolvedShift.opened_at });
            setIsZReportOpen(true);
          } else {
            setLeftoverShift(null);
          }
        }
      } catch (dexieErr) {
        console.warn("[POS] Local shift lookup:", dexieErr);
      }

      if (!resolvedShift || resolvedShift.status !== 'OPEN') {
        setLeftoverShift(null);
        setIsZReportOpen(true);
      }
    };
    fetchActiveShift();
  }, [setActiveShift]);
  const [isOnline, setIsOnline] = useState(true);
  const [isManualOffline, setIsManualOffline] = useState(false);
  const [isSyncingToggle, setIsSyncingToggle] = useState(false);

  useEffect(() => {
    setIsManualOffline(isExplicitOffline());
  }, []);

  const filteredMenuItems = menuItems.filter(item => {
    const matchesSearch = !menuSearch.trim() || item.name.toLowerCase().includes(menuSearch.toLowerCase());
    const matchesCat = activeCategory === 'ALL' || item.category_name === activeCategory;
    return matchesSearch && matchesCat;
  });

  const handleAddItemToCart = async (item: any) => {
    if (!isLaptop) {
      modal.toast.info("View-only mode: Order checkout operates on the counter laptop.");
      return;
    }

    const stock = getStockInfo(item.id);
    const isOutOfStock = stock.maxAvailable <= 0;
    if (isOutOfStock) {
      const confirmed = await modal.confirm({
        title: "⚠️ Low/Out of Stock Warning",
        message: `Zero or negative stock detected for:\n${stock.outOfStockIngs.join(', ')}\n\nDo you want to enable an EMERGENCY OVERRIDE for this order? (The owner must reconcile this before shift close)`,
        confirmText: "Enable Override",
        cancelText: "Cancel",
        isDanger: true
      });
      if (!confirmed) return;
    }

    const isDeal = Boolean(item.is_deal) || item.category_name?.toLowerCase() === 'deals' || item.category_name?.toLowerCase() === 'combos';

    if (isDeal) {
      let comps = dealComponents.filter(dc => dc.deal_id === item.id);

      // If components not in local memory yet, query local Dexie directly
      if (comps.length === 0) {
        const localComps = await db.deal_components.where('deal_id').equals(item.id).toArray();
        if (localComps && localComps.length > 0) {
          comps = localComps;
          setDealComponents(prev => [...prev.filter(d => d.deal_id !== item.id), ...localComps]);
        }
      }

      if (comps.length > 0) {
        setCustomizingDealItem(item);
        setIsDealCustomizerOpen(true);
        return;
      }
    }

    usePosStore.getState().addToCart({ 
      menu_item_id: item.id, 
      item_name: item.name, 
      unit_price: item.price, 
      quantity: 1,
      allows_modifiers: item.allows_modifiers !== false
    });
  };

  const handleConfirmCustomizedDeal = (result: DealCustomizerResult) => {
    if (!isLaptop) {
      modal.toast.info("View-only mode: Order checkout operates on the counter laptop.");
      return;
    }
    usePosStore.getState().addToCart({
      menu_item_id: result.menu_item_id,
      item_name: result.item_name,
      unit_price: result.unit_price,
      quantity: 1,
      total_price: result.total_price,
      modifiers_json: result.modifiers_json,
      deal_swaps_json: result.deal_swaps_json
    });
    modal.toast.success(`Added deal "${result.item_name}" to cart.`);
  };

  const getStockInfo = (menuItemId: string) => {
    let maxAvailable = Infinity;
    let hasWarning = false;
    const outOfStockIngs: string[] = [];

    const checkInv = (invId: string, neededQty: number) => {
      const inv = rawInventory.find(i => i.id === invId);
      if (inv) {
        const canMake = Math.floor(Number(inv.current_stock) / (neededQty || 1));
        if (canMake < maxAvailable) maxAvailable = canMake;
        if (Number(inv.current_stock) <= Number(inv.min_stock_alert)) hasWarning = true;
        if (Number(inv.current_stock) <= 0) outOfStockIngs.push(inv.name);
      }
    };

    const itemRecipes = recipes.filter(r => r.menu_item_id === menuItemId);
    itemRecipes.forEach(r => checkInv(r.inventory_item_id, Number(r.quantity_deducted)));

    const itemDealComps = dealComponents.filter(dc => dc.deal_id === menuItemId && dc.menu_item_id);
    itemDealComps.forEach(dc => {
      const childRecipes = recipes.filter(r => r.menu_item_id === dc.menu_item_id);
      childRecipes.forEach(r => checkInv(r.inventory_item_id, Number(r.quantity_deducted) * Number(dc.quantity)));
    });

    // Fallback for retail drinks or direct items without separate recipe rows
    if (itemRecipes.length === 0 && itemDealComps.length === 0) {
      const targetItem = menuItems.find(m => m.id === menuItemId);
      const directInv = rawInventory.find(i => 
        i.id === menuItemId || 
        (targetItem && i.name && targetItem.name && i.name.trim().toLowerCase() === targetItem.name.trim().toLowerCase())
      );
      if (directInv) {
        checkInv(directInv.id, 1);
      }
    }

    return { maxAvailable: maxAvailable === Infinity ? 999 : maxAvailable, hasWarning, outOfStockIngs };
  };

  const pendingCount = useLiveQuery(
    () => db.orders.where('sync_status').equals('PENDING').count(),
    []
  ) ?? 0;

  const pendingLogsCount = useLiveQuery(
    () => db.inventory_logs.where('sync_status').equals('PENDING').count(),
    []
  ) ?? 0;

  const totalPending = pendingCount + pendingLogsCount;

  const handleToggleOnlineOffline = async () => {
    if (isSyncingToggle) return;
    setIsSyncingToggle(true);

    try {
      if (!isManualOffline) {
        // Going to OFFLINE mode
        modal.toast.info("Preparing Offline Mode: Flushing pending bills & inventory to cloud...");
        const res = await switchPosToOffline();
        setIsManualOffline(true);
        setIsOnline(false);
        modal.toast.success(res.message);
      } else {
        // Returning to ONLINE mode
        modal.toast.info("Connecting to Cloud: Reconciling stock & upstreaming offline orders...");
        const res = await switchPosToOnline();
        setIsManualOffline(false);
        setIsOnline(navigator.onLine);
        if (res.success) {
          modal.toast.success(res.message);
          loadMenuData(false);
        } else {
          modal.toast.warning(res.message);
        }
      }
    } catch (err: any) {
      console.error("[POS] Online/Offline toggle error:", err);
      modal.toast.error("Mode switch error: " + (err.message || 'Unknown error'));
    } finally {
      setIsSyncingToggle(false);
    }
  };

  const inKitchenCount = useLiveQuery(
    () => db.orders.where('status').equals('PENDING').count(),
    []
  ) ?? 0;

  // Fetch occupied tables (OPEN_TAB)
  const openTabs = useLiveQuery(
    () => db.orders.where('status').equals('OPEN_TAB').toArray(),
    []
  ) ?? [];

  useEffect(() => {
    const isManual = isExplicitOffline();
    setIsManualOffline(isManual);
    setIsOnline(!isManual && navigator.onLine);

    const handleOnline = () => { 
      if (!isExplicitOffline()) {
        setIsOnline(true); 
        syncOfflineOrders(); 
      }
    };
    const handleOffline = () => setIsOnline(false);
    
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setTheme(theme === 'dark' ? 'light' : 'dark');
      }
      if (e.key === 'F2') {
        e.preventDefault();
        setIsAuditModalOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [theme, setTheme]);

  // Handle saving an open tab (Send to Kitchen)
  const handleSendToKitchen = async () => {
    if (!isLaptop) {
      modal.toast.warning("View-only mode: Cannot send orders from phone.");
      return;
    }

    if (cart.length === 0) return;
    
    const hasUnsentItems = cart.some(i => !i.is_sent);
    if (!hasUnsentItems && activeOrderId) {
      modal.warning("No Unsent Items", "All items on this table have already been sent to the kitchen. Add new items first.");
      return;
    }

    try {
      const receiptSettings = getReceiptSettings();

      if (activeOrderId) {
        // UPDATE EXISTING TAB WITH ADD-ONS
        const existingOrder = await db.orders.get(activeOrderId);
        if (existingOrder) {
          const unsentItems = cart.filter(i => !i.is_sent);
          const now = new Date().toISOString();

          // Stamp new add-ons in deal_swaps_json so KDS and DB persistently know which items are add-ons!
          const stampedCart = cart.map(item => {
            if (!item.is_sent) {
              return {
                ...item,
                is_sent: true,
                is_addon: true,
                deal_swaps_json: [
                  ...(item.deal_swaps_json || []),
                  { is_addon: true, added_at: now }
                ]
              };
            }
            return item;
          });

          const enrichedCart = await populateOrderItemsCogs(stampedCart as any);
          const updatedOrder = {
            ...existingOrder,
            items: enrichedCart,
            subtotal,
            net_total: netTotal,
            sync_status: 'PENDING' as const
          };
          await db.orders.put(updatedOrder);

          // Deduct inventory immediately for new add-on items
          await deductOrderInventory(unsentItems as any, updatedOrder.id);

          // Remove from local KDS cleared cache if any
          try {
            const today = new Date().toISOString().split('T')[0];
            const clearedKey = `kds_cleared_dine_in_${today}`;
            const raw = localStorage.getItem(clearedKey);
            if (raw) {
              const list = JSON.parse(raw).filter((id: string) => id !== activeOrderId);
              localStorage.setItem(clearedKey, JSON.stringify(list));
            }
          } catch {}

          usePosStore.setState({ cart: stampedCart });
          setTimeout(() => syncOfflineOrders(), 50);
          posBus.publish('KOT_SENT', {
            orderId: updatedOrder.id,
            tokenNumber: updatedOrder.token_number,
            orderType: updatedOrder.order_type,
            tableNumber: updatedOrder.table_number
          });

          // Fast Thermal Print KOT Add-on
          if (receiptSettings.autoPrintDineInKot) {
            printKitchenToken(updatedOrder, { items: unsentItems, isAddon: true, title: "KOT ADD-ON TICKET" });
            modal.toast.success(`Add-on sent to kitchen for Table ${updatedOrder.table_number}!`);
          } else {
            setKotPreviewData({
              order: updatedOrder,
              items: stampedCart,
              addonItems: unsentItems,
              isAddon: true
            });
          }
        }
      } else {
        // CREATE NEW OPEN TAB
        if (!activeTableNumber) {
          modal.warning("Table Required", "Please select a table first from the TABLES view before sending an order to the kitchen!");
          setViewMode('TABLES');
          return;
        }
        const token_number = await getNextTokenNumber();
        const rawSentItems = cart.map(i => ({ ...i, is_sent: true }));
        const sentItems = await populateOrderItemsCogs(rawSentItems as any);
        const newOrder: LocalOrder = {
          id: uuidv4(),
          token_number,
          order_type: 'DINE_IN',
          payment_method: 'PENDING',
          status: 'OPEN_TAB',
          subtotal,
          discount: 0,
          net_total: netTotal,
          foodpanda_commission_pct: 0,
          table_number: activeTableNumber,
          created_at: new Date().toISOString(),
          items: sentItems,
          sync_status: 'PENDING'
        };
        await db.orders.add(newOrder);
        setActiveOrder(newOrder.id, activeTableNumber, sentItems);

        // Deduct inventory immediately upon sending to kitchen
        await deductOrderInventory(sentItems as any, newOrder.id);

        usePosStore.setState({ cart: sentItems });
        setTimeout(() => syncOfflineOrders(), 50);
        posBus.publish('KOT_SENT', {
          orderId: newOrder.id,
          tokenNumber: newOrder.token_number,
          orderType: newOrder.order_type,
          tableNumber: newOrder.table_number
        });

        // Fast Thermal Print Initial KOT
        if (receiptSettings.autoPrintDineInKot) {
          printKitchenToken(newOrder, { items: sentItems, isAddon: false });
          modal.toast.success(`Table ${activeTableNumber} order sent to kitchen!`);
        } else {
          setKotPreviewData({
            order: newOrder,
            items: sentItems,
            addonItems: [],
            isAddon: false
          });
        }
      }
    } catch (err) {
      console.error("Failed to send to kitchen", err);
    }
  };

  const handleTableClick = async (tableNum: string) => {
    const currentTable = usePosStore.getState().activeTableNumber;
    
    // Save current cart before switching
    if (!currentTable) {
      usePosStore.getState().parkCart('WALKIN');
    } else {
      usePosStore.getState().parkCart(currentTable);
    }

    const existingTab = openTabs.find(t => t.table_number === tableNum);
    const parkedData = usePosStore.getState().parkedCarts[tableNum];

    if (existingTab && parkedData && parkedData.activeOrderId === existingTab.id) {
      // If we parked unsent items for this active table locally, restore them
      usePosStore.getState().restoreCart(tableNum);
      setViewMode('MENU');
    } else if (existingTab) {
      // Load existing tab from DB into cart
      usePosStore.getState().clearParkedCart(tableNum);
      setActiveOrder(existingTab.id, existingTab.table_number!, existingTab.items as any);
      setViewMode('MENU');
    } else {
      // Table is vacant! Start fresh empty tab
      usePosStore.getState().clearParkedCart(tableNum);
      usePosStore.getState().restoreCart(tableNum);
      setViewMode('MENU');
    }
  };

  const unsentCount = cart.filter(i => !i.is_sent).length;

  if (!isMounted) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-[#E11D2A] border-t-transparent rounded-full animate-spin"></div>
          <p className="font-bold text-sm tracking-widest text-slate-300 uppercase">Loading Muchachos POS...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden bg-background">
      {/* FIRST-RUN WIZARD (laptop only, shown once when no cashiers exist) */}
      {showWizard && (
        <FirstRunWizard onComplete={() => setShowWizard(false)} />
      )}



      <header className="flex items-center justify-between px-3 py-1.5 sm:px-4 sm:py-2 border-b border-border bg-card/95 backdrop-blur-md shadow-xs sticky top-0 z-40 gap-1.5 sm:gap-2">
        <div className="flex items-center gap-1.5 sm:gap-2 shrink min-w-0 overflow-x-auto no-scrollbar">
          <div className="scale-85 sm:scale-95 origin-left shrink-0">
            <MuchachosBrand size="sm" subtitle="POS" />
          </div>
          {kdsEnabled && (
            <button 
              onClick={() => openAppRoute('kds')} 
              className="text-[11px] font-black bg-slate-100 hover:bg-[#E11D2A] hover:text-white dark:bg-slate-850 dark:hover:bg-[#E11D2A] text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg shadow-2xs transition-all active:scale-95 flex items-center gap-1 cursor-pointer shrink-0"
              title="Open Kitchen Display (Drag to 2nd Monitor/TV)"
            >
              <span>KDS</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            </button>
          )}
          <button 
            onClick={() => openAppRoute('admin')}
            className="text-[11px] font-black bg-slate-100 hover:bg-slate-900 hover:text-white dark:bg-slate-850 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700 px-2.5 py-1 rounded-lg shadow-2xs transition-all active:scale-95 flex items-center gap-1 cursor-pointer shrink-0"
            title="Owner Admin Portal (Separate Tab/Window)"
          >
            <BarChart3 className="w-3.5 h-3.5" /> 
            <span>ADMIN</span>
            <Lock className="w-2.5 h-2.5 text-amber-500" />
          </button>
          {isLaptop && (
            <button 
              onClick={() => setIsSpoilageOpen(true)} 
              className="text-[11px] font-black bg-red-50 hover:bg-red-600 hover:text-white text-red-600 dark:bg-red-950/40 dark:text-red-300 border border-red-200 dark:border-red-800 px-2.5 py-1 rounded-lg transition-all shadow-2xs active:scale-95 flex items-center gap-1 cursor-pointer shrink-0"
              title="Log Waste / Spoilage"
            >
              WASTE
            </button>
          )}
          {isLaptop && (
            <button 
              onClick={() => setIsZReportOpen(true)} 
              className={`text-[11px] font-black px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 shadow-2xs active:scale-95 cursor-pointer shrink-0 ${
                activeShiftId 
                  ? 'bg-blue-50 text-blue-700 hover:bg-blue-600 hover:text-white border border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800' 
                  : 'bg-amber-100 text-amber-900 hover:bg-amber-600 hover:text-white border border-amber-300 animate-pulse'
              }`}
              title="Shift Management & Float"
            >
              <FileText className="w-3 h-3" />
              <span>{activeShiftId ? 'SHIFT' : 'START SHIFT'}</span>
              {activeShiftId && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" title="Shift Active"></span>}
            </button>
          )}
          <button 
            onClick={() => setIsAuditModalOpen(true)} 
            className={`text-[11px] font-black px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 shadow-2xs active:scale-95 cursor-pointer shrink-0 ${
              inKitchenCount > 0 
                ? 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-black border border-amber-400 shadow-sm animate-pulse' 
                : 'bg-amber-50 dark:bg-amber-950/50 text-amber-900 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-500 hover:text-slate-950'
            }`}
            title="Kitchen Order Queue & Token Clearing (Shortcut: F2)"
          >
            <ClipboardList className="w-3 h-3" />
            <span>QUEUE</span>
            {inKitchenCount > 0 ? (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-950 text-amber-400 font-black text-[9px]">
                {inKitchenCount}
              </span>
            ) : null}
          </button>
        
          <button
            onClick={() => loadMenuData(true)}
            title="Refresh Menu Data"
            className="p-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <RefreshCcw className="w-3 h-3" />
          </button>
        </div>

        {/* Center: Menu vs Tables Switcher */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-850 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0">
          <button 
            onClick={() => setViewMode('MENU')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-black text-[11px] transition-all cursor-pointer ${viewMode === 'MENU' ? 'bg-white dark:bg-slate-700 text-[#E11D2A] dark:text-red-400 shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
          >
            <Utensils className="w-3 h-3" /> MENU
          </button>
          <button 
            onClick={() => setViewMode('TABLES')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-black text-[11px] transition-all cursor-pointer ${viewMode === 'TABLES' ? 'bg-white dark:bg-slate-700 text-[#E11D2A] dark:text-red-400 shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'}`}
          >
            <Grid2X2 className="w-3 h-3" /> TABLES
          </button>
        </div>

        {/* Right: Cashier Badge, Deficit Warning & Theme Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">

          {rawInventory.some(i => (i.current_stock || 0) < 0) && (
            <div 
              className="flex items-center gap-1 px-2 py-1 bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 rounded-lg text-[10px] font-black animate-pulse"
              title={`Negative stock deficit in: ${rawInventory.filter(i => (i.current_stock || 0) < 0).map(i => `${i.name} (${Number(i.current_stock).toFixed(0)})`).join(', ')}`}
            >
              <AlertTriangle className="w-3 h-3 text-red-500" />
              <span>DEFICIT ({rawInventory.filter(i => (i.current_stock || 0) < 0).length})</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-100 dark:bg-slate-850 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-slate-900 dark:text-slate-100 font-black max-w-[85px] sm:max-w-[110px] truncate">
              {activeCashier?.name || "Cashier"}
            </span>
            <button
              onClick={() => lockRegister()}
              className="p-0.5 hover:bg-slate-200 dark:hover:bg-slate-750 rounded text-slate-500 hover:text-amber-500 transition-colors cursor-pointer"
              title="Lock Terminal"
            >
              <Lock className="w-3 h-3" />
            </button>
          </div>

          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-850 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 transition-colors flex items-center justify-center cursor-pointer border border-slate-200 dark:border-slate-700 shadow-2xs"
            title="Toggle Theme (Alt+T)"
          >
            {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-700" />}
          </button>
        </div>
      </header>

      {/* LEFTOVER SHIFT WARNING BANNER */}
      {leftoverShift && (
        <div className="bg-amber-500 text-slate-950 px-6 py-2.5 flex items-center justify-between font-black text-xs shadow-md border-b-2 border-amber-600 animate-in slide-in-from-top-2 z-20">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-slate-950" />
            <span>
              Yesterday&apos;s Shift was left open ({new Date(leftoverShift.opened_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}). Please perform the blind cash count to close it before opening today&apos;s Shift #1.
            </span>
          </div>
          <button 
            onClick={() => setIsZReportOpen(true)}
            className="bg-slate-950 text-white hover:bg-slate-800 px-3.5 py-1 rounded-lg text-xs font-black shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            Close Leftover Shift Now &rarr;
          </button>
        </div>
      )}

      {/* AMENDING BILL WARNING & STATUS BANNER */}
      {amendingBill && (
        <div className="bg-amber-500/15 border-b-2 border-amber-500/40 px-6 py-2.5 flex flex-wrap items-center justify-between font-bold text-xs shadow-sm text-amber-900 dark:text-amber-100 animate-in slide-in-from-top-1 z-20 gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
            </span>
            <div>
              <span className="font-black text-sm uppercase tracking-wide">
                Amending Order #{amendingBill.originalTokenNumber.toString().padStart(3, '0')}
              </span>
              <span className="text-xs ml-2 opacity-80">
                (Original Bill: Rs. {amendingBill.originalNetTotal.toFixed(0)} &bull; {amendingBill.originalPaymentMethod} &bull; {amendingBill.originalOrderType})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs bg-amber-500/20 px-3 py-1 rounded-lg border border-amber-500/30">
              Additional Balance Due: <span className="font-black text-amber-700 dark:text-amber-300">Rs. {additionalDue.toFixed(0)}</span>
            </div>
            <button
              onClick={cancelAmendingBill}
              className="bg-red-500/10 hover:bg-red-500 text-red-600 hover:text-white dark:text-red-400 text-xs font-black px-3 py-1 rounded-lg border border-red-500/30 transition-all active:scale-95 cursor-pointer"
            >
              Cancel Amendment
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <main className="w-[70%] flex flex-col border-r border-border bg-background">
          {viewMode === 'MENU' ? (
            <>
              {/* TOP BAR: SEARCH & VIEW MODE SWITCHER */}
              <div className="px-3 py-1.5 border-b border-border bg-card/60 flex items-center justify-between gap-2 sm:gap-3">
                {/* Search Input Bar */}
                <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-1 rounded-xl flex-1 max-w-md shadow-2xs">
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input 
                    type="text"
                    id="pos-menu-search"
                    name="menuSearch"
                    value={menuSearch}
                    onChange={e => setMenuSearch(e.target.value)}
                    placeholder="Search menu items... (e.g. zinger, banger, fries)"
                    className="w-full bg-transparent text-xs sm:text-sm font-bold text-slate-900 dark:text-slate-100 outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  />
                  {menuSearch && (
                    <button onClick={() => setMenuSearch('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* View Mode Toggle: List vs Grid */}
                <div className="flex items-center bg-slate-100 dark:bg-slate-850 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700 shrink-0 gap-0.5">
                  <button 
                    onClick={() => setMenuDisplayMode('LIST')}
                    className={`px-2.5 py-1 rounded-md font-black text-[11px] flex items-center gap-1 transition-all cursor-pointer ${
                      menuDisplayMode === 'LIST' 
                        ? 'bg-white dark:bg-slate-700 text-[#E11D2A] dark:text-red-400 shadow-2xs' 
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                    title="Compact List View"
                  >
                    <List className="w-3 h-3" /> List
                  </button>
                  <button 
                    onClick={() => setMenuDisplayMode('GRID')}
                    className={`px-2.5 py-1 rounded-md font-black text-[11px] flex items-center gap-1 transition-all cursor-pointer ${
                      menuDisplayMode === 'GRID' 
                        ? 'bg-white dark:bg-slate-700 text-[#E11D2A] dark:text-red-400 shadow-2xs' 
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                    title="Card Grid View"
                  >
                    <LayoutGrid className="w-3 h-3" /> Grid
                  </button>
                </div>
              </div>

              {/* CATEGORY FILTER PILLS (Horizontal Scroll with Item Counts) */}
              <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-1 border-b border-border bg-slate-50/80 dark:bg-slate-900/60 no-scrollbar">
                <button 
                  onClick={() => setActiveCategory('ALL')}
                  className={`px-2.5 py-1 rounded-lg font-black text-xs transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                    activeCategory === 'ALL'
                      ? 'bg-[#E11D2A] text-white shadow-xs'
                      : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-[#E11D2A] shadow-2xs'
                  }`}
                >
                  <span>ALL</span>
                  <span className={`text-[10px] px-1 py-0.2 rounded-full font-black ${
                    activeCategory === 'ALL' ? 'bg-white/25 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                  }`}>
                    {menuItems.length}
                  </span>
                </button>
                {categories.map(cat => {
                  const catCount = menuItems.filter(m => m.category_name === cat).length;
                  const isActive = activeCategory === cat;
                  return (
                    <button 
                      key={cat}
                      onClick={() => setActiveCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg font-black text-xs transition-all whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                        isActive 
                          ? 'bg-[#E11D2A] text-white shadow-xs' 
                          : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:border-[#E11D2A] shadow-2xs'
                      }`}
                    >
                      <span>{cat}</span>
                      <span className={`text-[10px] px-1 py-0.2 rounded-full font-black ${
                        isActive ? 'bg-white/25 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                      }`}>
                        {catCount}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* MENU ITEMS DISPLAY AREA */}
              <div className="flex-1 overflow-y-auto p-2 sm:p-3">
                {menuItems.length === 0 ? (
                    <div className="h-64 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-center p-4 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl m-2 bg-slate-50/50 dark:bg-slate-900/30">
                      <Utensils className="w-10 h-10 mb-2 text-slate-300 dark:text-slate-600 stroke-[1.5]" />
                      <p className="font-black text-sm text-slate-800 dark:text-slate-200">No Menu Items Created Yet</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm">
                        Open the Admin Menu Builder to create categories, food items, and deals.
                      </p>
                      <button 
                        onClick={() => openAppRoute('admin')} 
                        className="mt-3 px-3 py-1.5 rounded-lg bg-[#E11D2A] hover:bg-red-700 text-white font-black text-xs shadow-md transition-all cursor-pointer active:scale-95"
                      >
                        Open Admin Menu Builder &rarr;
                      </button>
                    </div>
                  ) : filteredMenuItems.length === 0 ? (
                    <div className="h-48 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-center p-4">
                      <Search className="w-8 h-8 mb-1.5 opacity-30" />
                      <p className="font-bold text-xs text-slate-700 dark:text-slate-300">No matching items found</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Try searching with a different term or select &quot;ALL&quot;</p>
                    </div>
                  ) : menuDisplayMode === 'LIST' ? (
                  /* LIST VIEW */
                  <div className="divide-y divide-border bg-card border border-border rounded-xl overflow-hidden shadow-2xs">
                    {filteredMenuItems.map(item => {
                      const stock = getStockInfo(item.id);
                      const isOutOfStock = stock.maxAvailable <= 0;
                      return (
                        <div 
                          key={item.id}
                          onClick={() => handleAddItemToCart(item)}
                          className={`p-2.5 sm:p-3 flex items-center justify-between gap-2.5 cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40 active:scale-[0.99] select-none ${
                            isOutOfStock ? 'opacity-50 grayscale hover:bg-red-50/20' : ''
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-black text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">{item.name}</span>
                              {stock.hasWarning && !isOutOfStock && (
                                <span className="text-[9px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-1 py-0.2 rounded uppercase">
                                  <AlertTriangle className="w-2.5 h-2.5 inline" /> Low Stock
                                </span>
                              )}
                              {isOutOfStock && (
                                <span className="text-[9px] font-black bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300 px-1 py-0.2 rounded uppercase">
                                  <Ban className="w-2.5 h-2.5 inline" /> Out of Stock
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[9px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.2 rounded">
                                {item.category_name}
                              </span>
                              {stock.maxAvailable < 999 && (
                                <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                  Available: {stock.maxAvailable}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-black text-xs sm:text-sm text-[#E11D2A] dark:text-red-400">
                              Rs. {item.price}
                            </span>
                            <button 
                              type="button"
                              className="w-7 h-7 rounded-lg bg-red-50 text-[#E11D2A] hover:bg-[#E11D2A] hover:text-white dark:bg-red-950/40 dark:text-red-300 flex items-center justify-center font-black transition-colors"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* GRID CARD VIEW - Compact & Fit for 1366x768 */
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-2.5">
                    {filteredMenuItems.map(item => {
                      const stock = getStockInfo(item.id);
                      const isOutOfStock = stock.maxAvailable <= 0;
                      return (
                        <button 
                          key={item.id}
                          onClick={() => handleAddItemToCart(item)}
                          className={`flex flex-col items-start justify-between p-2.5 sm:p-3 min-h-[82px] sm:min-h-[92px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl sm:rounded-2xl transition-all shadow-2xs hover:shadow-sm group relative text-left cursor-pointer ${
                            isOutOfStock ? 'opacity-50 grayscale hover:border-red-500' : 'hover:border-[#E11D2A] dark:hover:border-red-500 active:scale-[0.98]'
                          }`}
                        >
                          {stock.hasWarning && !isOutOfStock && <span className="absolute top-2 right-2 text-xs" title="Low Stock"><AlertTriangle className="w-3.5 h-3.5 text-amber-500" /></span>}
                          {isOutOfStock && <span className="absolute top-2 right-2 text-xs" title="Out of Stock"><Ban className="w-3.5 h-3.5 text-red-500" /></span>}
                          <div className="w-full min-w-0 pr-4">
                            <span className={`font-black text-xs sm:text-sm block leading-tight truncate transition-colors ${isOutOfStock ? 'text-red-500' : 'text-slate-900 dark:text-slate-100 group-hover:text-[#E11D2A] dark:group-hover:text-red-400'}`}>
                              {item.name}
                            </span>
                            <span className="text-[9px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-0.2 rounded mt-1 inline-block">
                              {item.category_name}
                            </span>
                          </div>
                          <span className="font-black text-xs sm:text-sm text-[#E11D2A] dark:text-red-400 mt-1">Rs. {item.price}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            // TABLE GRID VIEW
            <div className="flex-1 p-6 overflow-y-auto bg-slate-50 dark:bg-background">
              <h2 className="text-2xl font-black text-foreground mb-6">Dine-In Tables</h2>
              <div className="grid grid-cols-3 xl:grid-cols-5 gap-4">
                {Array.from({ length: 15 }, (_, i) => {
                  const tableNum = (i + 1).toString();
                  const existingTab = openTabs.find(t => t.table_number === tableNum);
                  const isOccupied = !!existingTab;

                  return (
                    <button
                      key={tableNum}
                      onClick={() => handleTableClick(tableNum)}
                      className={`flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all active:scale-95 ${
                        isOccupied 
                          ? 'bg-red-500/10 border-red-500 text-red-600 dark:text-red-400 shadow-sm' 
                          : 'bg-card border-border text-foreground hover:border-primary/50'
                      }`}
                    >
                      <span className="text-3xl font-black mb-1">T-{tableNum}</span>
                      <span className="text-sm font-bold uppercase tracking-wider">
                        {isOccupied ? `Rs. ${existingTab.net_total}` : 'VACANT'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Main POS Footer Bar with Teddops Engineering Branding */}
          <div className="px-3 py-1 border-t border-border bg-card/60 flex items-center justify-between text-[11px] text-mutedForeground select-none shrink-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-500 dark:text-slate-400">
                Menu: <strong className="text-foreground font-black">{menuItems.length}</strong>
              </span>
              <span className="text-slate-300 dark:text-slate-700">&bull;</span>
              <span className="hidden md:inline text-slate-500 dark:text-slate-400">
                <kbd className="px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono border border-slate-200 dark:border-slate-700">F2</kbd> Kitchen &bull; <kbd className="px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono border border-slate-200 dark:border-slate-700">Alt+T</kbd> Theme
              </span>
            </div>
            <TeddopsBranding variant="compact" />
          </div>
        </main>

        <aside className="w-[30%] flex flex-col bg-card relative">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-slate-100 dark:bg-slate-900 shrink-0">
            <div className="flex flex-col">
              <h2 className="font-black text-base text-foreground leading-tight">Current Order</h2>
              {activeTableNumber && (
                <span className="text-[10px] font-bold text-blue-600 bg-blue-100 dark:bg-blue-900/50 dark:text-blue-300 px-1.5 py-0.2 rounded uppercase w-max mt-0.5">
                  Table {activeTableNumber} {activeOrderId ? '(Active Tab)' : '(New Tab)'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {activeTableNumber && (
                <button 
                  onClick={() => {
                    const currentTable = usePosStore.getState().activeTableNumber;
                    if (currentTable) usePosStore.getState().parkCart(currentTable);
                    usePosStore.getState().restoreCart('WALKIN');
                  }}
                  className="bg-blue-100 text-blue-600 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors border border-blue-200 dark:border-blue-800"
                  title="Switch back to Walk-in Order"
                >
                  Walk-in
                </button>
              )}
              <button 
                onClick={() => { clearCart(); setActiveCartItemId(null); }} 
                className="p-1 text-mutedForeground hover:text-red-500 transition-colors"
                title="Clear current order"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2.5 sm:p-3 space-y-2">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-2 select-none">
                <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex items-center justify-center p-2 shadow-xs border border-slate-200 dark:border-slate-700">
                  <ShoppingBag className="w-5 h-5" />
                </div>
                <div>
                  <span className="font-black text-xs text-foreground uppercase tracking-wide">
                    Cart is Empty
                  </span>
                  <p className="text-[11px] text-mutedForeground mt-0.5">
                    No items added yet
                  </p>
                </div>
              </div>
            ) : (
              cart.map((item) => {
                const isActive = activeCartItemId === item.id;
                
                return (
                  <div key={item.id} className={`flex flex-col border rounded-lg shadow-sm overflow-hidden transition-all ${
                    item.is_original
                      ? 'border-amber-300/60 bg-amber-50/20 dark:border-amber-900/40 dark:bg-amber-950/10'
                      : item.is_sent 
                        ? 'border-border/50 bg-background/50 opacity-80' 
                        : 'border-blue-300 bg-blue-50/30 dark:border-blue-900 dark:bg-blue-900/10'
                  }`}>
                    
                    <div 
                      onClick={() => !item.is_sent && !item.is_original && setActiveCartItemId(isActive ? null : item.id!)}
                      className={`flex items-center justify-between p-3 ${
                        !item.is_sent && !item.is_original ? 'cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/40' : ''
                      } ${isActive ? 'bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700' : ''}`}
                    >
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">{item.item_name}</span>
                          {item.is_original ? (
                            <span className="text-[9px] font-black text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 px-1.5 py-0.5 rounded uppercase tracking-wider">
                              Original (Paid)
                            </span>
                          ) : item.is_sent ? (
                            <span className="text-[9px] font-bold text-green-600 bg-green-100 px-1 rounded uppercase tracking-wider">
                              Sent
                            </span>
                          ) : activeTableNumber ? (
                            <span className="text-[9px] font-black text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 border border-blue-300 dark:border-blue-700 px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse">
                              New Add-on
                            </span>
                          ) : amendingBill ? (
                            <span className="text-[9px] font-black text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 border border-blue-300 dark:border-blue-700 px-1.5 py-0.5 rounded uppercase tracking-wider">
                              New Add-on
                            </span>
                          ) : null}
                        </div>
                        {item.modifiers_json.length > 0 && (
                          <div className="flex flex-col mt-0.5">
                            {item.modifiers_json.map(mod => (
                              <span key={mod.modifier_id} className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                                + {mod.qty}x {mod.name} (Rs. {mod.price * mod.qty})
                              </span>
                            ))}
                          </div>
                        )}
                        {item.deal_swaps_json && item.deal_swaps_json.length > 0 && (
                          <div className="flex flex-col mt-1 space-y-0.5 border-l-2 border-amber-400/60 dark:border-amber-500/40 pl-2 py-0.5">
                            {item.deal_swaps_json.map((comp: any, cIdx: number) => (
                              <div key={cIdx} className="text-[10px] text-slate-600 dark:text-slate-400 font-medium">
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
                        <div className="flex items-center gap-3 mt-1">
                          {!item.is_sent && !item.is_original ? (
                            <div className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-200 dark:border-slate-700" onClick={(e) => e.stopPropagation()}>
                              <button onClick={() => updateQuantity(item.id!, -1)} className="w-6 h-6 flex items-center justify-center bg-white dark:bg-slate-900 rounded shadow-xs text-foreground hover:bg-red-50 hover:text-red-600 transition-colors border border-slate-200 dark:border-slate-700 font-bold">-</button>
                              <span className="text-sm font-black w-4 text-center">{item.quantity}</span>
                              <button onClick={() => updateQuantity(item.id!, 1)} className="w-6 h-6 flex items-center justify-center bg-white dark:bg-slate-900 rounded shadow-xs text-foreground hover:bg-green-50 hover:text-green-600 transition-colors border border-slate-200 dark:border-slate-700 font-bold">+</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                                Qty: {item.quantity}
                              </span>
                              {activeTableNumber && !item.is_original && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    usePosStore.getState().addToCart({
                                      menu_item_id: item.menu_item_id,
                                      item_name: item.item_name,
                                      unit_price: item.unit_price,
                                      quantity: 1
                                    });
                                    modal.toast.success(`Added +1 ${item.item_name} as unsent add-on.`);
                                  }}
                                  className="text-[10px] font-black bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 px-2 py-0.5 rounded transition-all cursor-pointer shadow-xs active:scale-95"
                                  title="Add another of this item as an add-on"
                                >
                                  +1 Add More
                                </button>
                              )}
                              {activeOrderId && item.is_sent && !item.is_original && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const ok = await modal.confirm({
                                      title: `Void ${item.item_name}?`,
                                      message: `Are you sure you want to void ${item.quantity}x ${item.item_name} from Table ${activeTableNumber}?\n\nThis will remove it from the bill and restock its ingredients.`,
                                      confirmText: "Void Item",
                                      isDanger: true
                                    });
                                    if (!ok) return;

                                    await restockOrderInventory([item], activeOrderId);
                                    usePosStore.getState().removeFromCart(item.id!);
                                    const updatedCart = usePosStore.getState().cart;
                                    const newSub = updatedCart.reduce((s, i) => s + i.total_price, 0);
                                    const existing = await db.orders.get(activeOrderId);
                                    if (existing) {
                                      const updated = { ...existing, items: updatedCart, subtotal: newSub, net_total: newSub, sync_status: 'PENDING' as const };
                                      await db.orders.put(updated);
                                      syncOfflineOrders();
                                      posBus.publish('ORDER_UPDATED', { orderId: activeOrderId, tokenNumber: existing.token_number });
                                    }
                                    modal.toast.success(`${item.item_name} voided from Table ${activeTableNumber}.`);
                                  }}
                                  className="text-[10px] font-black text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                                  title="Void this item and restock ingredients"
                                >
                                  Void
                                </button>
                              )}
                            </div>
                          )}
                          <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                            Rs. {item.unit_price + (item.modifiers_json?.reduce((sum, m) => sum + (m.price * m.qty), 0) || 0)}/ea
                          </span>
                          {!item.is_sent && !item.is_original && item.quantity > 1 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const newId = splitCartItem(item.id!);
                                if (newId) setActiveCartItemId(newId);
                              }}
                              className="ml-auto text-[11px] font-black bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 px-2 py-1 rounded-md transition-colors flex items-center gap-1 shadow-xs active:scale-95"
                              title="Split 1 item out so you can customize it independently"
                            >
                              <Scissors className="w-3.5 h-3.5" /> Split 1
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="font-black text-foreground">Rs. {item.total_price}</span>
                      </div>
                    </div>

                    {isActive && !item.is_sent && !item.is_original && (
                      <div className="p-3 bg-card flex flex-col gap-3 animate-in slide-in-from-top-2">
                        {item.quantity > 1 && (
                          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-2.5 rounded-lg flex items-center justify-between text-xs">
                            <div>
                              <p className="font-bold text-amber-800 dark:text-amber-200">Customizing group ({item.quantity}x {item.item_name})</p>
                              <p className="text-[10px] text-amber-700 dark:text-amber-300">Modifiers apply to all {item.quantity} burgers (@ Rs. {item.modifiers_json?.reduce((sum, m) => sum + (m.price * m.qty), 0) || 0}/ea).</p>
                            </div>
                            <button
                              onClick={() => {
                                const newId = splitCartItem(item.id!);
                                if (newId) setActiveCartItemId(newId);
                              }}
                              className="bg-amber-600 hover:bg-amber-700 text-white font-black px-2.5 py-1.5 rounded-md text-[11px] whitespace-nowrap shadow-sm active:scale-95 transition-all"
                            >
                              <Scissors className="w-3.5 h-3.5" /> Customize 1 Only
                            </button>
                          </div>
                        )}
                        {isDrinkOrRetailItem(item, rawCategories) || item.allows_modifiers === false ? (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-mutedForeground uppercase tracking-wider flex items-center gap-1.5">
                                {isDrinkOrRetailItem(item, rawCategories) ? '🥤 Retail Beverage / Product' : '🔒 Modifiers Disabled'}
                              </span>
                              <button onClick={() => removeFromCart(item.id!)} className="text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1">
                                <Trash2 className="w-3 h-3" /> Remove Item
                              </button>
                            </div>
                            <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs text-mutedForeground font-medium">
                              {isDrinkOrRetailItem(item, rawCategories)
                                ? "Retail beverages & packaged items do not take burger or kitchen add-ons."
                                : "Add-ons & modifiers are not enabled for this menu item."}
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-mutedForeground uppercase tracking-wider">Add Modifiers</span>
                              <button onClick={() => removeFromCart(item.id!)} className="text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1">
                                <Trash2 className="w-3 h-3" /> Remove Item
                              </button>
                            </div>
                            
                            <div className="flex flex-wrap gap-2">
                              {availableModifiers.map(mod => {
                                const currentMod = item.modifiers_json.find(m => m.modifier_id === mod.id);
                                return (
                                  <div key={mod.id} className="flex items-center justify-between border border-border rounded-lg px-2 py-1.5 bg-background flex-grow">
                                    <span className="text-xs font-medium text-foreground">{mod.name} <span className="text-mutedForeground">(+Rs.{mod.price})</span></span>
                                    <div className="flex items-center gap-2 ml-3">
                                      {currentMod && (
                                        <>
                                          <button onClick={() => removeModifier(item.id!, mod.id)} className="p-1 bg-muted rounded hover:bg-red-500/20 hover:text-red-500 transition-colors">
                                            <Minus className="w-3 h-3" />
                                          </button>
                                          <span className="text-xs font-bold w-3 text-center">{currentMod.qty}</span>
                                        </>
                                      )}
                                      <button onClick={() => addModifier(item.id!, mod)} className="p-1 bg-primary/10 text-primary rounded hover:bg-primary hover:text-primaryForeground transition-colors">
                                        <Plus className="w-3 h-3" />
                                      </button>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          <div className="p-4 border-t border-border bg-background space-y-3">
            {!isLaptop ? (
              <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-center space-y-1.5">
                <div className="flex items-center justify-center gap-2 text-xs font-black text-amber-800 dark:text-amber-200">
                  <Eye className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>VIEW ONLY — COUNTER LAPTOP EXCLUSIVE</span>
                </div>
                <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
                  POS orders, kitchen sends, and bill checkout operate exclusively on the counter laptop.
                </p>
              </div>
            ) : amendingBill ? (
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-bold text-mutedForeground">
                  <span>Original Bill Paid:</span>
                  <span>Rs. {amendingBill.originalNetTotal.toFixed(0)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-amber-700 dark:text-amber-300">
                  <span>Additional Balance Due:</span>
                  <span className="font-black">Rs. {additionalDue.toFixed(0)}</span>
                </div>
                <div className="flex justify-between text-xl font-black text-foreground pt-1 border-t border-border/50">
                  <span>New Grand Total:</span>
                  <span>Rs. {newGrandTotal.toFixed(0)}</span>
                </div>

                <button
                  disabled={additionalDue <= 0}
                  onClick={() => setIsCheckoutOpen(true)}
                  className="w-full py-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-black text-base tracking-wide shadow-md active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
                >
                  {additionalDue > 0 
                    ? `COLLECT EXTRA RS. ${additionalDue.toFixed(0)} & UPDATE BILL`
                    : 'SELECT ITEMS FROM MENU TO ADD'}
                </button>
              </div>
            ) : (
              <>
                <div className="flex justify-between text-lg sm:text-xl font-black text-foreground">
                  <span>Total</span>
                  <span>Rs. {netTotal.toFixed(0)}</span>
                </div>
                
                {activeTableNumber ? (
                  <div className="flex gap-2">
                    <button 
                      disabled={unsentCount === 0}
                      onClick={handleSendToKitchen}
                      className="flex-1 py-2.5 sm:py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xs sm:text-sm tracking-wide shadow-md active:scale-95 transition-all disabled:opacity-50"
                    >
                      {activeOrderId ? 'SEND ADD-ON' : 'SEND TO KITCHEN'}
                    </button>
                    <button 
                      disabled={cart.length === 0}
                      onClick={() => setIsCheckoutOpen(true)}
                      className="flex-1 py-2.5 sm:py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-black text-xs sm:text-sm tracking-wide shadow-md active:scale-95 transition-all disabled:opacity-50"
                    >
                      SETTLE BILL
                    </button>
                  </div>
                ) : (
                  <button 
                    disabled={cart.length === 0}
                    onClick={() => setIsCheckoutOpen(true)}
                    className="w-full py-2.5 sm:py-3 rounded-xl bg-primary hover:opacity-90 text-primaryForeground font-black text-sm sm:text-base tracking-wide shadow-md active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100"
                  >
                    CHECKOUT (TAKEAWAY)
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
      </div>

      {/* 4-Digit Cashier Lockscreen Modal */}
      <CashierPinModal
        isOpen={isRegisterLocked && !showWizard}
        onSuccess={() => {}}
      />

      {isCheckoutOpen && <CheckoutModal onClose={() => setIsCheckoutOpen(false)} />}
      {isSpoilageOpen && <SpoilageModal onClose={() => setIsSpoilageOpen(false)} />}
      {isZReportOpen && <ZReportModal onClose={() => setIsZReportOpen(false)} />}
      {isAuditModalOpen && <CashierOrderAuditModal isOpen={isAuditModalOpen} onClose={() => setIsAuditModalOpen(false)} />}
      {isDiagnosticsOpen && <SyncDiagnosticsModal isOpen={isDiagnosticsOpen} onClose={() => setIsDiagnosticsOpen(false)} />}
      
      {/* Cropped Thermal Preview for Kitchen Token (KOT) */}
      {kotPreviewData && (
        <ThermalReceiptPreviewModal
          isOpen={true}
          onClose={() => setKotPreviewData(null)}
          order={kotPreviewData.order}
          items={kotPreviewData.items}
          addonItems={kotPreviewData.addonItems}
          initialTab="KOT"
          onPrintCompleted={() => setKotPreviewData(null)}
        />
      )}

      {/* Deal Customizer Modal */}
      {isDealCustomizerOpen && customizingDealItem && (
        <DealCustomizerModal
          isOpen={isDealCustomizerOpen}
          onClose={() => {
            setIsDealCustomizerOpen(false);
            setCustomizingDealItem(null);
          }}
          dealItem={customizingDealItem}
          dealComponents={dealComponents}
          allMenuItems={menuItems}
          categories={rawCategories}
          availableModifiers={availableModifiers}
          onConfirm={handleConfirmCustomizedDeal}
        />
      )}
    </div>
  );
}
























