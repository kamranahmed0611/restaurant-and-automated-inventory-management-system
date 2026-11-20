# Muchachos POS — Deployment Verification Checklist

This one-page manual test protocol verifies the single-restaurant offline-first architecture before handover. Every test must be executed on the physical counter laptop.

---

## 1. Cold Boot & Offline Shift Run (Wi-Fi Off)
- [ ] **Step 1.1**: Turn off laptop Wi-Fi (or enable Airplane Mode). Unplug Ethernet.
- [ ] **Step 1.2**: Launch "Muchachos POS" from Desktop shortcut. Confirm app boots to POS screen without network warnings or hangs.
- [ ] **Step 1.3**: Start a new shift with starting float: **Rs. 5,000**. Confirm shift opens instantly.
- [ ] **Step 1.4**: Record raw inventory counts before sales for 3 test items (e.g., Burger Patty, Bun, Cheese Slice).
- [ ] **Step 1.5**: Sell 3 known items (e.g., 2 Classic Burgers, 1 Cheese Deal).
  - Verify Checkout completes in **0ms** (no network loader).
  - Verify KOT / Receipt prints with correct token number.
- [ ] **Step 1.6**: Void 1 order. Confirm reason prompt appears, order status becomes `CANCELLED`.
  - Check stock by hand math: voided items restocked **exactly once**.
  - Check inventory logs: restock transaction recorded.
- [ ] **Step 1.7**: Close Shift. Enter actual drawer cash.
  - Verify Z-report math: `Expected Cash = Starting Cash (5,000) + Cash Sales - Drawer Expenses`.
  - Expected cash must match manual tally.

---

## 2. Zero-Latency Click Paths (Offline & Bogus Network)
- [ ] **Step 2.1**: Test with Wi-Fi connected to a router with **no internet access** (air-gap test).
- [ ] **Step 2.2**: Perform Order Checkout — must be instant (Dexie transaction only, no pending await on Supabase).
- [ ] **Step 2.3**: Mark Order Ready in KDS — instant UI update.
- [ ] **Step 2.4**: Recall Order — instant tab restore.
- [ ] **Step 2.5**: Edit Menu item price or recipe in Admin — instant save to Dexie.
- [ ] **Step 2.6**: Log a Drawer Expense — instant deduction from expected cash.

---

## 3. Automated Backups & One-Click Restore
- [ ] **Step 3.1**: Verify backup file created in the configured backup folder on Shift Close.
  - File named: `muchachos-backup-YYYY-MM-DD_HH-mm.json`.
  - Contains manifest (schema version, timestamp, row counts, SHA-256 checksum).
- [ ] **Step 3.2**: Open Admin -> Database & Backups -> Restore tab.
  - Verify backup appears in the backup file list.
  - Click backup: manifest preview loads with table counts and checksum status.
- [ ] **Step 3.3**: Trigger "Restore from Backup":
  - Confirm automatic pre-restore safety backup is created first.
  - Dexie tables replaced atomically.
  - App reloads and orders/inventory totals match pre-restore state.

---

## 4. Cloud Mirror & Reconnection Sync
- [ ] **Step 4.1**: Reconnect laptop to active internet Wi-Fi.
- [ ] **Step 4.2**: Observe header badge: changes from `OFFLINE (N pending)` to `SYNCING` to `SYNCED`.
- [ ] **Step 4.3**: Open Sync Diagnostics modal:
  - Step 1: Checking Wi-Fi (probe) -> Step 2: Connecting -> Step 3: Uploading shifts -> Step 4: Uploading orders -> Step 5: Uploading inventory -> Step 6: Updating sync_meta.
  - All steps complete with checkmarks; `pending = 0`.
- [ ] **Step 4.4**: Verify Supabase cloud mirror:
  - No duplicate orders or inventory records created.
  - Every order retains its real `shift_id` (foreign key intact).
  - Cloud sales total == Laptop sales total.
- [ ] **Step 4.5**: Open Phone View (Vercel):
  - Dashboard shows **VIEW ONLY** banner.
  - Top badge displays: "Last synced: <time> (X min ago)".
  - Add/Edit/Delete/Checkout buttons are completely disabled or hidden.

---

## 5. PIN System & Security Verification
- [ ] **Step 5.1**: Cashier PIN entry: 4-digit PIN logs cashier into POS session.
- [ ] **Step 5.2**: Admin PIN entry: Admin PIN unlocks management panel.
- [ ] **Step 5.3**: Lockout test: Enter incorrect PIN 5 consecutive times.
  - Verify 60-second cooldown activates with countdown timer.
- [ ] **Step 5.4**: Emergency Reset:
  - Click "Forgot PIN? Emergency Reset (Super Admin)" on PIN modal.
  - Enter Super Admin master key (`888888`).
  - Set new Cashier or Admin PIN. Verify new PIN unlocks immediately.

---

## 6. Installer & Upgrade-in-Place Resilience
- [ ] **Step 6.1**: Install via `Muchachos POS Setup 0.1.0.exe` (NSIS).
  - Verify desktop shortcut and start menu shortcut created.
  - Verify app data lives in `%APPDATA%\muchachos-pos`.
- [ ] **Step 6.2**: Re-run the installer over the existing installation.
  - Verify previous orders, cashiers, and menu items remain 100% intact.
- [ ] **Step 6.3**: Cold boot without internet after installation.
  - Server starts on `127.0.0.1:31415`, single instance locked, DevTools closed.
