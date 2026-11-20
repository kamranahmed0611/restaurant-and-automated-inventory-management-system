import Dexie, { Table } from 'dexie';
import { Order as BaseOrder } from '@/types/database';

export interface LocalOrder extends BaseOrder {
  sync_status: 'PENDING' | 'SYNCED';
}

export interface LocalRawInventory {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  cost_per_unit?: number;
  min_stock_alert?: number;
  sync_status?: 'PENDING' | 'SYNCED';
  is_overhead?: boolean;
  bulk_unit?: string;
  conversion_rate?: number;
  bulk_cost?: number;
}

export interface LocalRecipe {
  id: string;
  menu_item_id: string;
  inventory_item_id: string;
  quantity_deducted: number;
  sync_status?: 'PENDING' | 'SYNCED';
}

export interface LocalDealComponent {
  id: string;
  deal_id: string;
  menu_item_id?: string | null;
  category_id?: string | null;
  slot_title?: string | null;
  quantity: number;
}

export interface LocalModifier {
  id: string;
  name: string;
  price: number;
  inventory_item_id?: string;
  quantity_deducted: number;
  category?: string;
  is_active?: boolean;
}

export interface LocalInventoryLog {
  id: string;
  order_id?: string;
  inventory_item_id: string;
  change_qty: number;
  change_type?: string;
  reason: string;
  created_at: string;
  sync_status: 'PENDING' | 'SYNCED';
}

export interface LocalMenuItem {
  id: string;
  category_id?: string | null;
  category_name: string;
  name: string;
  price: number;
  cost_price?: number;
  overhead_cost?: number;
  allows_modifiers?: boolean;
  is_deal?: boolean;
  is_available?: boolean;
  sync_status?: 'PENDING' | 'SYNCED';
}

export interface LocalExpense {
  id: string;
  category: string;
  amount: number;
  description: string;
  logged_by: string;
  shift_id?: string | null;
  created_at: string;
  sync_status?: 'PENDING' | 'SYNCED';
}

export interface LocalCategory {
  id: string;
  name: string;
  sort_order: number;
}

export interface LocalCashier {
  id: string;
  name: string;
  pin?: string;
  pin_hash: string;
  role: 'CASHIER' | 'MANAGER' | 'ADMIN';
  created_at?: string;
  sync_status?: 'PENDING' | 'SYNCED';
}

export interface LocalShift {
  id: string;
  cashier_id?: string | null;
  cashier_name?: string | null;
  opened_at: string;
  closed_at?: string | null;
  starting_cash: number;
  closing_cash?: number | null;
  actual_cash?: number | null;
  expected_cash?: number | null;
  status: 'OPEN' | 'CLOSED';
  notes?: string | null;
  sync_status: 'PENDING' | 'SYNCED';
}

export interface LocalDeletedRecord {
  id: string;
  table_name: string;
  record_id: string;
  created_at: string;
  sync_status: 'PENDING' | 'SYNCED';
}

export class PosDatabase extends Dexie {
  orders!: Table<LocalOrder, string>;
  raw_inventory!: Table<LocalRawInventory, string>;
  recipes!: Table<LocalRecipe, string>;
  deal_components!: Table<LocalDealComponent, string>;
  modifiers!: Table<LocalModifier, string>;
  inventory_logs!: Table<LocalInventoryLog, string>;
  menu_items!: Table<LocalMenuItem, string>;
  categories!: Table<LocalCategory, string>;
  cashiers!: Table<LocalCashier, string>;
  shifts!: Table<LocalShift, string>;
  expenses!: Table<LocalExpense, string>;
  deleted_records!: Table<LocalDeletedRecord, string>;

  constructor() {
    super('MuchachosPosDB');
    this.version(2).stores({
      orders: 'id, token_number, status, created_at, order_type, payment_method, sync_status'
    });
    this.version(3).stores({
      orders: 'id, token_number, status, created_at, order_type, payment_method, sync_status',
      raw_inventory: 'id, name, current_stock, unit',
      recipes: 'id, menu_item_id, inventory_item_id',
      deal_components: 'id, deal_id, menu_item_id',
      modifiers: 'id, name, inventory_item_id',
      inventory_logs: 'id, order_id, inventory_item_id, sync_status, created_at',
      menu_items: 'id, category_name, name',
      categories: 'id, name, sort_order'
    });
    this.version(4).stores({
      deal_components: 'id, deal_id, menu_item_id, category_id'
    });
    this.version(5).stores({
      cashiers: 'id, name, role'
    });
    this.version(6).stores({
      orders: 'id, token_number, status, created_at, order_type, payment_method, sync_status, shift_id',
      raw_inventory: 'id, name, current_stock, unit',
      recipes: 'id, menu_item_id, inventory_item_id',
      deal_components: 'id, deal_id, menu_item_id, category_id',
      modifiers: 'id, name, inventory_item_id',
      inventory_logs: 'id, order_id, inventory_item_id, sync_status, created_at',
      menu_items: 'id, category_id, category_name, name, is_deal',
      categories: 'id, name, sort_order',
      cashiers: 'id, name, role',
      shifts: 'id, status, opened_at, sync_status'
    });
    this.version(7).stores({
      orders: 'id, token_number, status, created_at, order_type, payment_method, sync_status, shift_id',
      raw_inventory: 'id, name, current_stock, unit',
      recipes: 'id, menu_item_id, inventory_item_id',
      deal_components: 'id, deal_id, menu_item_id, category_id',
      modifiers: 'id, name, inventory_item_id',
      inventory_logs: 'id, order_id, inventory_item_id, sync_status, created_at',
      menu_items: 'id, category_id, category_name, name, is_deal, cost_price',
      categories: 'id, name, sort_order',
      cashiers: 'id, name, role',
      shifts: 'id, status, opened_at, sync_status',
      expenses: 'id, category, amount, created_at, sync_status'
    });
    this.version(8).stores({
      orders: 'id, token_number, status, created_at, order_type, payment_method, sync_status, shift_id',
      raw_inventory: 'id, name, current_stock, unit, sync_status',
      recipes: 'id, menu_item_id, inventory_item_id, sync_status',
      deal_components: 'id, deal_id, menu_item_id, category_id',
      modifiers: 'id, name, inventory_item_id',
      inventory_logs: 'id, order_id, inventory_item_id, sync_status, created_at',
      menu_items: 'id, category_id, category_name, name, is_deal, cost_price, sync_status',
      categories: 'id, name, sort_order, sync_status',
      cashiers: 'id, name, role',
      shifts: 'id, status, opened_at, sync_status',
      expenses: 'id, category, amount, created_at, sync_status'
    });
    this.version(9).stores({
      orders: 'id, token_number, status, created_at, order_type, payment_method, sync_status, shift_id',
      raw_inventory: 'id, name, current_stock, unit, sync_status',
      recipes: 'id, menu_item_id, inventory_item_id, sync_status',
      deal_components: 'id, deal_id, menu_item_id, category_id',
      modifiers: 'id, name, inventory_item_id',
      inventory_logs: 'id, order_id, inventory_item_id, sync_status, created_at',
      menu_items: 'id, category_id, category_name, name, is_deal, cost_price, sync_status',
      categories: 'id, name, sort_order, sync_status',
      cashiers: 'id, name, role',
      shifts: 'id, status, opened_at, sync_status',
      expenses: 'id, category, amount, created_at, sync_status',
      deleted_records: 'id, table_name, record_id, created_at, sync_status'
    });
  }
}

export const db = new PosDatabase();

export async function getNextTokenNumber(): Promise<number> {
  const localToday = new Date().toLocaleDateString('en-CA');
  const allOrders = await db.orders.toArray();
  const todaysOrders = allOrders.filter(o => {
    if (!o.created_at) return false;
    try {
      return new Date(o.created_at).toLocaleDateString('en-CA') === localToday;
    } catch {
      return false;
    }
  });
    
  if (todaysOrders.length === 0) return 1;
  
  const maxToken = Math.max(...todaysOrders.map(o => o.token_number || 0), 0);
  return maxToken + 1;
}
