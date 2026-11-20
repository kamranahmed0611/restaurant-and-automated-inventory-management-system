-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CATEGORIES
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL UNIQUE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. RAW INVENTORY
CREATE TABLE raw_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    base_unit VARCHAR(20) NOT NULL,
    cost_per_unit NUMERIC(10, 4) NOT NULL DEFAULT 0.0000,
    current_stock NUMERIC(10, 3) NOT NULL DEFAULT 0.000,
    min_stock_alert NUMERIC(10, 3) DEFAULT 5.000,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. MENU ITEMS
CREATE TABLE menu_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name VARCHAR(100) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    is_deal BOOLEAN DEFAULT FALSE,
    is_available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. RECIPES
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    inventory_item_id UUID NOT NULL REFERENCES raw_inventory(id) ON DELETE CASCADE,
    quantity_deducted NUMERIC(10, 3) NOT NULL,
    UNIQUE(menu_item_id, inventory_item_id)
);

-- 5. MODIFIERS
CREATE TABLE modifiers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) NOT NULL,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    inventory_item_id UUID REFERENCES raw_inventory(id) ON DELETE SET NULL,
    quantity_deducted NUMERIC(10, 3) DEFAULT 1.000
);

-- 6. SHIFTS
CREATE TABLE shifts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    cashier_name VARCHAR(100) NOT NULL,
    opening_cash NUMERIC(10, 2) NOT NULL,
    closing_cash NUMERIC(10, 2),
    status VARCHAR(20) DEFAULT 'OPEN',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- 7. ORDERS
CREATE TABLE orders (
    id UUID PRIMARY KEY,
    token_number INT NOT NULL,
    shift_id UUID REFERENCES shifts(id) ON DELETE SET NULL,
    order_type VARCHAR(20) NOT NULL,
    payment_method VARCHAR(30) NOT NULL,
    table_number VARCHAR(10),
    status VARCHAR(20) DEFAULT 'COMPLETED',
    subtotal NUMERIC(10, 2) NOT NULL,
    discount NUMERIC(10, 2) DEFAULT 0.00,
    net_total NUMERIC(10, 2) NOT NULL,
    foodpanda_commission_pct NUMERIC(5, 2) DEFAULT 0.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. ORDER ITEMS
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
    item_name VARCHAR(100) NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    quantity INT NOT NULL,
    total_price NUMERIC(10, 2) NOT NULL,
    modifiers_json JSONB DEFAULT '[]'::jsonb,
    deal_swaps_json JSONB DEFAULT '[]'::jsonb
);

-- 9. EXPENSES
CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    category VARCHAR(50) NOT NULL,
    amount NUMERIC(10, 2) NOT NULL,
    description TEXT,
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. SPOILAGE / WASTAGE LOGS
CREATE TABLE spoilage_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    spoilage_type VARCHAR(20) NOT NULL,
    inventory_item_id UUID REFERENCES raw_inventory(id) ON DELETE SET NULL,
    menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
    quantity NUMERIC(10, 3) NOT NULL,
    total_cost_loss NUMERIC(10, 2) NOT NULL,
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
