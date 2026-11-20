import { db } from './db';
import { supabase } from './supabase';
import { usePosStore } from './store';
import { calculateItemCogs } from './inventory-service';
import { posBus } from './broadcast-bus';
import { isLaptopWriter } from './device-mode';

let isSyncingOrders = false;
let isSyncingDownstream = false;
let backgroundSyncInterval: ReturnType<typeof setInterval> | null = null;

export interface SyncDiagnosticDetails {
  pendingOrders: number;
  pendingShifts: number;
  pendingInventory: number;
  pendingMenuItems: number;
  pendingExpenses: number;
  pendingRecipes: number;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastError: {
    table: string;
    code?: string;
    message: string;
    details?: string;
    orderId?: string;
    timestamp: string;
  } | null;
  isOnline: boolean;
  circuitBreakerActive: boolean;
  explicitOffline: boolean;
}

let lastSyncAttemptAt: string | null = null;
let lastSyncSuccessAt: string | null = null;
let lastSyncErrorRecord: {
  table: string;
  code?: string;
  message: string;
  details?: string;
  orderId?: string;
  timestamp: string;
} | null = null;

export function recordSyncError(table: string, code?: string, message?: string, details?: string, orderId?: string) {
  lastSyncErrorRecord = {
    table,
    code: code || 'UNKNOWN',
    message: message || 'Failed to sync record',
    details: details || '',
    orderId,
    timestamp: new Date().toISOString()
  };
  posBus.publish('DIAGNOSTICS_REFRESH', {});
}

export function recordSyncSuccess() {
  lastSyncSuccessAt = new Date().toISOString();
  lastSyncErrorRecord = null;
  posBus.publish('DIAGNOSTICS_REFRESH', {});
}

export async function getSyncDiagnostics(): Promise<SyncDiagnosticDetails> {
  let orders = 0, shifts = 0, inv = 0, menu = 0, expenses = 0, recipes = 0;
  try {
    [orders, shifts, inv, menu, expenses, recipes] = await Promise.all([
      db.orders.where('sync_status').equals('PENDING').count(),
      db.shifts.where('sync_status').equals('PENDING').count(),
      db.raw_inventory.where('sync_status').equals('PENDING').count(),
      db.menu_items.where('sync_status').equals('PENDING').count(),
      db.expenses.where('sync_status').equals('PENDING').count(),
      db.recipes.where('sync_status').equals('PENDING').count()
    ]);
  } catch {}

  return {
    pendingOrders: orders,
    pendingShifts: shifts,
    pendingInventory: inv,
    pendingMenuItems: menu,
    pendingExpenses: expenses,
    pendingRecipes: recipes,
    lastAttemptAt: lastSyncAttemptAt,
    lastSuccessAt: lastSyncSuccessAt,
    lastError: lastSyncErrorRecord,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : false,
    circuitBreakerActive: isCircuitBreakerTripped(),
    explicitOffline: isExplicitOffline()
  };
}

function isValidUuid(val?: string): boolean {
  return typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
}

export function withTimeout<T = any>(promise: any, ms = 6000, errorMsg = 'Network timeout'): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorMsg)), ms);
    Promise.resolve(promise)
      .then(res => { clearTimeout(timer); resolve(res); })
      .catch(err => { clearTimeout(timer); reject(err); });
  });
}

/**
 * Executes a Supabase operation with automatic token refresh & retry on 401/expired JWT.
 */
export async function withAuthRetry<T>(operation: () => Promise<{ data?: T; error: any }>): Promise<{ data?: T; error: any }> {
  let result = await operation();
  if (result.error) {
    const errMsg = String(result.error.message || result.error.details || '').toLowerCase();
    const isAuthError = 
      result.error.status === 401 || 
      result.error.code === 'PGRST301' || 
      errMsg.includes('jwt') || 
      errMsg.includes('token') || 
      errMsg.includes('unauthorized') || 
      errMsg.includes('expired');

    if (isAuthError) {
      console.warn('[SyncEngine] Auth failure (401/expired) detected mid-push. Attempting session refresh...', result.error);
      let sessionRestored = false;

      // 1. First attempt: standard refresh token exchange
      try {
        const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
        if (refreshData?.session && !refreshError) {
          console.log('[SyncEngine] Session refreshed successfully.');
          sessionRestored = true;
        }
      } catch (refreshEx) {
        console.warn('[SyncEngine] Standard session refresh failed:', refreshEx);
      }

      // 2. Second attempt: dead refresh token recovery via Electron safeStorage credentials
      if (!sessionRestored && typeof window !== 'undefined' && (window as any).electronAPI?.getTerminalCredentials) {
        try {
          const creds = await (window as any).electronAPI.getTerminalCredentials();
          if (creds?.email && creds?.password) {
            console.log('[SyncEngine] Dead refresh token: Re-authenticating terminal with safeStorage hardware credentials...');
            const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({
              email: creds.email,
              password: creds.password,
            });
            if (loginData?.session && !loginError) {
              console.log('[SyncEngine] Terminal re-authentication succeeded!');
              sessionRestored = true;
            }
          }
        } catch (credErr) {
          console.error('[SyncEngine] Terminal credential re-login failed:', credErr);
        }
      }

      // Retry original operation if session was restored
      if (sessionRestored) {
        result = await operation();
      }
    }
  }
  return result;
}

// ─────────────────────────────────────────────
// CIRCUIT BREAKER & REACHABILITY PROBE
// ─────────────────────────────────────────────

let lastNetworkFailureTime = 0;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;

export function isCircuitBreakerTripped(): boolean {
  return Date.now() - lastNetworkFailureTime < CIRCUIT_BREAKER_COOLDOWN_MS;
}

export function resetCircuitBreaker(): void {
  lastNetworkFailureTime = 0;
}

export async function checkConnectivity(): Promise<boolean> {
  if (typeof window === 'undefined' || !navigator.onLine || isExplicitOffline()) {
    return false;
  }
  if (isCircuitBreakerTripped()) {
    return false;
  }
  // Fast 1500ms lightweight probe to check true internet reachability before initiating heavy sync
  try {
    const probe = supabase.from('system_settings').select('id').limit(1).maybeSingle();
    await withTimeout(probe, 2000, 'Connectivity probe timeout');
    return true;
  } catch {
    lastNetworkFailureTime = Date.now();
    return false;
  }
}

// ─────────────────────────────────────────────
// UPSTREAM: Local Orders, Shifts & Inventory → Supabase
// ─────────────────────────────────────────────

export async function syncOfflineOrders() {
  if (typeof window === 'undefined' || !navigator.onLine || isExplicitOffline()) {
    usePosStore.getState().setIsSyncingOrders(false);
    return;
  }
  
  if (isSyncingOrders) return;

  const isReachable = await checkConnectivity();
  if (!isReachable) {
    usePosStore.getState().setIsSyncingOrders(false);
    return;
  }

  isSyncingOrders = true;
  usePosStore.getState().setIsSyncingOrders(true);

  try {
    // 1. CRITICAL: Sync pending shifts FIRST so foreign key constraints in Supabase are satisfied
    await syncOfflineShifts();

    // 2. Cross-tab mutex lock using Web Locks API to prevent multiple browser tabs from syncing concurrently
    if (typeof navigator !== 'undefined' && 'locks' in navigator && (navigator as any).locks?.request) {
      await (navigator as any).locks.request('muchachos_sync_orders_lock', { ifAvailable: true }, async (lock: any) => {
        if (!lock) return; // Another tab is already performing synchronization
        await processSyncPendingOrders();
      });
    } else {
      await processSyncPendingOrders();
    }
  } catch (error) {
    lastNetworkFailureTime = Date.now();
    console.error('Sync engine error:', error);
  } finally {
    isSyncingOrders = false;
    usePosStore.getState().setIsSyncingOrders(false);
  }

  // 3. Sync pending deletions, inventory deductions, expenses, offline menu items, raw inventory, recipes, modifiers, deal components & categories
  if (!isCircuitBreakerTripped()) {
    await syncOfflineDeletions();
    await syncOfflineInventoryLogs();
    await syncOfflineExpenses();
    await syncOfflineMenuItems();
    await syncOfflineRawInventory();
    await syncOfflineRecipes();
    await syncOfflineModifiers();
    await syncOfflineDealComponents();
    await syncOfflineCategories();
  }
}

export async function syncOfflineShifts() {
  if (typeof window === "undefined" || !navigator.onLine) return;

  try {
    const pendingShifts = await db.shifts
      .where('sync_status')
      .equals('PENDING')
      .toArray();

    if (pendingShifts.length === 0) return;

    // Senior Mandate: CLOSED shifts uploaded first, then OPEN shifts
    pendingShifts.sort((a, b) => {
      if (a.status === 'CLOSED' && b.status !== 'CLOSED') return -1;
      if (a.status !== 'CLOSED' && b.status === 'CLOSED') return 1;
      return new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime();
    });

    for (const shift of pendingShifts) {
      try {
        const payload: any = {
          id: shift.id,
          starting_cash: Number(shift.starting_cash || 0),
          status: shift.status,
          opened_at: shift.opened_at,
          notes: shift.notes || null,
        };
        if (shift.closed_at) payload.closed_at = shift.closed_at;
        if (shift.actual_cash !== undefined && shift.actual_cash !== null) payload.actual_cash = Number(shift.actual_cash);
        if (shift.expected_cash !== undefined && shift.expected_cash !== null) payload.expected_cash = Number(shift.expected_cash);

        const { error } = await withTimeout(
          supabase.from('cashier_shifts').upsert([payload], { onConflict: 'id' }),
          5000,
          'Shift sync timeout'
        );
        if (!error) {
          await db.shifts.update(shift.id, { sync_status: 'SYNCED' });
        } else {
          console.warn('[Sync] Shift sync error:', shift.id, error);
          recordSyncError('cashier_shifts', error.code, error.message, error.details, shift.id);
        }
      } catch (shiftErr: any) {
        console.warn('Failed to sync shift upstream:', shift.id, shiftErr);
        recordSyncError('cashier_shifts', 'NETWORK_ERR', shiftErr?.message || 'Shift upload timeout', '', shift.id);
      }
    }
  } catch (err: any) {
    console.error('Error syncing shifts:', err);
    recordSyncError('cashier_shifts', 'ERROR', err?.message || 'Error syncing shifts');
  }
}

async function processSyncPendingOrders() {
  const pendingOrders = await db.orders
    .where('sync_status')
    .equals('PENDING')
    .toArray();

  if (pendingOrders.length === 0) return;
  lastSyncAttemptAt = new Date().toISOString();

  // Architecture Mandate: Only push orders whose shift has already been synced to Supabase
  const allShifts = await db.shifts.toArray();
  const syncedShiftIds = new Set(allShifts.filter(s => s.sync_status === 'SYNCED').map(s => s.id));

  // Orders whose shifts are still PENDING must WAIT in Dexie queue — never decoupled or nulled!
  const uploadableOrders = pendingOrders.filter(order => !order.shift_id || syncedShiftIds.has(order.shift_id));

  if (uploadableOrders.length === 0) {
    console.log('[Sync] Pending orders are held waiting for their shifts to sync first.');
    return;
  }

  const ordersPayload: any[] = [];
  const orderItemsPayload: any[] = [];
  const activeOrderIds: string[] = [];
  const activeItemIds: string[] = [];
  const dbUpdates: { id: string, items: any[] }[] = [];

  for (const order of uploadableOrders) {
    const { items, sync_status, ...orderData } = order;

    let needsLocalItemsUpdate = false;
    const resolvedItems = (items || []).map((item) => {
      let itemId = item.id;
      if (!isValidUuid(itemId)) {
        itemId = crypto.randomUUID();
        needsLocalItemsUpdate = true;
      }
      return { ...item, id: itemId };
    });

    if (needsLocalItemsUpdate) {
      dbUpdates.push({ id: order.id, items: resolvedItems });
    }

    ordersPayload.push({
      id: orderData.id,
      token_number: orderData.token_number,
      order_type: orderData.order_type,
      status: orderData.status,
      payment_method: orderData.payment_method,
      subtotal: Number(orderData.subtotal || 0),
      discount: Number(orderData.discount || 0),
      net_total: Number(orderData.net_total || 0),
      foodpanda_commission_pct: Number(orderData.foodpanda_commission_pct || 0),
      shift_id: isValidUuid(orderData.shift_id) ? orderData.shift_id : null,
      table_number: orderData.table_number || null,
      created_at: orderData.created_at,
      fp_payout_status: orderData.fp_payout_status || 'NOT_APPLICABLE',
      items: resolvedItems
    });

    activeOrderIds.push(orderData.id);

    for (const item of resolvedItems) {
      let itemCogs = Number((item as any).cogs_total || 0);
      if (itemCogs <= 0) {
        try {
          itemCogs = await calculateItemCogs(item as any);
        } catch {
          itemCogs = 0;
        }
      }

      orderItemsPayload.push({
        id: item.id,
        order_id: order.id,
        menu_item_id: isValidUuid(item.menu_item_id) ? item.menu_item_id : null,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0),
        cogs_total: itemCogs,
        modifiers_json: item.modifiers_json || [],
        deal_swaps_json: item.deal_swaps_json || []
      });
      activeItemIds.push(item.id!);
    }
  }

  // 1. Bulk Upsert Orders
  let batchOrdersError: any = null;
  try {
    const { error: ordersError } = await withTimeout(
      supabase.from('orders').upsert(ordersPayload, { onConflict: 'id' }),
      8000,
      'Orders upsert network timeout'
    );
    batchOrdersError = ordersError;
  } catch (netErr: any) {
    lastNetworkFailureTime = Date.now();
    console.warn('[Sync] Order sync network timeout or drop. Orders remain safe in local Dexie.', netErr?.message);
    return;
  }

  // Batch Success path:
  if (!batchOrdersError) {
    // Apply local ID updates
    if (dbUpdates.length > 0) {
      await Promise.all(dbUpdates.map(update => db.orders.update(update.id, { items: update.items })));
    }

    // Cleanup old items
    try {
      if (activeItemIds.length > 0) {
        await withTimeout(
          supabase
            .from('order_items')
            .delete()
            .in('order_id', activeOrderIds)
            .not('id', 'in', `(${activeItemIds.join(',')})`),
          6000
        );
      } else {
        await withTimeout(
          supabase.from('order_items').delete().in('order_id', activeOrderIds),
          6000
        );
      }
    } catch (delErr) {
      console.warn('[Sync] Non-critical item cleanup notice:', delErr);
    }

    // Upsert items
    if (orderItemsPayload.length > 0) {
      try {
        const { error: itemsError } = await withTimeout(
          supabase.from('order_items').upsert(orderItemsPayload, { onConflict: 'id' }),
          8000,
          'Order items upsert network timeout'
        );

        if (itemsError) {
          console.error('Failed to batch sync order items', itemsError);
          recordSyncError('order_items', itemsError.code, itemsError.message, itemsError.details);
          return;
        }
      } catch (itemNetErr: any) {
        lastNetworkFailureTime = Date.now();
        console.warn('[Sync] Items sync timeout. Will retry next cycle.', itemNetErr?.message);
        return;
      }
    }

    // Mark all as SYNCED locally
    await Promise.all(activeOrderIds.map(id => db.orders.update(id, { sync_status: 'SYNCED' })));
    usePosStore.getState().setSyncError(null);
    recordSyncSuccess();
    return;
  }

  // FALLBACK: Row-by-row synchronization to rescue individual orders (never nulling shift_id)
  console.warn('[Sync] Batch orders upsert failed with error. Falling back to row-by-row synchronization:', batchOrdersError);
  recordSyncError('orders', batchOrdersError.code, batchOrdersError.message, batchOrdersError.details);

  for (const order of uploadableOrders) {
    try {
      const { items, sync_status, ...orderData } = order;
      const orderPayload: any = {
        id: orderData.id,
        token_number: orderData.token_number,
        order_type: orderData.order_type,
        status: orderData.status,
        payment_method: orderData.payment_method,
        subtotal: Number(orderData.subtotal || 0),
        discount: Number(orderData.discount || 0),
        net_total: Number(orderData.net_total || 0),
        foodpanda_commission_pct: Number(orderData.foodpanda_commission_pct || 0),
        shift_id: isValidUuid(orderData.shift_id) ? orderData.shift_id : null,
        table_number: orderData.table_number || null,
        created_at: orderData.created_at,
        fp_payout_status: orderData.fp_payout_status || 'NOT_APPLICABLE',
        items: order.items || []
      };

      const { error: singleError } = await withTimeout(
        supabase.from('orders').upsert([orderPayload], { onConflict: 'id' }),
        5000,
        'Single order sync timeout'
      );

      if (singleError) {
        console.error(`[Sync] Order ${order.id} (#${order.token_number}) failed row sync:`, singleError);
        recordSyncError('orders', singleError.code, singleError.message, singleError.details, order.id);
        continue;
      }

      // Upsert items for this single order
      const thisOrderItems = (items || []).map(item => ({
        id: isValidUuid(item.id) ? item.id : crypto.randomUUID(),
        order_id: order.id,
        menu_item_id: isValidUuid(item.menu_item_id) ? item.menu_item_id : null,
        item_name: item.item_name,
        quantity: item.quantity,
        unit_price: Number(item.unit_price || 0),
        total_price: Number(item.total_price || 0),
        cogs_total: Number((item as any).cogs_total || 0),
        modifiers_json: item.modifiers_json || [],
        deal_swaps_json: item.deal_swaps_json || []
      }));

      if (thisOrderItems.length > 0) {
        await supabase.from('order_items').upsert(thisOrderItems, { onConflict: 'id' });
      }

      // Mark this order SYNCED locally
      await db.orders.update(order.id, { sync_status: 'SYNCED' });
      recordSyncSuccess();
    } catch (singleEx: any) {
      console.warn(`[Sync] Error syncing individual order ${order.id}:`, singleEx);
    }
  }
}

/**
 * Sync offline inventory logs as an immutable audit journal to Supabase.
 * NOTE: Does NOT perform delta math against raw_inventory in Supabase,
 * because raw_inventory authoritative current_stock is pushed directly by syncOfflineRawInventory.
 */
export async function syncOfflineInventoryLogs() {
  if (typeof window === "undefined" || !isNetworkAvailable()) return;

  try {
    const pendingLogs = await db.inventory_logs
      .where('sync_status')
      .equals('PENDING')
      .toArray();

    if (pendingLogs.length === 0) return;

    for (const log of pendingLogs) {
      try {
        const payload = {
          id: log.id,
          order_id: isValidUuid(log.order_id || '') ? log.order_id : null,
          inventory_item_id: log.inventory_item_id,
          change_qty: Number(log.change_qty),
          reason: log.reason,
          created_at: log.created_at
        };

        const { error } = await withTimeout(
          supabase.from('inventory_logs').upsert([payload], { onConflict: 'id' }),
          5000,
          'Inventory log append timeout'
        );

        if (!error || error.code === '42P01' || error.code === 'PGRST204' || error.code === 'PGRST205' || error.message?.includes('not find')) {
          // If synced, or if inventory_logs table not in Supabase schema, mark synced
          await db.inventory_logs.update(log.id, { sync_status: 'SYNCED' });
        }
      } catch (logErr) {
        console.warn('Failed to sync inventory log audit trail:', log.id, logErr);
      }
    }
  } catch (err) {
    console.error('Error syncing inventory logs:', err);
  }
}

export async function syncOfflineExpenses() {
  if (typeof window === "undefined" || !isNetworkAvailable()) return;

  try {
    const pendingExpenses = await db.expenses
      .where('sync_status')
      .equals('PENDING')
      .toArray();

    if (pendingExpenses.length === 0) return;

    for (const exp of pendingExpenses) {
      try {
        const payload: any = {
          id: exp.id,
          category: exp.category,
          amount: Number(exp.amount || 0),
          description: exp.description || '',
          logged_by: exp.logged_by || 'Admin',
          created_at: exp.created_at
        };

        const { error } = await withTimeout(
          supabase.from('expenses').upsert([payload], { onConflict: 'id' }),
          5000,
          'Expense sync timeout'
        );
        if (!error) {
          await db.expenses.update(exp.id, { sync_status: 'SYNCED' });
        }
      } catch (expErr) {
        console.warn('Failed to sync expense upstream:', exp.id, expErr);
      }
    }
  } catch (err) {
    console.error('Error syncing expenses:', err);
  }
}

export async function syncOfflineMenuItems() {
  if (typeof window === "undefined" || !isNetworkAvailable()) return;

  try {
    const pendingItems = await db.menu_items
      .where('sync_status')
      .equals('PENDING')
      .toArray();

    if (pendingItems.length === 0) return;

    for (const item of pendingItems) {
      try {
        const payload: any = {
          id: item.id,
          name: item.name,
          price: Number(item.price || 0),
          category_id: isValidUuid(item.category_id || '') ? item.category_id : null,
          is_deal: !!item.is_deal,
          is_available: item.is_available !== false
        };

        const { error } = await withTimeout(
          supabase.from('menu_items').upsert([payload], { onConflict: 'id' }),
          5000,
          'Menu item sync timeout'
        );
        if (!error) {
          await db.menu_items.update(item.id, { sync_status: 'SYNCED' });
        }
      } catch (itemErr) {
        console.warn('Failed to sync menu item upstream:', item.id, itemErr);
      }
    }
  } catch (err) {
    console.error('Error syncing menu items:', err);
  }
}

export async function syncOfflineRawInventory() {
  if (typeof window === "undefined" || !isNetworkAvailable()) return;

  try {
    const pendingRaw = await db.raw_inventory
      .where('sync_status')
      .equals('PENDING')
      .toArray();

    if (pendingRaw.length === 0) return;

    for (const raw of pendingRaw) {
      try {
        const payload: any = {
          id: raw.id,
          name: raw.name,
          current_stock: Number(raw.current_stock || 0),
          unit: raw.unit || 'unit',
          cost_per_unit: Number(raw.cost_per_unit || 0),
          min_stock_alert: Number(raw.min_stock_alert || 5)
        };

        const { error } = await withTimeout(
          supabase.from('raw_inventory').upsert([payload], { onConflict: 'id' }),
          5000,
          'Raw inventory sync timeout'
        );
        if (!error) {
          await db.raw_inventory.update(raw.id, { sync_status: 'SYNCED' });
        }
      } catch (rawErr) {
        console.warn('Failed to sync raw inventory upstream:', raw.id, rawErr);
      }
    }
  } catch (err) {
    console.error('Error syncing raw inventory:', err);
  }
}

export async function syncOfflineRecipes() {
  if (typeof window === "undefined" || !isNetworkAvailable()) return;

  try {
    const pendingRecipes = await db.recipes
      .where('sync_status')
      .equals('PENDING')
      .toArray();

    if (pendingRecipes.length === 0) return;

    for (const rec of pendingRecipes) {
      try {
        const payload = {
          id: rec.id,
          menu_item_id: rec.menu_item_id,
          inventory_item_id: rec.inventory_item_id,
          quantity_deducted: Number(rec.quantity_deducted || 1)
        };

        const { error } = await withTimeout(
          supabase.from('recipes').upsert([payload], { onConflict: 'id' }),
          5000,
          'Recipe sync timeout'
        );
        if (!error) {
          await db.recipes.update(rec.id, { sync_status: 'SYNCED' });
        }
      } catch (recErr) {
        console.warn('Failed to sync recipe upstream:', rec.id, recErr);
      }
    }
  } catch (err) {
    console.error('Error syncing recipes:', err);
  }
}

export async function syncOfflineCategories() {
  if (typeof window === "undefined" || !isNetworkAvailable()) return;

  try {
    const categories = await db.categories.toArray();
    for (const cat of categories) {
      if ((cat as any).sync_status === 'PENDING') {
        try {
          const payload = {
            id: cat.id,
            name: cat.name,
            sort_order: Number(cat.sort_order || 0)
          };
          const { error } = await withTimeout(
            supabase.from('categories').upsert([payload], { onConflict: 'id' }),
            5000,
            'Category sync timeout'
          );
          if (!error) {
            await db.categories.update(cat.id, { sync_status: 'SYNCED' } as any);
          }
        } catch (catErr) {
          console.warn('Failed to sync category upstream:', cat.id, catErr);
        }
      }
    }
  } catch (err) {
    console.error('Error syncing categories:', err);
  }
}

export async function syncOfflineModifiers() {
  if (typeof window === "undefined" || !isNetworkAvailable()) return;

  try {
    const modifiers = await db.modifiers.toArray();
    if (modifiers.length === 0) return;

    const payload = modifiers.map(m => ({
      id: m.id,
      name: m.name,
      price: Number(m.price || 0),
      inventory_item_id: m.inventory_item_id || null,
      quantity_deducted: Number(m.quantity_deducted || 1),
      category: m.category || null,
      is_active: m.is_active !== false
    }));

    const { error } = await withTimeout(
      supabase.from('modifiers').upsert(payload, { onConflict: 'id' }),
      5000,
      'Modifiers sync timeout'
    );
    if (error) {
      console.warn('Failed to sync modifiers upstream:', error);
    }
  } catch (err) {
    console.error('Error syncing modifiers:', err);
  }
}

export async function syncOfflineDealComponents() {
  if (typeof window === "undefined" || !isNetworkAvailable()) return;

  try {
    const dealComponents = await db.deal_components.toArray();
    if (dealComponents.length === 0) return;

    const payload = dealComponents.map(dc => ({
      id: dc.id,
      deal_id: dc.deal_id,
      menu_item_id: dc.menu_item_id || null,
      category_id: dc.category_id || null,
      slot_title: dc.slot_title || null,
      quantity: Number(dc.quantity || 1)
    }));

    const { error } = await withTimeout(
      supabase.from('deal_components').upsert(payload, { onConflict: 'id' }),
      5000,
      'Deal components sync timeout'
    );
    if (error) {
      console.warn('Failed to sync deal components upstream:', error);
    }
  } catch (err) {
    console.error('Error syncing deal components:', err);
  }
}

export async function syncOfflineDeletions() {
  if (typeof window === "undefined" || !isNetworkAvailable() || isExplicitOffline()) return;

  try {
    const pendingDeletions = await db.deleted_records
      .where('sync_status')
      .equals('PENDING')
      .toArray();

    if (pendingDeletions.length === 0) return;

    for (const del of pendingDeletions) {
      try {
        const { error } = await withTimeout(
          supabase.from(del.table_name).delete().eq('id', del.record_id),
          5000,
          `Deletion sync timeout for ${del.table_name}`
        );

        if (!error) {
          // Successfully purged from Supabase! Delete tombstone from Dexie
          await db.deleted_records.delete(del.id);
        } else {
          console.warn(`[SyncDeletions] Error deleting ${del.table_name}/${del.record_id}:`, error);
        }
      } catch (delErr) {
        console.warn(`[SyncDeletions] Exception deleting ${del.table_name}/${del.record_id}:`, delErr);
      }
    }
  } catch (err) {
    console.warn('[SyncDeletions] Error querying pending deletions:', err);
  }
}

/**
 * Tracks a deletion locally in Dexie and flushes it immediately upstream to Supabase if connected.
 * Ensures that if anything is deleted on the laptop portal, it is cleanly removed from Supabase.
 */
export async function trackAndSyncDeletion(tableName: string, recordId: string) {
  if (!recordId) return;

  const deletionId = crypto.randomUUID();
  try {
    await db.deleted_records.put({
      id: deletionId,
      table_name: tableName,
      record_id: recordId,
      created_at: new Date().toISOString(),
      sync_status: 'PENDING'
    });
  } catch (err) {
    console.warn('[trackAndSyncDeletion] Failed to log deletion to Dexie:', err);
  }

  // Attempt instant push to Supabase if connected
  if (isNetworkAvailable() && !isExplicitOffline() && !isCircuitBreakerTripped()) {
    try {
      const { error } = await supabase.from(tableName).delete().eq('id', recordId);
      if (!error) {
        await db.deleted_records.delete(deletionId).catch(() => {});
        return;
      }
    } catch (e) {
      console.warn(`[trackAndSyncDeletion] Instant delete failed, queued for background sync:`, e);
    }
  }

  // Otherwise trigger background sync queue
  setTimeout(() => syncOfflineOrders(), 50);
}


// ───────────────────────────────────────────────────
// DOWNSTREAM: Disabled on Laptop (Laptop is Single Writer)
// ───────────────────────────────────────────────────

/**
 * ARCHITECTURE MANDATE (Single Writer):
 * The laptop Dexie database is the ONLY source of truth and ONLY writer.
 * Downstream pulls that overwrite local tables (menu, stock, orders, cashiers) are strictly disabled.
 * Supabase is a one-way read-only MIRROR uploaded by the laptop.
 */
export async function syncDownstream(): Promise<{
  menuItems: any[];
  categories: any[];
  rawInventory: any[];
  recipes: any[];
  dealComponents: any[];
  modifiers: any[];
} | null> {
  // Always return local Dexie cache, NEVER overwrite local Dexie tables with cloud
  return loadFromLocalCache();
}

/**
 * Load cached menu data from Dexie (Instant 0ms Local-First Read).
 * Used at application startup and when offline.
 */
export async function loadFromLocalCache(): Promise<{
  menuItems: any[];
  categories: any[];
  rawInventory: any[];
  recipes: any[];
  dealComponents: any[];
  modifiers: any[];
}> {
  const [menuItems, categories, rawInventory, recipes, dealComponents, modifiers] = await Promise.all([
    db.menu_items.toArray(),
    db.categories.orderBy('sort_order').toArray(),
    db.raw_inventory.toArray(),
    db.recipes.toArray(),
    db.deal_components.toArray(),
    db.modifiers.toArray(),
  ]);

  return {
    menuItems: menuItems.map(m => ({
      id: m.id,
      category_id: m.category_id || null,
      category_name: m.category_name,
      name: m.name,
      price: m.price,
      cost_price: m.cost_price,
      is_deal: Boolean(m.is_deal),
    })),
    categories,
    rawInventory,
    recipes,
    dealComponents,
    modifiers,
  };
}


// ──────────────────────────────────────────
// BACKGROUND SYNC SCHEDULER (Optional Auto-Sync Upstream)
// ──────────────────────────────────────────

/**
 * Background Sync Scheduler:
 * Optional auto-sync upstream every 15 minutes if online. Never pulls downstream to overwrite Dexie.
 */
export function startBackgroundSync(onDownstreamUpdate?: (data: any) => void) {
  if (typeof window === 'undefined') return () => {};

  if (backgroundSyncInterval) return;

  const runSync = async () => {
    if (!navigator.onLine || isExplicitOffline() || isCircuitBreakerTripped()) return;
    try {
      await performFullUploadSync();
    } catch (e) {
      console.warn('[Sync] Background sync notice:', e);
    }
  };

  // Run fast background upload sync every 20 seconds (20,000ms)
  backgroundSyncInterval = setInterval(runSync, 20 * 1000);

  // Immediate sync when coming back online
  const onOnline = () => {
    if (!isExplicitOffline()) {
      resetCircuitBreaker();
      console.log('[Sync] Device online! Triggering upload sync...');
      runSync();
    }
  };
  window.addEventListener('online', onOnline);

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && navigator.onLine && !isExplicitOffline()) {
      runSync();
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  return () => {
    if (backgroundSyncInterval) {
      clearInterval(backgroundSyncInterval);
      backgroundSyncInterval = null;
    }
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

export async function getPendingSyncCounts(): Promise<{ orders: number; shifts: number; logs: number }> {
  try {
    const [orders, shifts, logs] = await Promise.all([
      db.orders.where('sync_status').equals('PENDING').count(),
      db.shifts.where('sync_status').equals('PENDING').count(),
      db.inventory_logs.where('sync_status').equals('PENDING').count()
    ]);
    return { orders, shifts, logs };
  } catch {
    return { orders: 0, shifts: 0, logs: 0 };
  }
}

/**
 * Check if network is truly available and not explicitly offline or breaker tripped
 */
export function isNetworkAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  if (isExplicitOffline()) return false;
  if (isCircuitBreakerTripped()) return false;
  return navigator.onLine;
}

/**
 * Explicit Offline Mode State Management
 */
export function isExplicitOffline(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem('muchachos_explicit_offline') === 'true';
}

export function setExplicitOffline(offline: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('muchachos_explicit_offline', offline ? 'true' : 'false');
  posBus.publish('OFFLINE_MODE_CHANGED', { isExplicitOffline: offline });
}

/**
 * Automatically merges duplicate raw inventory items whose names match (case-insensitive, e.g. "cola" & "Cola")
 * and updates any recipes pointing to the duplicate.
 */
export async function autoDeduplicateDexieInventory(): Promise<number> {
  try {
    const all = await db.raw_inventory.toArray();
    const seen = new Map<string, any>();
    const toDeleteIds: string[] = [];
    const idRemap = new Map<string, string>(); // duplicateId -> canonicalId

    for (const item of all) {
      const norm = item.name.trim().toLowerCase();
      if (seen.has(norm)) {
        const canonical = seen.get(norm);
        toDeleteIds.push(item.id);
        idRemap.set(item.id, canonical.id);
      } else {
        seen.set(norm, item);
      }
    }

    if (toDeleteIds.length > 0) {
      console.log(`[Sync] Merging and cleaning ${toDeleteIds.length} duplicate raw inventory rows...`);
      const allRecipes = await db.recipes.toArray();
      for (const r of allRecipes) {
        if (idRemap.has(r.inventory_item_id)) {
          await db.recipes.update(r.id, { inventory_item_id: idRemap.get(r.inventory_item_id)! });
        }
      }
      for (const id of toDeleteIds) {
        await db.raw_inventory.delete(id);
      }
      return toDeleteIds.length;
    }
  } catch (dedupErr) {
    console.warn('[Sync] Inventory deduplication note:', dedupErr);
  }
  return 0;
}

/**
 * Explicit, Ordered, Idempotent Upstream Cloud Sync:
 * 1. Reachability probe
 * 2. Supabase connection check
 * 3. Shifts upload (CLOSED first, then OPEN)
 * 4. Orders whose shifts are already synced + order items
 * 5. Expenses
 * 6. Inventory logs & current raw inventory stock snapshot
 * 7. Menu items, categories & recipes snapshots
 * 8. Write sync_meta record to Supabase
 */
export type SyncProgressStep = 
  | 'CHECKING_WIFI' 
  | 'CONNECTING' 
  | 'SYNCING_SHIFTS' 
  | 'SYNCING_ORDERS' 
  | 'SYNCING_EXPENSES' 
  | 'SYNCING_INVENTORY' 
  | 'SYNCING_MENU' 
  | 'UPDATING_META' 
  | 'DONE';

export async function performFullUploadSync(
  onProgress?: (step: SyncProgressStep, detail?: string) => void
): Promise<{
  success: boolean;
  message: string;
  ordersSynced: number;
  stockSynced: number;
  shiftsSynced: number;
}> {
  if (typeof window === 'undefined') {
    return { success: false, message: 'Server environment', ordersSynced: 0, stockSynced: 0, shiftsSynced: 0 };
  }

  if (!navigator.onLine || isExplicitOffline()) {
    return { success: false, message: 'Operating offline. Changes safely held in local Dexie.', ordersSynced: 0, stockSynced: 0, shiftsSynced: 0 };
  }

  // 1. Short reachability probe
  onProgress?.('CHECKING_WIFI', 'Checking Wi-Fi & network interface...');
  const reachable = await checkConnectivity();
  if (!reachable) {
    return { success: false, message: 'Network probe failed. Operating in offline mode.', ordersSynced: 0, stockSynced: 0, shiftsSynced: 0 };
  }

  // 2. Verify Supabase connection
  onProgress?.('CONNECTING', 'Connecting to Supabase cloud mirror...');
  try {
    const { error: probeError } = await withTimeout(
      supabase.from('system_settings').select('id').limit(1),
      4000,
      'Supabase connection probe timeout'
    );
    if (probeError && probeError.code !== 'PGRST116') {
      if (probeError.message?.includes('fetch') || probeError.message?.includes('timeout')) {
        throw probeError;
      }
    }
  } catch (probeEx: any) {
    recordSyncError('connection', 'PROBE_FAILED', probeEx?.message || 'Supabase unreachable');
    return { success: false, message: 'Cannot reach Supabase cloud mirror.', ordersSynced: 0, stockSynced: 0, shiftsSynced: 0 };
  }

  resetCircuitBreaker();

  try {
    const beforeCounts = await getPendingSyncCounts();

    // 3. Upload shifts (status: closed first, then open)
    onProgress?.('SYNCING_SHIFTS', 'Uploading shifts (closed shifts first for FK safety)...');
    await syncOfflineShifts();

    // 4 & 5. Upload orders whose shift is already uploaded + order items
    onProgress?.('SYNCING_ORDERS', 'Uploading orders and line items...');
    await syncOfflineOrders();

    // 6. Upload expenses
    onProgress?.('SYNCING_EXPENSES', 'Uploading cash drawer expenses...');
    await syncOfflineExpenses();

    // 7. Upload inventory logs and current raw inventory stock snapshot
    onProgress?.('SYNCING_INVENTORY', 'Uploading inventory logs and stock snapshot...');
    await syncOfflineInventoryLogs();
    await syncOfflineRawInventory();

    // 8. Upload menu, categories & recipes snapshots
    onProgress?.('SYNCING_MENU', 'Uploading menu, categories & recipe configurations...');
    await syncOfflineCategories();
    await syncOfflineMenuItems();
    await syncOfflineRecipes();

    const afterCounts = await getPendingSyncCounts();
    const ordersSynced = Math.max(0, beforeCounts.orders - afterCounts.orders);
    const shiftsSynced = Math.max(0, beforeCounts.shifts - afterCounts.shifts);
    const stockSynced = Math.max(0, beforeCounts.logs - afterCounts.logs);

    // 9. Write sync_meta record to Supabase
    onProgress?.('UPDATING_META', 'Updating cloud sync_meta timestamp...');
    try {
      await withTimeout(
        supabase.from('sync_meta').upsert([{
          id: 'default',
          last_sync_at: new Date().toISOString(),
          pending_counts_uploaded: {
            orders_uploaded: ordersSynced,
            shifts_uploaded: shiftsSynced,
            orders_remaining: afterCounts.orders,
            shifts_remaining: afterCounts.shifts
          },
          app_version: '0.1.0'
        }], { onConflict: 'id' }),
        4000,
        'sync_meta update timeout'
      );
    } catch (metaErr) {
      console.warn('[Sync] Non-critical sync_meta note:', metaErr);
    }

    try {
      localStorage.setItem('muchachos_last_sync', new Date().toISOString());
    } catch {}

    recordSyncSuccess();
    onProgress?.('DONE', 'Upload complete!');

    return {
      success: true,
      message: `Sync successful! ${ordersSynced} orders, ${shiftsSynced} shifts, and stock snapshot uploaded to cloud mirror.`,
      ordersSynced,
      stockSynced,
      shiftsSynced
    };
  } catch (err: any) {
    console.error('[Sync] Upload sync error:', err);
    recordSyncError('general', 'SYNC_ERROR', err?.message || 'Upload sync failed');
    return {
      success: false,
      message: err.message || 'Synchronization encountered an issue.',
      ordersSynced: 0,
      stockSynced: 0,
      shiftsSynced: 0
    };
  }
}

// Backward-compatible alias
export const performFullTwoWaySync = performFullUploadSync;

/**
 * Pre-flight flush before switching to explicit Offline Mode
 */
export async function switchPosToOffline(): Promise<{
  success: boolean;
  message: string;
  ordersSynced: number;
  stockSynced: number;
}> {
  let ordersSynced = 0;
  let stockSynced = 0;

  // If online, perform complete two-way flush first
  if (navigator.onLine) {
    try {
      const syncResult = await performFullTwoWaySync();
      ordersSynced = syncResult.ordersSynced;
      stockSynced = syncResult.stockSynced;
    } catch (e) {
      console.warn('[Sync] Pre-offline flush notice:', e);
    }
  }

  setExplicitOffline(true);
  return {
    success: true,
    message: ordersSynced > 0 
      ? `Flushed ${ordersSynced} orders & stock changes to cloud. POS is now safely in OFFLINE mode.`
      : 'POS is now safely operating in OFFLINE mode with 0ms local storage.',
    ordersSynced,
    stockSynced
  };
}

/**
 * Switch back to Online Mode and immediately synchronize both directions
 */
export async function switchPosToOnline(): Promise<{
  success: boolean;
  message: string;
  ordersSynced: number;
  stockSynced: number;
}> {
  setExplicitOffline(false);
  resetCircuitBreaker();

  if (!navigator.onLine) {
    return {
      success: false,
      message: 'Internet connection not detected. Will sync automatically once connected.',
      ordersSynced: 0,
      stockSynced: 0
    };
  }

  const res = await performFullTwoWaySync();
  return {
    success: res.success,
    message: res.message,
    ordersSynced: res.ordersSynced,
    stockSynced: res.stockSynced
  };
}

/**
 * 1-Way Initial/On-Demand Bulk Upload of ALL Local Dexie Data to Supabase Cloud Mirror
 * Uploads categories, raw inventory, menu items, recipes, modifiers, shifts, orders, order items, and expenses.
 */
export async function bulkUploadLocalToCloud(onProgress?: (msg: string) => void): Promise<{ success: boolean; message: string }> {
  if (typeof window === "undefined" || !navigator.onLine) {
    return { success: false, message: "No internet connection detected." };
  }

  try {
    onProgress?.("Flushing pending deletions to cloud...");
    await syncOfflineDeletions();

    onProgress?.("Syncing categories...");
    const categories = await db.categories.toArray();
    if (categories.length > 0) {
      const payload = categories.map(c => ({
        id: c.id,
        name: c.name,
        sort_order: Number(c.sort_order || 0)
      }));
      const res = await supabase.from('categories').upsert(payload, { onConflict: 'id' });
      if (res.error) console.warn('[bulkUpload] categories warning:', res.error.message);
    }

    onProgress?.("Syncing raw inventory items...");
    const rawInv = await db.raw_inventory.toArray();
    if (rawInv.length > 0) {
      const payload = rawInv.map(r => ({
        id: r.id,
        name: r.name,
        current_stock: Number(r.current_stock || 0),
        unit: r.unit || 'unit',
        cost_per_unit: Number(r.cost_per_unit || 0),
        min_stock_alert: Number(r.min_stock_alert || 5),
        is_overhead: Boolean(r.is_overhead),
        bulk_unit: r.bulk_unit || 'Packet',
        conversion_rate: Number(r.conversion_rate || 1),
        bulk_cost: Number(r.bulk_cost || 0)
      }));
      const res = await supabase.from('raw_inventory').upsert(payload, { onConflict: 'id' });
      if (res.error) console.warn('[bulkUpload] raw_inventory warning:', res.error.message);
    }

    onProgress?.("Syncing menu items...");
    const menuItems = await db.menu_items.toArray();
    if (menuItems.length > 0) {
      const payload = menuItems.map(m => ({
        id: m.id,
        name: m.name,
        category_id: m.category_id || null,
        category_name: m.category_name,
        price: Number(m.price || 0),
        cost_price: Number(m.cost_price || 0),
        overhead_cost: Number(m.overhead_cost || 0),
        allows_modifiers: m.allows_modifiers !== false,
        is_deal: Boolean(m.is_deal),
        is_available: m.is_available !== false
      }));
      const res = await supabase.from('menu_items').upsert(payload, { onConflict: 'id' });
      if (res.error) console.warn('[bulkUpload] menu_items warning:', res.error.message);
    }

    onProgress?.("Syncing recipes...");
    const recipes = await db.recipes.toArray();
    if (recipes.length > 0) {
      const payload = recipes.map(r => ({
        id: r.id,
        menu_item_id: r.menu_item_id,
        inventory_item_id: r.inventory_item_id,
        quantity_deducted: Number(r.quantity_deducted || 1)
      }));
      const res = await supabase.from('recipes').upsert(payload, { onConflict: 'id' });
      if (res.error) console.warn('[bulkUpload] recipes warning:', res.error.message);
    }

    onProgress?.("Syncing modifiers...");
    const modifiers = await db.modifiers.toArray();
    if (modifiers.length > 0) {
      const payload = modifiers.map(m => ({
        id: m.id,
        name: m.name,
        price: Number(m.price || 0),
        inventory_item_id: m.inventory_item_id || null,
        quantity_deducted: Number(m.quantity_deducted || 1),
        category: m.category || null,
        is_active: m.is_active !== false
      }));
      const res = await supabase.from('modifiers').upsert(payload, { onConflict: 'id' });
      if (res.error) console.warn('[bulkUpload] modifiers warning:', res.error.message);
    }

    onProgress?.("Syncing deal components...");
    const dealComponents = await db.deal_components.toArray();
    if (dealComponents.length > 0) {
      const payload = dealComponents.map(dc => ({
        id: dc.id,
        deal_id: dc.deal_id,
        menu_item_id: dc.menu_item_id || null,
        category_id: dc.category_id || null,
        slot_title: dc.slot_title || null,
        quantity: Number(dc.quantity || 1)
      }));
      const res = await supabase.from('deal_components').upsert(payload, { onConflict: 'id' });
      if (res.error) console.warn('[bulkUpload] deal_components warning:', res.error.message);
    }

    onProgress?.("Syncing shifts...");
    const shifts = await db.shifts.toArray();
    if (shifts.length > 0) {
      const payload = shifts.map(s => ({
        id: s.id,
        cashier_id: s.cashier_id || null,
        cashier_name: s.cashier_name || null,
        opened_at: s.opened_at,
        closed_at: s.closed_at || null,
        starting_cash: Number(s.starting_cash || 0),
        closing_cash: s.closing_cash !== undefined && s.closing_cash !== null ? Number(s.closing_cash) : null,
        expected_cash: s.expected_cash !== undefined && s.expected_cash !== null ? Number(s.expected_cash) : null,
        actual_cash: s.actual_cash !== undefined && s.actual_cash !== null ? Number(s.actual_cash) : null,
        status: s.status,
        notes: s.notes || null
      }));
      const res = await supabase.from('cashier_shifts').upsert(payload, { onConflict: 'id' });
      if (res.error) console.warn('[bulkUpload] cashier_shifts warning:', res.error.message);
    }

    onProgress?.("Syncing orders...");
    const orders = await db.orders.toArray();
    if (orders.length > 0) {
      const ordersPayload = orders.map(o => ({
        id: o.id,
        token_number: o.token_number,
        order_type: o.order_type,
        status: o.status,
        payment_method: o.payment_method,
        subtotal: Number(o.subtotal || 0),
        discount: Number(o.discount || 0),
        net_total: Number(o.net_total || 0),
        foodpanda_commission_pct: Number(o.foodpanda_commission_pct || 0),
        shift_id: o.shift_id || null,
        table_number: o.table_number || null,
        created_at: o.created_at,
        fp_payout_status: o.fp_payout_status || 'NOT_APPLICABLE',
        items: o.items || []
      }));
      for (let i = 0; i < ordersPayload.length; i += 50) {
        const chunk = ordersPayload.slice(i, i + 50);
        const res = await supabase.from('orders').upsert(chunk, { onConflict: 'id' });
        if (res.error) console.warn('[bulkUpload] orders chunk warning:', res.error.message);
      }

      const allOrderItems: any[] = [];
      orders.forEach(o => {
        (o.items || []).forEach(it => {
          allOrderItems.push({
            id: it.id || crypto.randomUUID(),
            order_id: o.id,
            menu_item_id: it.menu_item_id || null,
            item_name: it.item_name,
            quantity: Number(it.quantity || 1),
            unit_price: Number(it.unit_price || 0),
            total_price: Number(it.total_price || 0),
            cogs_total: Number(it.cogs_total || 0),
            modifiers_json: it.modifiers_json || [],
            deal_swaps_json: it.deal_swaps_json || []
          });
        });
      });
      for (let i = 0; i < allOrderItems.length; i += 100) {
        const chunk = allOrderItems.slice(i, i + 100);
        const res = await supabase.from('order_items').upsert(chunk, { onConflict: 'id' });
        if (res.error) console.warn('[bulkUpload] order_items chunk warning:', res.error.message);
      }
    }

    onProgress?.("Syncing expenses...");
    const expenses = await db.expenses.toArray();
    if (expenses.length > 0) {
      const payload = expenses.map(e => ({
        id: e.id,
        category: e.category,
        amount: Number(e.amount || 0),
        description: e.description,
        logged_by: e.logged_by,
        shift_id: e.shift_id || null,
        created_at: e.created_at
      }));
      const res = await supabase.from('expenses').upsert(payload, { onConflict: 'id' });
      if (res.error) console.warn('[bulkUpload] expenses warning:', res.error.message);
    }

    onProgress?.("Updating sync metadata...");
    await supabase.from('sync_meta').upsert([{
      id: 'default',
      last_sync_at: new Date().toISOString(),
      app_version: '0.1.0',
      total_orders_synced: orders.length
    }], { onConflict: 'id' });

    recordSyncSuccess();
    return { 
      success: true, 
      message: `Successfully uploaded ${orders.length} orders, ${menuItems.length} menu items, and ${rawInv.length} inventory items to Supabase!` 
    };
  } catch (err: any) {
    console.error('[bulkUploadLocalToCloud] error:', err);
    recordSyncError('bulk_upload', 'ERROR', err.message);
    return { success: false, message: `Upload failed: ${err.message}` };
  }
}

