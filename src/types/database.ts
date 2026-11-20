export type OrderType = 'TAKEAWAY' | 'DINE_IN' | 'FOODPANDA';
export type PaymentMethod = 'CASH' | 'JAZZCASH' | 'EASYPAISA' | 'FOODPANDA_RECEIVABLE' | 'PENDING';
export type OrderStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'OPEN_TAB';

export interface Category {
  id: string;
  name: string;
  sort_order: number;
}

export interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  price: number;
  is_deal: boolean;
  is_available: boolean;
}

export interface Modifier {
  id: string;
  name: string;
  price: number;
  inventory_item_id?: string;
  quantity_deducted: number;
}

export interface OrderItemModifier {
  modifier_id: string;
  name: string;
  price: number;
  qty: number;
}

export interface OrderItemDealSwap {
  original_item: string;
  swapped_with: string;
}

export interface OrderItem {
  id?: string;
  order_id?: string;
  menu_item_id: string;
  item_name: string;
  unit_price: number;
  quantity: number;
  total_price: number;
  modifiers_json: OrderItemModifier[];
  deal_swaps_json?: OrderItemDealSwap[];
  is_sent?: boolean;
  cogs_total?: number;
}

export interface Order {
  id: string; // UUID v4
  token_number: number;
  shift_id?: string;
  order_type: OrderType;
  payment_method: PaymentMethod;
  table_number?: string;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  net_total: number;
  foodpanda_commission_pct: number;
  fp_payout_status?: 'PENDING_PAYOUT' | 'RECEIVED' | 'SETTLED' | 'VOIDED' | 'NOT_APPLICABLE';
  created_at: string;
  items: OrderItem[]; // For local Zustand state
}

