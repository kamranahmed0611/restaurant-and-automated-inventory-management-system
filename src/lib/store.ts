import { create } from 'zustand';

export interface Modifier {
  modifier_id: string;
  name: string;
  price: number;
  qty: number;
}

export interface CartItem {
  id?: string;
  menu_item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  modifiers_json: Modifier[];
  deal_swaps_json?: any[];
  is_sent?: boolean; // For dine-in add-ons
  is_original?: boolean; // For bill amendment
  allows_modifiers?: boolean;
}

export interface BillAmendment {
  originalOrderId: string;
  originalTokenNumber: number;
  originalNetTotal: number;
  originalPaymentMethod: string;
  originalOrderType: string;
  originalItems: CartItem[];
}

export interface CashierSession {
  id: string;
  name: string;
  role: 'CASHIER' | 'MANAGER' | 'ADMIN';
}

// Rehydrate cashier session from localStorage on app startup
// This prevents the cashier from re-entering PIN on every browser refresh
function getPersistedCashier(): CashierSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('muchachos_active_cashier');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.id && parsed.name && parsed.role) {
        return parsed as CashierSession;
      }
    }
  } catch {}
  return null;
}

interface PosState {
  cart: CartItem[];
  subtotal: number;
  netTotal: number;
  activeOrderId: string | null;
  activeTableNumber: string | null;
  activeShiftId: string | null;
  amendingBill: BillAmendment | null;
  syncError: string | null;
  setSyncError: (error: string | null) => void;
  isSyncingOrders: boolean;
  setIsSyncingOrders: (isSyncing: boolean) => void;

  // Cashier Session & Terminal Lock State
  activeCashier: CashierSession | null;
  isRegisterLocked: boolean;
  unlockRegister: (cashier: CashierSession) => void;
  lockRegister: () => void;
  
  // Actions
  addToCart: (item: Omit<CartItem, 'total_price' | 'modifiers_json'> & { modifiers_json?: Modifier[]; total_price?: number }) => void;
  removeFromCart: (id: string) => void;
  updateQuantity: (id: string, delta: number) => void;
  splitCartItem: (id: string) => string | null;
  splitAllCartItems: (id: string) => void;
  clearCart: () => void;
  addModifier: (cartItemId: string, modifier: { id: string, name: string, price: number }) => void;
  removeModifier: (cartItemId: string, modifierId: string) => void;
  
  // Dine-In & Bill Amendment Specific
  setActiveOrder: (orderId: string, tableNumber: string, items: CartItem[]) => void;
  markCartAsSent: () => void;
  setActiveShift: (id: string | null) => void;
  startAmendingBill: (bill: BillAmendment) => void;
  cancelAmendingBill: () => void;

  parkedCarts: Record<string, { cart: CartItem[], activeOrderId: string | null }>;
  parkCart: (key: string) => void;
  restoreCart: (key: string) => void;
  clearParkedCart: (key: string) => void;
}

// Rehydrate once at module load
const _persistedCashier = getPersistedCashier();

export const usePosStore = create<PosState>((set) => ({
  cart: [],
  subtotal: 0,
  netTotal: 0,
  activeOrderId: null,
  activeTableNumber: null,
  activeShiftId: null,
  amendingBill: null,
  syncError: null,
  setSyncError: (error) => set({ syncError: error }),
  isSyncingOrders: false,
  setIsSyncingOrders: (isSyncing) => set({ isSyncingOrders: isSyncing }),

  // Auto-rehydrate from localStorage: cashier stays unlocked across page refreshes
  activeCashier: _persistedCashier,
  isRegisterLocked: _persistedCashier === null,
  unlockRegister: (cashier) => {
    try {
      localStorage.setItem('muchachos_active_cashier', JSON.stringify(cashier));
    } catch {}
    set({ activeCashier: cashier, isRegisterLocked: false });
  },
  lockRegister: () => {
    try {
      localStorage.removeItem('muchachos_active_cashier');
    } catch {}
    set({ activeCashier: null, isRegisterLocked: true });
  },

  addToCart: (item) => set((state) => {
    const itemSwapsStr = JSON.stringify(item.deal_swaps_json || []);
    const itemMods = (item as any).modifiers_json || [];
    const itemModsStr = JSON.stringify(itemMods);

    // Only merge if both items are completely uncustomized OR have the exact same swaps and modifiers
    const existingIndex = state.cart.findIndex(i => {
      if (i.menu_item_id !== item.menu_item_id || i.is_sent) return false;
      const iSwapsStr = JSON.stringify(i.deal_swaps_json || []);
      const iModsStr = JSON.stringify(i.modifiers_json || []);
      return iSwapsStr === itemSwapsStr && iModsStr === itemModsStr;
    });

    if (existingIndex > -1) {
      const newCart = [...state.cart];
      const existing = newCart[existingIndex];
      const newQty = existing.quantity + item.quantity;
      newCart[existingIndex] = {
        ...existing,
        quantity: newQty,
        total_price: existing.unit_price * newQty
      };
      const newTotal = newCart.reduce((sum, i) => sum + i.total_price, 0);
      return { cart: newCart, subtotal: newTotal, netTotal: newTotal };
    }

    const newItem: CartItem = {
      ...item,
      id: crypto.randomUUID(),
      unit_price: item.unit_price,
      total_price: item.total_price !== undefined ? item.total_price : item.unit_price * item.quantity,
      modifiers_json: itemMods,
      deal_swaps_json: item.deal_swaps_json || [],
      is_sent: false,
      allows_modifiers: item.allows_modifiers !== false
    };
    const newCart = [...state.cart, newItem];
    const newTotal = newCart.reduce((sum, i) => sum + i.total_price, 0);
    return { cart: newCart, subtotal: newTotal, netTotal: newTotal };
  }),

  updateQuantity: (id, delta) => set((state) => {
    const target = state.cart.find(i => i.id === id);
    if (target?.is_original) return state;

    const newCart = state.cart.map(item => {
      if (item.id === id) {
        const newQty = Math.max(1, item.quantity + delta);
        const modsPerUnit = (item.modifiers_json || []).reduce((sum, m) => sum + (m.price * m.qty), 0);
        return { 
          ...item, 
          quantity: newQty, 
          total_price: (item.unit_price + modsPerUnit) * newQty 
        };
      }
      return item;
    });
    const newTotal = newCart.reduce((sum, i) => sum + i.total_price, 0);
    return { cart: newCart, subtotal: newTotal, netTotal: newTotal };
  }),

  splitCartItem: (id) => {
    let newCreatedId: string | null = null;
    set((state) => {
      const itemIndex = state.cart.findIndex(i => i.id === id);
      if (itemIndex === -1) return state;
      const item = state.cart[itemIndex];
      if (item.is_original || item.quantity <= 1) return state;

      const modsPerUnit = (item.modifiers_json || []).reduce((sum, m) => sum + (m.price * m.qty), 0);
      const updatedExisting: CartItem = {
        ...item,
        quantity: item.quantity - 1,
        total_price: (item.unit_price + modsPerUnit) * (item.quantity - 1)
      };

      newCreatedId = crypto.randomUUID();
      const newSingleItem: CartItem = {
        ...item,
        id: newCreatedId,
        quantity: 1,
        total_price: item.unit_price, // clean single item ready for separate customization
        modifiers_json: [],
        is_sent: false
      };

      const newCart = [...state.cart];
      newCart.splice(itemIndex + 1, 0, newSingleItem);
      newCart[itemIndex] = updatedExisting;
      const newTotal = newCart.reduce((sum, i) => sum + i.total_price, 0);
      return { cart: newCart, subtotal: newTotal, netTotal: newTotal };
    });
    return newCreatedId;
  },

  splitAllCartItems: (id) => set((state) => {
    const itemIndex = state.cart.findIndex(i => i.id === id);
    if (itemIndex === -1) return state;
    const item = state.cart[itemIndex];
    if (item.quantity <= 1) return state;

    const singles: CartItem[] = [];
    const modsPerUnit = (item.modifiers_json || []).reduce((sum, m) => sum + (m.price * m.qty), 0);
    for (let k = 0; k < item.quantity; k++) {
      singles.push({
        ...item,
        id: crypto.randomUUID(),
        quantity: 1,
        total_price: item.unit_price + modsPerUnit,
        modifiers_json: [...item.modifiers_json.map(m => ({ ...m }))],
        is_sent: item.is_sent || false
      });
    }

    const newCart = [...state.cart];
    newCart.splice(itemIndex, 1, ...singles);
    const newTotal = newCart.reduce((sum, i) => sum + i.total_price, 0);
    return { cart: newCart, subtotal: newTotal, netTotal: newTotal };
  }),

  removeFromCart: (id) => set((state) => {
    const target = state.cart.find(item => item.id === id);
    if (target?.is_original) return state;
    const newCart = state.cart.filter(item => item.id !== id);
    const newTotal = newCart.reduce((sum, i) => sum + i.total_price, 0);
    return { cart: newCart, subtotal: newTotal, netTotal: newTotal };
  }),

  clearCart: () => set({ cart: [], subtotal: 0, netTotal: 0, activeOrderId: null, activeTableNumber: null, amendingBill: null }),

  addModifier: (cartItemId, mod) => set((state) => {
    const target = state.cart.find(i => i.id === cartItemId);
    if (target?.is_original) return state;
    const newCart = state.cart.map(item => {
      if (item.id === cartItemId) {
        const existingMod = item.modifiers_json.find(m => m.modifier_id === mod.id);
        let newMods;
        if (existingMod) {
          newMods = item.modifiers_json.map(m => 
            m.modifier_id === mod.id ? { ...m, qty: m.qty + 1 } : m
          );
        } else {
          newMods = [...item.modifiers_json, { modifier_id: mod.id, name: mod.name, price: mod.price, qty: 1 }];
        }
        
        const modsPerUnit = newMods.reduce((sum, m) => sum + (m.price * m.qty), 0);
        return {
          ...item,
          modifiers_json: newMods,
          total_price: (item.unit_price + modsPerUnit) * item.quantity
        };
      }
      return item;
    });
    const newTotal = newCart.reduce((sum, i) => sum + i.total_price, 0);
    return { cart: newCart, subtotal: newTotal, netTotal: newTotal };
  }),

  removeModifier: (cartItemId, modId) => set((state) => {
    const newCart = state.cart.map(item => {
      if (item.id === cartItemId) {
        const existingMod = item.modifiers_json.find(m => m.modifier_id === modId);
        if (!existingMod) return item;

        let newMods;
        if (existingMod.qty > 1) {
          newMods = item.modifiers_json.map(m => 
            m.modifier_id === modId ? { ...m, qty: m.qty - 1 } : m
          );
        } else {
          newMods = item.modifiers_json.filter(m => m.modifier_id !== modId);
        }
        
        const modsPerUnit = newMods.reduce((sum, m) => sum + (m.price * m.qty), 0);
        return {
          ...item,
          modifiers_json: newMods,
          total_price: (item.unit_price + modsPerUnit) * item.quantity
        };
      }
      return item;
    });
    const newTotal = newCart.reduce((sum, i) => sum + i.total_price, 0);
    return { cart: newCart, subtotal: newTotal, netTotal: newTotal };
  }),

  setActiveOrder: (orderId, tableNumber, items) => set(() => {
    // Load existing order into cart. Mark all existing items as 'sent'.
    const mappedItems = items.map(i => ({ ...i, is_sent: true }));
    const newTotal = mappedItems.reduce((sum, i) => sum + i.total_price, 0);
    return { 
      cart: mappedItems, 
      subtotal: newTotal, 
      netTotal: newTotal,
      activeOrderId: orderId,
      activeTableNumber: tableNumber
    };
  }),

  markCartAsSent: () => set((state) => ({ cart: state.cart.map(i => ({ ...i, is_sent: true })) })),
  setActiveShift: (id) => set({ activeShiftId: id }),

  startAmendingBill: (bill) => set(() => {
    const mapped = bill.originalItems.map(i => ({ ...i, is_sent: true, is_original: true }));
    const total = mapped.reduce((sum, i) => sum + i.total_price, 0);
    return {
      cart: mapped,
      subtotal: total,
      netTotal: total,
      activeOrderId: bill.originalOrderId,
      activeTableNumber: null,
      amendingBill: bill
    };
  }),

  cancelAmendingBill: () => set({
    cart: [],
    subtotal: 0,
    netTotal: 0,
    activeOrderId: null,
    activeTableNumber: null,
    amendingBill: null
  }),

  parkedCarts: {},
  parkCart: (key) => set((state) => {
    if (state.cart.length > 0) {
      return { parkedCarts: { ...state.parkedCarts, [key]: { cart: [...state.cart], activeOrderId: state.activeOrderId } } };
    }
    const newParked = { ...state.parkedCarts };
    delete newParked[key];
    return { parkedCarts: newParked };
  }),
  restoreCart: (key) => set((state) => {
    const target = state.parkedCarts[key];
    if (!target) {
      return {
        cart: [],
        subtotal: 0,
        netTotal: 0,
        activeOrderId: null,
        activeTableNumber: key === 'WALKIN' ? null : key,
        amendingBill: null
      };
    }
    const total = target.cart.reduce((sum, i) => sum + i.total_price, 0);
    return {
      cart: [...target.cart],
      subtotal: total,
      netTotal: total,
      activeOrderId: target.activeOrderId,
      activeTableNumber: key === 'WALKIN' ? null : key,
      amendingBill: null
    };
  }),
  clearParkedCart: (key) => set((state) => {
    const updated = { ...state.parkedCarts };
    delete updated[key];
    return { parkedCarts: updated };
  })
}));




