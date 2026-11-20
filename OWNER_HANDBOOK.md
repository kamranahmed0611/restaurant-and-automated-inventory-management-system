# Muchachos POS - Owner & Manager Operating Manual 📱💼

> **Welcome to Muchachos POS!**  
> This guide covers everything you need to know to manage your restaurant, monitor live revenue from your phone, adjust menu prices, control stock, and print financial reports.

---

## 1. Accessing Your Owner Portal

You can access the Owner Portal from **any smartphone, tablet, or laptop** in the world:

- **Official Web Portal**: [https://muchachos-f-8.vercel.app/admin](https://muchachos-f-8.vercel.app/admin)
- **Login**: Enter your owner email and password at [https://muchachos-f-8.vercel.app/login](https://muchachos-f-8.vercel.app/login).
- **Tip**: On your iPhone (Safari) or Android (Chrome), tap **"Add to Home Screen"** to turn the portal into a clean mobile app icon on your phone!

---

## 2. Navigating the Mobile Portal

At the bottom of your phone screen, you have a floating navigation bar with 6 sections:

| Tab | Purpose |
|---|---|
| **Overview** | Live sales dashboard, today's revenue, profit margin, cash vs digital split. |
| **Orders** | Live kitchen order feed, ticket tokens, Dine-in vs Takeaway status. |
| **Reports** | Daily closing Z-Reports, Monthly P&L statements, 80mm thermal slip printing. |
| **Stock** | Real-time ingredient levels, low-stock warnings, restock logging. |
| **Menu** | Add new items, edit selling prices, edit cost prices (drinks/retail), create deals. |
| **Expenses** | Record daily operational costs (Meat, Vegetables, Packaging, Electricity, Rent). |

---

## 3. Real-Time Sales & Zero-Lag Date Switching

- **Today vs Active Shift**: At the top of the **Overview** page, switch between **"Today"** (combines all shifts from today) or **"Shift"** (only the cashier currently on duty).
- **Previous Dates**: Tap the date selector or use the `<` and `>` arrows to inspect any past day.
  - *Instant 0ms Speed*: Once you view a date, it is stored in fast memory. Switching back and forth happens in milliseconds without loading delays.
- **Foodpanda Switch**: Toggle the **"Foodpanda"** checkbox on or off. When on, it includes Foodpanda revenue minus commission. When off, it shows only physical cash/card in the cash drawer.

---

## 4. Menu & Retail Item Pricing (Dual Cost vs Sell Price)

To add or update items (like Burgers, Shawarmas, or Cold Drinks):

1. Tap **Menu** from the bottom navigation bar.
2. Select an item or tap **"+ New Menu Item"**.
3. **Selling Price**: What the customer pays (e.g. Rs. 110 for a drink).
4. **Cost Price (Purchase Price)**: What you bought it for (e.g. Rs. 90 for a drink).
5. **Profit Margin Calculation**: The software automatically calculates:
   $$\text{Profit Margin} = \text{Selling Price} - \text{Cost Price}$$
   Every time this item is sold (individually or in a deal combo), the software accurately computes your real kitchen profit and Cost of Goods Sold (COGS).

---

## 5. Printing 80mm Financial Reports (Thermal Printer)

You can print daily closing slips (Z-Reports) or monthly financial summaries directly on your in-store 80mm thermal receipt printer (e.g., Speed-X SP-200U):

1. Go to the **Reports** tab.
2. Select your timeframe:
   - **Today / Yesterday**: Generates the **Daily Closing Z-Report**.
   - **This Month / Last Month**: Generates the **Monthly P&L Statement**.
   - **Custom Range**: Pick any start and end date.
3. Tap **"Preview"** to review the formatted receipt on your screen.
4. Tap **"Print 80mm"**:
   - The printer prints the breakdown: Gross Sales, Discounts, Net Revenue, Payment settlement (Cash, Card, JazzCash, EasyPaisa, Foodpanda), Cash Drawer Variance, and Hot-Selling Menu Mix.
   - The auto-cutter automatically trims the receipt.

---

## 6. Staff & Cashier PIN Management

To prevent unauthorized counter actions, each cashier has their own 4-digit PIN:

1. Tap the **Settings** gear icon in the top header.
2. Select **"Cashier PIN Settings"**.
3. You can:
   - Add a new cashier name and assign a PIN.
   - Change an existing cashier's PIN.
   - Activate or deactivate a cashier.
4. **Immediate Remote Lockout**:
   - If you change a cashier's PIN from your phone, the cashier terminal **immediately locks them out** over the internet.
   - The cashier cannot enter any more orders until they type the new PIN you gave them.

---

## 7. Recording Daily Expenses

To get 100% accurate net profit calculations, record out-of-drawer purchases:

1. Tap **Expenses**.
2. Tap **"+ Add Expense"**.
3. Enter the Amount (e.g. Rs. 1,500), select the category (e.g. *Raw Materials / Dairy / Utilities*), and select whether it was paid from the **Cash Drawer** or personal bank.
4. The system immediately deducts this expense from the expected cash drawer total, preventing false cash shortage warnings at the end of the shift.

---

## 8. Low-Resolution Laptops & Screen Compatibility

The Muchachos POS interface is optimized for budget counter laptops with **1366x768** screen resolution and Windows 125% DPI display scaling:
- **Clean Responsive Layout**: The top header, category filter pills, and product grid automatically resize so the Cashier badge, Shift status, and Theme toggle are never pushed off-screen.
- **3 to 4 Full Rows of Products**: Compact card sizing ensures your staff can browse items quickly without vertical scrolling delays.

---

## 9. Kitchen Display System (KDS) & Multi-Monitor Setup

If you have a TV or second monitor in your kitchen:
1. On the counter laptop, tap the **"KDS"** button in the top navigation bar.
2. An independent kitchen window opens. Drag this window onto your kitchen TV or second screen.
3. As cashiers punch orders on the counter POS, cooking tickets and modifiers appear instantly on the kitchen display with sound chimes.

---

## 10. Permanent Bill Branding & Technical Support (Business Hours)

Every customer bill and shift report printed by the POS carries our official engineering credit at the end:
```text
------------------------------------------------
              SOFTWARE BY TEDDOPS
   Get POS & Custom Software For Your Business
      +92 329 7267098 • +92 323 5930559
```

If you ever need technical assistance, menu customizations, or hardware support:
- **Provider**: **Teddops Technologies**
- **Lead Engineers**: Engr. Maryam & Kamran
- **Support Hours**: Daily Business Hours (10:00 AM – 11:00 PM PKT)
- **Phone / WhatsApp**: `+92 329 7267098` &bull; `+92 323 5930559`
- **Email**: `teddopss@gmail.com`

