# Muchachos POS — Supabase & Vercel Production Settings Guide

This document contains the exact, step-by-step checklist of cloud settings required in **Supabase** and **Vercel** to ensure the Muchachos POS, Admin Portal, and Kitchen Display System (KDS) operate reliably in production.

---

## Part 1: Supabase Configuration

### 1. Realtime Replication (Crucial for Live KDS & Price Sync)
The POS and KDS rely on Supabase Realtime (PostgreSQL logical replication) to push instant notifications without page refreshes.

1. Open your **[Supabase Dashboard](https://supabase.com/dashboard)**.
2. Select your project (`qoeapcxyupyugqrmjcnp`).
3. In the left sidebar, navigate to **Database** → **Replication** (or **Database** → **Publications**).
4. Click on the `supabase_realtime` publication.
5. Ensure the following **8 tables** are toggled **ON** (`active`):

| Table Name | Purpose |
| :--- | :--- |
| `orders` | Live kitchen display queue & admin real-time sales monitor |
| `order_items` | Kitchen item completion status updates |
| `menu_items` | Instant price and item availability changes on POS terminals |
| `categories` | Real-time category order & additions |
| `raw_inventory` | Instant stock balance changes & low stock warning alerts |
| `recipes` | Ingredient deduction recipe updates |
| `deal_components` | Real-time combo deal package configurations |
| `system_settings` | Cross-device Kitchen Screen (KDS) On/Off sync |

> **Verification Tip**: If you edit a menu item price in Admin and the Cashier terminal does not update immediately, verify that `menu_items` has Realtime enabled.

---

### 2. Row Level Security (RLS) & Permissions
Muchachos POS uses an offline-first architecture. The physical Cashier POS and desktop app use the **public anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) to sync local Dexie transactions with Supabase. Cashiers log in via a local numeric PIN, not Supabase Auth accounts.

If RLS is enabled on tables without an open `anon` policy, offline orders will fail to sync with error: `42501 permission denied for table ...`.

#### Recommended Solution: Execute via Supabase SQL Editor
1. Go to **SQL Editor** in your Supabase Dashboard.
2. Click **+ New Query**.
3. Paste the following script and click **Run**:

```sql
-- Ensure all operational tables allow the POS anon client and Admin authenticated client to read and write
ALTER TABLE IF EXISTS cashier_shifts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cashiers DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS deal_components DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS expenses DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS foodpanda_payouts DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS inventory_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS menu_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS modifiers DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS raw_inventory DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS recipes DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS spoilage_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS system_settings DISABLE ROW LEVEL SECURITY;
```

*(Note: If your database uses strict compliance policies and you prefer keeping RLS enabled, run `CREATE POLICY "Allow anon all" ON public.<table_name> FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);` for each table above).*

---

### 3. Authentication Settings
The Owner Admin Portal (`/admin`) uses Supabase Auth via SSR cookies.

1. Navigate to **Authentication** → **Providers** → **Email**:
   - **Confirm email**: Set to **OFF / Disabled**.
   - *(If enabled, newly created owner accounts will be locked out until an email link is clicked).*
2. Navigate to **Authentication** → **URL Configuration**:
   - **Site URL**: `https://muchachos-f-8.vercel.app` (or your custom domain)
   - **Redirect URLs** (Add each of these):
     - `https://muchachos-f-8.vercel.app/**`
     - `http://localhost:3000/**`
     - `http://localhost:3001/**`
3. Navigate to **Authentication** → **Users**:
   - Verify that your Admin/Owner user account exists.
   - Confirm that the user status is **Confirmed** (if not, click the user and select **Auto Confirm User**).

---

### 4. API Credentials
Navigate to **Project Settings** → **API**:
- Copy the **Project URL**: Format must be `https://<project-ref>.supabase.co` *(Note: Must end in `.co`, not `.com`)*.
- Copy the **`anon` / `public` API key**: This key is safe to be exposed in frontend environments.

---

## Part 2: Vercel Configuration

### 1. Environment Variables
1. Open your **[Vercel Dashboard](https://vercel.com/dashboard)**.
2. Select the `muchachos` (or `muchachos-f-8`) project.
3. Go to **Settings** → **Environment Variables**.
4. Configure the following variables for all environments (**Production**, **Preview**, **Development**):

| Variable Name | Value | Description |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qoeapcxyupyugqrmjcnp.supabase.co` | Your Supabase project URL (no trailing slash, no quotes). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `sb_publishable_mLPEexIYJiYvLYUaBSf4Vw_eBJwya-d` *(or your anon jwt)* | Public anon client API key. |
| `NEXT_PUBLIC_APP_URL` | `https://muchachos-f-8.vercel.app` | Canonical app URL (used by Electron desktop app to load production). |
| `NEXT_PUBLIC_ADMIN_ONLY` | `false` | `false` permits POS and Admin web access. Set to `true` to restrict web visitors exclusively to `/admin`. |

> **Important**: After adding or modifying environment variables in Vercel, you **must trigger a Redeploy** (Deployments → click the latest deployment → **Redeploy**) for the variables to take effect in the built application.

---

### 2. General & Build Settings
Under **Settings** → **General**:
- **Framework Preset**: `Next.js`
- **Root Directory**: `./` (or leave blank)
- **Build Command**: `next build` (Default)
- **Output Directory**: `.next` (Default)
- **Install Command**: `npm install` (Default)
- **Node.js Version**: Select `20.x`

---

### 3. Domains & SSL
Under **Settings** → **Domains**:
- Production domain: e.g. `muchachos-f-8.vercel.app`
- If using a custom domain (e.g. `pos.muchachos.pk`):
  - Add CNAME record pointing to `cname.vercel-dns.com` in your DNS provider.
  - Vercel will automatically provision a free SSL certificate.

---

## Part 3: Verification & Smoke Test Checklist

Once the above settings are configured, verify the system using these four quick checks:

### Test 1: Admin Authentication
1. Navigate to `https://muchachos-f-8.vercel.app/admin` in an incognito window.
2. The system should automatically redirect you to `/login`.
3. Sign in with your owner email and password.
4. You should be redirected directly into the Admin Dashboard.

### Test 2: Kitchen Display System (Realtime Sync)
1. Open the Kitchen Display at `https://muchachos-f-8.vercel.app/kds` on a phone or tablet.
2. Open the POS terminal at `https://muchachos-f-8.vercel.app/pos` or the Windows desktop app.
3. Punch a test order and hit **Print & Checkout**.
4. The ticket should appear on the KDS screen **instantly without page reload**.

### Test 3: Menu Price Realtime Broadcast
1. In the Admin Dashboard (`/admin`), edit any menu item (e.g. change a burger price by 10 PKR).
2. Look at the Cashier POS screen: the price should update on the screen in real-time.

### Test 4: Offline-First Failover & Sync Recovery
1. Open the POS app, turn off Wi-Fi on the computer.
2. The connection badge in the top right will indicate **"Offline Mode (Local Storage)"**.
3. Place an order and complete checkout. Order saves locally with 0 errors.
4. Reconnect Wi-Fi:
   - Within 5–10 seconds, the sync engine will push the pending order upstream to Supabase.
   - The order will appear in Supabase and the Admin Live Orders Log.
