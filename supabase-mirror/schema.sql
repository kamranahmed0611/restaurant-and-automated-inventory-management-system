-- ==============================================================================
-- MUCHACHOS POS: COMPLETE CLEAN-WIPE & REBUILD SCHEMA FOR SUPABASE CLOUD MIRROR
-- ==============================================================================
-- Execute this entire script in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/qoeapcxyupyugqrmjcnp/sql/new
--
-- ARCHITECTURE RULE (1-Way Cloud Mirror):
-- 1. The physical laptop (Dexie database) is the 100% authoritative single source of truth.
-- 2. Supabase is a clean, one-way cloud mirror updated via laptop background sync.
-- 3. NO triggers or stored procedures modify raw_inventory or decouple local counts.
-- 4. The Vercel web app (mobile/desktop) reads directly from this mirror in real time.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. DROP ALL LEGACY TRIGGERS & FUNCTIONS
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_order_completion_inventory ON orders;
DROP TRIGGER IF EXISTS trigger_order_status_inventory_change ON orders;
DROP TRIGGER IF EXISTS trigger_inventory_deduction ON order_items;
DROP TRIGGER IF EXISTS trigger_order_items_inventory ON order_items;
DROP TRIGGER IF EXISTS trigger_spoilage_deduction ON spoilage_logs;

DROP FUNCTION IF EXISTS handle_order_completion_inventory();
DROP FUNCTION IF EXISTS handle_order_status_inventory_change();
DROP FUNCTION IF EXISTS handle_inventory_deduction();
DROP FUNCTION IF EXISTS handle_spoilage_deduction();

-- ------------------------------------------------------------------------------
-- 2. DROP EXISTING VIEWS & TABLES (CASCADE FOR CLEAN REBUILD)
-- ------------------------------------------------------------------------------
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_views WHERE viewname = 'shifts' AND schemaname = 'public'
    ) THEN
        EXECUTE 'DROP VIEW IF EXISTS public.shifts CASCADE';
    ELSIF EXISTS (
        SELECT 1 FROM pg_tables WHERE tablename = 'shifts' AND schemaname = 'public'
    ) THEN
        EXECUTE 'DROP TABLE IF EXISTS public.shifts CASCADE';
    END IF;
END $$;

DROP TABLE IF EXISTS sync_meta CASCADE;
DROP TABLE IF EXISTS spoilage_logs CASCADE;
DROP TABLE IF EXISTS inventory_logs CASCADE;
DROP TABLE IF EXISTS expenses CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS cashier_shifts CASCADE;
DROP TABLE IF EXISTS deal_components CASCADE;
DROP TABLE IF EXISTS modifiers CASCADE;
DROP TABLE IF EXISTS recipes CASCADE;
DROP TABLE IF EXISTS menu_items CASCADE;
DROP TABLE IF EXISTS raw_inventory CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS system_settings CASCADE;

-- ------------------------------------------------------------------------------
-- 3. CREATE CORE TABLES
-- ------------------------------------------------------------------------------

-- System Settings & Connectivity Probe
CREATE TABLE system_settings (
    id TEXT PRIMARY KEY DEFAULT 'main',
    restaurant_name TEXT NOT NULL DEFAULT 'Muchachos',
    currency TEXT NOT NULL DEFAULT 'PKR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (id, restaurant_name)
VALUES ('main', 'Muchachos')
ON CONFLICT (id) DO NOTHING;

-- Categories
CREATE TABLE categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raw Inventory (Ingredients & stock balances synced from laptop)
CREATE TABLE raw_inventory (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    current_stock NUMERIC NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT 'Units',
    cost_per_unit NUMERIC NOT NULL DEFAULT 0,
    min_stock_alert NUMERIC NOT NULL DEFAULT 5,
    is_overhead BOOLEAN NOT NULL DEFAULT FALSE,
    bulk_unit TEXT DEFAULT 'Packet',
    conversion_rate NUMERIC NOT NULL DEFAULT 1,
    bulk_cost NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Menu Items
CREATE TABLE menu_items (
    id TEXT PRIMARY KEY,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    category_name TEXT,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL DEFAULT 0,
    cost_price NUMERIC,
    overhead_cost NUMERIC NOT NULL DEFAULT 0,
    allows_modifiers BOOLEAN NOT NULL DEFAULT TRUE,
    is_deal BOOLEAN NOT NULL DEFAULT FALSE,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Recipes (Bill of Materials)
CREATE TABLE recipes (
    id TEXT PRIMARY KEY,
    menu_item_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
    inventory_item_id TEXT REFERENCES raw_inventory(id) ON DELETE CASCADE,
    quantity_deducted NUMERIC NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Modifiers & Add-ons
CREATE TABLE modifiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price NUMERIC NOT NULL DEFAULT 0,
    inventory_item_id TEXT REFERENCES raw_inventory(id) ON DELETE SET NULL,
    quantity_deducted NUMERIC NOT NULL DEFAULT 1,
    category TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deal Components
CREATE TABLE deal_components (
    id TEXT PRIMARY KEY,
    deal_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE,
    menu_item_id TEXT REFERENCES menu_items(id) ON DELETE SET NULL,
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    slot_title TEXT,
    quantity NUMERIC NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cashier Shifts (Z-Reports & Drawer Reconciliation)
CREATE TABLE cashier_shifts (
    id TEXT PRIMARY KEY,
    cashier_id TEXT,
    cashier_name TEXT,
    opened_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    starting_cash NUMERIC NOT NULL DEFAULT 0,
    closing_cash NUMERIC,
    expected_cash NUMERIC,
    actual_cash NUMERIC,
    cash_difference NUMERIC,
    total_sales NUMERIC NOT NULL DEFAULT 0,
    card_sales NUMERIC NOT NULL DEFAULT 0,
    cash_sales NUMERIC NOT NULL DEFAULT 0,
    foodpanda_sales NUMERIC NOT NULL DEFAULT 0,
    total_discount NUMERIC NOT NULL DEFAULT 0,
    drawer_expenses NUMERIC NOT NULL DEFAULT 0,
    deficit_settlement_cost NUMERIC NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'OPEN',
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backward-compatibility view: alias 'shifts' to 'cashier_shifts'
CREATE OR REPLACE VIEW shifts AS SELECT * FROM cashier_shifts;

-- Orders
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    token_number INT NOT NULL,
    order_type TEXT NOT NULL DEFAULT 'TAKEAWAY',
    payment_method TEXT NOT NULL DEFAULT 'CASH',
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    subtotal NUMERIC NOT NULL DEFAULT 0,
    discount NUMERIC NOT NULL DEFAULT 0,
    net_total NUMERIC NOT NULL DEFAULT 0,
    foodpanda_commission_pct NUMERIC NOT NULL DEFAULT 0,
    fp_payout_status TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    table_number TEXT,
    cashier_id TEXT,
    shift_id TEXT REFERENCES cashier_shifts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Order Items Detail
CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id TEXT,
    item_name TEXT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    total_price NUMERIC NOT NULL DEFAULT 0,
    cogs_total NUMERIC NOT NULL DEFAULT 0,
    modifiers_json JSONB DEFAULT '[]'::jsonb,
    deal_swaps_json JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Expenses (Store expenses + Shift drawer payouts + Waste)
CREATE TABLE expenses (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    description TEXT,
    logged_by TEXT,
    shift_id TEXT REFERENCES cashier_shifts(id) ON DELETE SET NULL,
    is_drawer_expense BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Inventory Deduction & Restock Audit Ledger
CREATE TABLE inventory_logs (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    inventory_item_id TEXT REFERENCES raw_inventory(id) ON DELETE SET NULL,
    change_qty NUMERIC NOT NULL,
    change_type TEXT NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spoilage / Wastage Ledger
CREATE TABLE spoilage_logs (
    id TEXT PRIMARY KEY,
    inventory_item_id TEXT REFERENCES raw_inventory(id) ON DELETE SET NULL,
    quantity NUMERIC NOT NULL,
    cost_loss NUMERIC NOT NULL,
    reason TEXT,
    logged_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sync Metadata Tracking
CREATE TABLE sync_meta (
    id TEXT PRIMARY KEY DEFAULT 'default',
    last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    app_version TEXT DEFAULT '0.1.0',
    total_orders_synced INT DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sync_meta (id, last_sync_at, app_version)
VALUES ('default', NOW(), '0.1.0')
ON CONFLICT (id) DO UPDATE SET updated_at = NOW();

-- ------------------------------------------------------------------------------
-- 4. PERFORMANCE INDEXES
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_shift_id ON orders (shift_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_type ON orders (order_type);
CREATE INDEX IF NOT EXISTS idx_orders_fp_payout_status ON orders (fp_payout_status);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item_id ON order_items (menu_item_id);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_opened_at ON cashier_shifts (opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_status ON cashier_shifts (status);

CREATE INDEX IF NOT EXISTS idx_expenses_created_at ON expenses (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category ON expenses (category);
CREATE INDEX IF NOT EXISTS idx_expenses_shift_id ON expenses (shift_id);

CREATE INDEX IF NOT EXISTS idx_inventory_logs_created_at ON inventory_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_order_id ON inventory_logs (order_id);

-- ------------------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashier_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE spoilage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_meta ENABLE ROW LEVEL SECURITY;

-- Allow laptop POS background sync (anon + authenticated) full access
CREATE POLICY "allow_all_system_settings" ON system_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_raw_inventory" ON raw_inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_menu_items" ON menu_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_recipes" ON recipes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_modifiers" ON modifiers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_deal_components" ON deal_components FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_cashier_shifts" ON cashier_shifts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_orders" ON orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_order_items" ON order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_inventory_logs" ON inventory_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_spoilage_logs" ON spoilage_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_sync_meta" ON sync_meta FOR ALL USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 6. REALTIME REPLICATION (For instant live updates on Vercel owner dashboard)
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
    ALTER PUBLICATION supabase_realtime SET TABLE orders, order_items, cashier_shifts, raw_inventory, expenses, sync_meta;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

