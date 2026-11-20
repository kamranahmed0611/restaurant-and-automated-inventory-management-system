# MUCHACHOS POS: STANDALONE ARCHITECTURE & DEPLOYMENT MASTER PLAN

## Executive Summary
This document specifies the exact implementation roadmap for the Muchachos POS single-restaurant deployment. The laptop app (Electron + Next.js standalone + Dexie.js) is the sole authority and offline writer.

---

## 1. Core Architecture Principles
1. **Single Source of Truth**: Local IndexedDB (via Dexie.js) on the counter laptop is the single writer.
2. **0ms Latency on Clicks**: No network `await` sits in checkout, void, recall, shift open/close, or admin edits.
3. **Multi-Window Support with PIN Control**:
   - Cashier POS window (PIN protected).
   - Admin Management window (Master PIN protected: `7788`).
   - Kitchen Display Screen (KDS) window (can be dragged and dropped onto a second monitor or TV).
   - Locking or closing any window operates in-place without spawning duplicate windows.
4. **Clean Decoupling of Cloud Mirror**:
   - Supabase will be a one-way mirror uploaded in the background.
   - Phone app (Vercel) will be view-only, custom-designed from scratch for mobile screens.

---

## 2. Implementation Modules Breakdown

### Module 1: PIN Security & Super Admin Reset
- **Cashier PIN**: Fast 4-digit PIN for register login (e.g. `1234`). Zero lockout delay for fast cashier switching.
- **Admin PIN**: 4-digit Master PIN (`7788`) to access Admin panel.
- **Super Admin Reset**:
  - Accessible via "Reset PIN" links on Cashier and Admin lock screens.
  - Requires entering Master Super Admin PIN `888888`.
  - Unlocks editing/resetting any Cashier PIN and the Admin Master PIN.

### Module 2: Receipt Printing & Keyboard Shortcuts
- **Checkout Modal**:
  - Pressing `Enter` confirms checkout and handles printing.
  - **Takeaway & Foodpanda**: `Enter` prints **both** Customer Receipt and Kitchen Order Ticket (KOT).
  - **Dine-In**: `Enter` prints **only** the Kitchen Order Ticket (KOT). Customer receipt is generated when the tab is settled.
- **Receipt Customization**:
  - Full receipt customization in Admin Settings: Store name, tagline, address, contact phone, header notes, footer notes, and tax/NTN details.
  - Preserves developer Teddops watermark.

### Module 3: Multi-Window & Multi-Monitor Support
- Configure Electron window management:
  - POS main window can spawn `/kds` into a separate, draggable window for dual-monitor operation.
  - POS can open `/admin` into an independent window with PIN verification.
  - Window close/sign-out locks the active window in-place without opening duplicate windows.

### Module 4: Order Numbering & Midnight Reset
- Token numbers reset to `1` automatically at **midnight (00:00:00)** each calendar day, regardless of shift count.
- Calendar day rollover tracked cleanly in Dexie.

### Module 5: Inventory Soft-Warning & Stock Reconciliation
- Checkout transactions deduct raw inventory and retail goods immediately.
- If ingredient stock drops to 0 or negative:
  - Sales are **never blocked** during rush hour.
  - Generates a soft "Low Stock" warning toast.
  - Flags negative balances in Admin Inventory so owner can reconcile once stock arrives.

### Module 6: Dine-In Table Management & Delta KOT Printing
- Active tables remain prominently pinned on POS header.
- **Re-Order / Delta Printing**:
  - When customer orders additional items on an open table, the new Kitchen Order Ticket prints **ONLY** the newly added items.
  - Retains the existing Order ID, Token Number, Table Number, and round count (e.g., "Round 2 - Addon").

### Module 7: Foodpanda 70% Net Revenue & Profit Accounting
- Foodpanda orders record gross sales with 30% commission accrual in Foodpanda Receivable account.
- P&L and Admin Overview compute revenue from the **70% net value** (`Gross * 0.70`).
- Gross profit calculated as `70% Net Revenue - COGS`.

### Module 8: Shift Close Drawer Expenses & Monthly Analytics
- When cashier closes shift in Z-Report modal:
  - System prompts to review and add any drawer expenses taken from the cash drawer during that shift.
  - Automatically subtracts drawer expenses from "Expected in Drawer".
- Monthly expense breakdown and analytics view in Admin Reports.

### Module 9: UI Overhaul & Bug Fixes
- **Fix Image 1 Glitch**:
  - `AdminMenuBuilder.tsx` category dropdown: Auto-seed default categories if empty, add `+ New Category` inline button, fix styling clash and input borders.
- **Fix Image 2 Glitch**:
  - Admin header layout collision: Prevent green "Live" status pill from colliding or overlapping with the "OVERVIEW" navigation tab on laptop screen sizes.
- **Laptop Polish**: High-contrast typography, clean 14-inch scaling, and responsive spacing.

### Module 10: Local Backup Picker & Day 1 Reset
- Native Electron folder dialog to choose backup directory (e.g. `C:\Muchachos-Backups`).
- Prompts for external USB backup.
- Day 1 / Factory Reset tool (PIN `7788` / `888888`): takes a verified JSON backup first, then clears test orders, shifts, and drawer history while preserving menu catalog and inventory.

### Module 11: Future Cloud Mirror & Mobile View-Only App
- Clean Supabase database schema without modifying triggers.
- Mobile PWA built from scratch with view-only permissions.
- Remote database wipe/reset utility with Super Admin authentication.

