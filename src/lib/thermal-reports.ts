"use client";

import { printHtmlContent } from "./receipt-printer";

export interface ReportItemMix {
  name: string;
  category?: string;
  quantity: number;
  revenue: number;
  cogs: number;
  profit: number;
}

export interface FinancialReportData {
  title: string; // e.g. "DAILY FINANCIAL REPORT (Z-REPORT)" or "MONTHLY P&L SUMMARY"
  periodLabel: string; // e.g. "Today (03 Oct 2026)" or "September 2026"
  generatedAt: string;
  generatedBy?: string;
  
  // Sales & Orders
  totalOrders: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  avgTicketSize: number;

  // Payment Breakdown
  paymentMethods: {
    cash: number;
    card: number;
    jazzcash: number;
    easypaisa: number;
    foodpandaGross: number;
    foodpandaNet: number;
  };

  // Expenses Breakdown
  expensesByCategory: { [category: string]: number };
  totalExpenses: number;
  drawerExpenses?: number;
  overheadExpenses?: number;

  // COGS & Profitability
  totalCogs: number;
  grossProfit: number;
  grossMarginPct: number;
  netProfit: number;
  netMarginPct: number;

  // Cash Drawer Reconciliation
  cashDrawer?: {
    openingCash: number;
    cashSales: number;
    cashExpenses: number;
    expectedCash: number;
    actualCash?: number;
    variance?: number;
  };

  // Sales Mix / Hot Selling
  topSellingItems: ReportItemMix[];
}

/**
 * Generates high-contrast, razor-sharp 80mm thermal receipt HTML
 * Specifically calibrated for the Speed-X SP-200U (USB, 220mm/s, 203 DPI, 72mm printable width, auto-cutter).
 * Uses standard 48-column monospace formatting with paper feed margins.
 */
export function generateThermal80mmReportHtml(data: FinancialReportData): string {
  const lineDivider = "-".repeat(48);
  const doubleDivider = "=".repeat(48);

  const formatCurrency = (val: number) => `Rs. ${Math.round(val).toLocaleString()}`;
  const padRight = (str: string, len: number) => (str.length > len ? str.slice(0, len) : str.padEnd(len, " "));
  const padLeft = (str: string, len: number) => (str.length > len ? str.slice(0, len) : str.padStart(len, " "));

  // Format two column row (Total 48 chars)
  const formatRow = (label: string, value: string) => {
    const valStr = value.toString();
    const availableLabelLen = 48 - valStr.length - 1;
    const cleanLabel = label.length > availableLabelLen ? label.slice(0, availableLabelLen) : label;
    return `${cleanLabel.padEnd(48 - valStr.length, ".")}${valStr}`;
  };

  // Format three column item row: Name (28) | Qty (6) | Total (14)
  const formatItemRow = (name: string, qty: number, total: number) => {
    const nameCol = padRight(name, 26);
    const qtyCol = padLeft(qty.toString(), 6);
    const totalCol = padLeft(formatCurrency(total), 16);
    return `${nameCol}${qtyCol}${totalCol}`;
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${data.title}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    @media print {
      body {
        margin: 0;
        padding: 0;
        background: #fff;
      }
      .page-break {
        page-break-before: always;
      }
    }
    body {
      font-family: 'Courier New', Courier, Consolas, monospace;
      font-size: 12px;
      line-height: 1.35;
      font-weight: 700;
      color: #000;
      background: #fff;
      width: 72mm;
      max-width: 72mm;
      margin: 0 auto;
      padding: 6mm 2mm 16mm 2mm;
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: 900; }
    .large { font-size: 15px; font-weight: 900; }
    .xlarge { font-size: 17px; font-weight: 900; }
    .small { font-size: 10px; font-weight: 600; }
    .pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: inherit;
    }
    .divider {
      border-top: 1px dashed #000;
      margin: 6px 0;
    }
    .double-divider {
      border-top: 2px solid #000;
      margin: 6px 0;
    }
    .section-title {
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      margin: 8px 0 4px 0;
      text-align: center;
      background: #eee;
      padding: 2px 0;
    }
    .row {
      display: flex;
      justify-content: space-between;
      margin: 2px 0;
    }
    .row .label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .value { text-align: right; font-weight: 900; white-space: nowrap; }
    .footer-spacing {
      height: 24mm; /* Standard feed spacing to clear physical auto-cutter blade */
    }
  </style>
</head>
<body>
  <!-- HEADER -->
  <div class="text-center">
    <div class="xlarge">MUCHACHOS</div>
    <div class="small">SMASH BURGERS &amp; FRIES</div>
    <div class="small">F-8 Markaz, Islamabad</div>
    <div class="small">POS Cash Register Terminal</div>
    <div class="double-divider"></div>
    <div class="large">${data.title}</div>
    <div class="bold">${data.periodLabel}</div>
    <div class="small">Generated: ${data.generatedAt}</div>
    ${data.generatedBy ? `<div class="small">Officer: ${data.generatedBy}</div>` : ''}
  </div>

  <div class="double-divider"></div>

  <!-- REVENUE & ORDERS SUMMARY -->
  <div class="section-title">REVENUE &amp; SALES SUMMARY</div>
  <div class="row"><span class="label">Total Orders Sold:</span><span class="value">${data.totalOrders}</span></div>
  <div class="row"><span class="label">Gross Sales:</span><span class="value">${formatCurrency(data.grossSales)}</span></div>
  <div class="row"><span class="label">Discounts Given:</span><span class="value">-${formatCurrency(data.discounts)}</span></div>
  <div class="divider"></div>
  <div class="row large"><span class="label">NET SALES:</span><span class="value">${formatCurrency(data.netSales)}</span></div>
  <div class="row"><span class="label">Average Ticket Size:</span><span class="value">${formatCurrency(data.avgTicketSize)}</span></div>

  <div class="double-divider"></div>

  <!-- PAYMENT CHANNELS -->
  <div class="section-title">PAYMENT CHANNELS</div>
  <div class="row"><span class="label">Cash in Register:</span><span class="value">${formatCurrency(data.paymentMethods.cash)}</span></div>
  <div class="row"><span class="label">Bank / POS Card:</span><span class="value">${formatCurrency(data.paymentMethods.card)}</span></div>
  <div class="row"><span class="label">JazzCash QR:</span><span class="value">${formatCurrency(data.paymentMethods.jazzcash)}</span></div>
  <div class="row"><span class="label">EasyPaisa QR:</span><span class="value">${formatCurrency(data.paymentMethods.easypaisa)}</span></div>
  <div class="divider"></div>
  <div class="row"><span class="label">Foodpanda Gross:</span><span class="value">${formatCurrency(data.paymentMethods.foodpandaGross)}</span></div>
  <div class="row"><span class="label">Foodpanda Net Payout:</span><span class="value">${formatCurrency(data.paymentMethods.foodpandaNet)}</span></div>

  <div class="double-divider"></div>

  <!-- EXPENSES & OUTFLOWS -->
  <div class="section-title">EXPENSES &amp; RUNNING COSTS</div>
  ${Object.keys(data.expensesByCategory).length === 0 ? `
    <div class="text-center small">No expenses logged for this period</div>
  ` : Object.entries(data.expensesByCategory).map(([cat, amount]) => `
    <div class="row"><span class="label">${cat}:</span><span class="value">-${formatCurrency(amount)}</span></div>
  `).join('')}
  <div class="divider"></div>
  <div class="row large"><span class="label">TOTAL EXPENSES:</span><span class="value">-${formatCurrency(data.totalExpenses)}</span></div>

  <div class="double-divider"></div>

  <!-- FINANCIAL PROFITABILITY & P&L -->
  <div class="section-title">P&amp;L PROFITABILITY</div>
  <div class="row"><span class="label">Net Revenue:</span><span class="value">${formatCurrency(data.netSales)}</span></div>
  <div class="row"><span class="label">Cost of Goods (COGS):</span><span class="value">-${formatCurrency(data.totalCogs)}</span></div>
  <div class="row"><span class="label">Gross Operating Profit:</span><span class="value">${formatCurrency(data.grossProfit)} (${data.grossMarginPct}%)</span></div>
  <div class="row"><span class="label">Less Expenses:</span><span class="value">-${formatCurrency(data.totalExpenses)}</span></div>
  <div class="double-divider"></div>
  <div class="row xlarge"><span class="label">NET PROFIT:</span><span class="value">${formatCurrency(data.netProfit)} (${data.netMarginPct}%)</span></div>
  <div class="double-divider"></div>

  ${data.cashDrawer ? `
    <!-- CASH DRAWER RECONCILIATION -->
    <div class="section-title">CASH DRAWER RECONCILIATION</div>
    <div class="row"><span class="label">Opening Cash Float:</span><span class="value">${formatCurrency(data.cashDrawer.openingCash)}</span></div>
    <div class="row"><span class="label">+ Cash Sales Collected:</span><span class="value">+${formatCurrency(data.cashDrawer.cashSales)}</span></div>
    <div class="row"><span class="label">- Drawer Cash Payouts:</span><span class="value">-${formatCurrency(data.cashDrawer.cashExpenses)}</span></div>
    <div class="divider"></div>
    <div class="row large"><span class="label">EXPECTED IN DRAWER:</span><span class="value">${formatCurrency(data.cashDrawer.expectedCash)}</span></div>
    ${data.cashDrawer.actualCash !== undefined ? `
      <div class="row"><span class="label">Actual Counted Cash:</span><span class="value">${formatCurrency(data.cashDrawer.actualCash)}</span></div>
      <div class="row bold"><span class="label">Cash Variance:</span><span class="value">${formatCurrency(data.cashDrawer.variance || 0)}</span></div>
    ` : ''}
    <div class="double-divider"></div>
  ` : ''}

  <!-- TOP HOT SELLING ITEMS -->
  <div class="section-title">TOP HOT SELLING ITEMS</div>
  <div style="font-size: 10px; margin-bottom: 4px;" class="bold">
    ${padRight("Item Name", 26)}${padLeft("Qty", 6)}${padLeft("Revenue", 16)}
  </div>
  <div class="divider"></div>
  ${data.topSellingItems.slice(0, 15).map((item, idx) => `
    <div class="small">
      ${formatItemRow(`${idx + 1}. ${item.name}`, item.quantity, item.revenue)}
    </div>
  `).join('')}

  <div class="double-divider"></div>

  <!-- FOOTER -->
  <div class="text-center small">
    <div>*** END OF REPORT ***</div>
    <div style="border-top: 1px dashed #000; margin-top: 5px; padding-top: 4px;">
      <div style="font-weight: 900; font-size: 10px;">SOFTWARE BY TEDDOPS</div>
      <div style="font-size: 8px; margin-top: 1px;">Custom POS &amp; Business Systems</div>
      <div style="font-weight: 800; font-size: 9px; font-family: monospace; margin-top: 2px;">+92 329 7267098 &bull; +92 323 5930559</div>
    </div>
  </div>

  <!-- Feed spacing to clear physical auto-cutter blade on thermal printer -->
  <div class="footer-spacing"></div>
</body>
</html>
  `.trim();
}

/**
 * Prints the 80mm financial report silently in Electron or via browser iframe
 */
export function print80mmFinancialReport(data: FinancialReportData) {
  const html = generateThermal80mmReportHtml(data);
  printHtmlContent(html);
}

