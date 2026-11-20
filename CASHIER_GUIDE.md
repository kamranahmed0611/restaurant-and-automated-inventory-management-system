# Muchachos POS - Cashier & Counter Staff Guide 🧾⚡

> **Quick-Start Counter Training Manual**  
> Keep this guide beside the POS terminal. It explains how to start your shift, punch orders, handle internet outages, and close your cash drawer accurately.

---

## 1. Starting Your Shift

1. **Launch the POS**: Open the Muchachos POS app on the counter laptop (or open Chrome to [https://muchachos-f-8.vercel.app/pos](https://muchachos-f-8.vercel.app/pos)).
2. **Select Your Name & Enter PIN**:
   - Tap your cashier name on the screen.
   - Enter your 4-digit PIN on the touch keypad.
3. **Opening Cash Float**:
   - The screen will prompt you to enter the starting cash in your drawer (e.g. Rs. 5,000 for change/coins).
   - Enter the exact amount and tap **"Start Shift"**.
   - Your cash drawer is now active and tracking all sales.

---

## 2. Taking Customer Orders

### A. Dine-In Orders (Customer eating in the restaurant)
1. Tap the **Dine-In** tab.
2. Select the customer's **Table Number** (e.g., Table 4).
3. Tap menu items to add them to the cart.
4. If an item has modifiers (e.g., Extra Cheese, Spicy, Sauce), pick the options.
5. Tap **"Send to Kitchen (KOT)"**:
   - A token number is generated (e.g., `#042`).
   - The kitchen display immediately rings and displays the cooking ticket.
6. When the customer is ready to pay, tap **"Checkout / Settle Bill"**, select the payment method (**Cash**, **Card**, **JazzCash**, or **EasyPaisa**), and tap **"Print Bill"**.

---

### B. Takeaway Orders (Counter pickup)
1. Tap the **Takeaway** tab.
2. Add the items to the cart.
3. Collect payment (Cash/Digital).
4. Tap **"Complete & Print Receipt"**.
5. Hand the printed token slip to the customer.

---

### C. Foodpanda Orders
1. Tap the **Foodpanda** tab.
2. Add the items ordered on the Foodpanda merchant app.
3. Tap **"Dispatch to Kitchen"**.
4. The system automatically tags the order as Foodpanda and accounts for the commission in the background.

---

## 3. What to Do If the Internet Goes Down (Offline Mode) 🌐❌

> 🚨 **IMPORTANT RULE: DO NOT PANIC AND DO NOT STOP SELLING!**  
> Muchachos POS is built to work 100% offline. You can continue taking orders even if the Wi-Fi or broadband cable is completely unplugged.

### How Offline Mode Works:
1. **Status Indicator**:
   - When connected: The sync dot is **Green** (Online & Synced).
   - When disconnected: The sync dot turns **Yellow / Amber** (Working Offline).
2. **Taking Orders Offline**:
   - Continue punching orders exactly as usual.
   - Customer bills will print immediately on the 80mm receipt printer.
   - The POS stores all orders securely inside the laptop's hard drive (`Dexie.js` Local Database).
3. **Automatic Reconnection & Sync**:
   - When the internet comes back on, the POS **automatically detects it**.
   - The system immediately uploads all offline orders to the cloud and syncs stock.
   - **No duplicate bills and no missing orders.** You do not need to refresh or restart the laptop.

---

## 4. Printing Receipts (Speed-X SP-200U Thermal Printer)

- **Customer Receipt**: Tap **"Print Bill"** at checkout. The 80mm printer will print the customer slip with store name, order breakdown, token number, and auto-cut the paper.
- **Paper Roll Replacement**:
  - Open the printer hood by lifting the lever on the right side.
  - Drop in a fresh 80mm thermal roll (ensure paper feeds from the bottom up).
  - Pull 2 inches of paper out and snap the lid shut.
- **Drawer Kick**: On cash transactions, the printer automatically sends a signal to pop open the metal cash drawer.

---

## 5. Ending Your Shift & Cash Reconciliation

At the end of your shift, before the next cashier takes over:

1. Tap your cashier name in the top bar and select **"Close Shift"**.
2. Count the physical cash in your drawer.
3. Enter the total cash counted into the **"Actual Cash Counted"** box.
4. Tap **"Submit & Print Shift Report"**:
   - The 80mm thermal printer will print an **End-of-Shift Summary Slip**.
   - It shows:
     - Starting Float
     - Cash Sales Collected
     - Digital Sales Collected (Cards / JazzCash / EasyPaisa)
     - Expenses paid from drawer
     - Expected Cash in Drawer vs Actual Cash Counted
     - Variance (Over / Short)
5. Place the printed slip inside the cash drawer with the collected money.
6. The terminal automatically logs out, ready for the next shift.

---

## 6. Counter Shortcuts & Quick Action Buttons

At the top of the counter screen, you have quick action buttons:

| Button | Shortcut | What It Does |
|---|---|---|
| **QUEUE** | <kbd>F2</kbd> | Opens the live kitchen order queue to see cooking progress and clear tokens. |
| **KDS** | — | Opens the Kitchen Display System in an extended window to drag to your kitchen TV. |
| **WASTE** | — | Logs spoiled or wasted food items directly to the inventory waste ledger. |
| **SHIFT** | — | Check active cash float, drawer balance, and shift duration. |
| **Theme** | <kbd>Alt</kbd> + <kbd>T</kbd> | Switches between High-Contrast Dark Mode and Crisp Light Mode. |

---

## 7. Customer Receipts & Technical Support

Every printed bill automatically includes the restaurant order breakdown and the official engineering support info at the bottom:
```text
------------------------------------------------
              SOFTWARE BY TEDDOPS
   Get POS & Custom Software For Your Business
      +92 329 7267098 • +92 323 5930559
```

If the printer or POS ever encounters an issue during busy rush hours:
- **Phone / WhatsApp**: `+92 329 7267098` &bull; `+92 323 5930559`
- **Email**: `teddopss@gmail.com`

