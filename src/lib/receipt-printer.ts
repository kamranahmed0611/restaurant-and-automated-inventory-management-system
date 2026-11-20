"use client";

import { Order, OrderItem } from "@/types/database";

export interface ReceiptSettings {
  storeName: string;
  tagline: string;
  address: string;
  phone: string;
  ntn: string;
  receiptFooter: string;
  paperWidth: '80mm' | '58mm';
  showQrCode: boolean;
  qrCodeUrl: string; // URL to payment QR code (JazzCash/EasyPaisa/Raast) or custom image
  autoPrintTakeaway: boolean; // Auto print KOT + Receipt on takeaway/foodpanda
  autoPrintDineInKot: boolean; // Auto print KOT on dine in open/add-on
  showBarcode?: boolean;
  showLogo?: boolean;
  qrNote?: string;
  customHeaderNote?: string;
  showTagline?: boolean;
  showAddress?: boolean;
  showPhone?: boolean;
  showNtn?: boolean;
  showCustomHeaderNote?: boolean;
  showTokenNumber?: boolean;
  showOrderType?: boolean;
  showDateTime?: boolean;
  showPaymentMethod?: boolean;
  showFooterMessage?: boolean;
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  storeName: "MUCHACHOS",
  tagline: "An Oasis Of Taste",
  address: "F-8 Markaz, Islamabad",
  phone: "0300-1234567",
  ntn: "NTN-9988776-5",
  receiptFooter: "Thank you for dining at Muchachos! Please visit again.",
  paperWidth: "80mm",
  showLogo: true,
  showTagline: true,
  showAddress: true,
  showPhone: true,
  showNtn: true,
  showCustomHeaderNote: true,
  showTokenNumber: true,
  showOrderType: true,
  showDateTime: true,
  showPaymentMethod: true,
  showQrCode: true,
  qrCodeUrl: "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MuchachosPayment",
  autoPrintTakeaway: false,
  autoPrintDineInKot: false,
  showBarcode: true,
  showFooterMessage: true,
  qrNote: "Raast • JazzCash • EasyPaisa",
  customHeaderNote: ""
};

const STORAGE_KEY = "muchachos_receipt_settings";

export function getReceiptSettings(): ReceiptSettings {
  if (typeof window === "undefined") return DEFAULT_RECEIPT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_RECEIPT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    console.error("Error reading receipt settings:", e);
  }
  return DEFAULT_RECEIPT_SETTINGS;
}

export function saveReceiptSettings(settings: Partial<ReceiptSettings>): ReceiptSettings {
  if (typeof window === "undefined") return DEFAULT_RECEIPT_SETTINGS;
  const current = getReceiptSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.error("Error saving receipt settings:", e);
  }
  return updated;
}

/**
 * Universal Silent / IFrame Thermal Printer Engine
 * - In Electron desktop app: Prints 100% silently via Chromium print API (no dialog)
 * - In Web / PWA browser: Uses hidden iframe print
 * Compatible with all thermal printers: 80mm & 58mm (Xprinter, Epson, Black Copper, Posiflex, etc.)
 */
export function printHtmlContent(htmlContent: string) {
  if (typeof window === "undefined") return;

  // 1. Electron Desktop App: Native silent printing without any dialog
  if (typeof window !== "undefined" && (window as any).electronAPI?.isElectron) {
    try {
      (window as any).electronAPI.printSilent({ html: htmlContent });
      return;
    } catch (err) {
      console.warn("[Printer] Electron silent print fallback to iframe:", err);
    }
  }

  // 2. Web / PWA fallback: Hidden iframe
  let iframe = document.getElementById("thermal-print-iframe") as HTMLIFrameElement;
  if (!iframe) {
    iframe = document.createElement("iframe");
    iframe.id = "thermal-print-iframe";
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);
  }

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  doc.open();
  doc.write(htmlContent);
  doc.close();

  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      console.error("Printing failed:", e);
    }
  }, 250);
}

/**
 * Trigger physical cash drawer kick pulse via RJ11 DK port on receipt printer.
 * Only active in Electron desktop mode.
 */
export function kickCashDrawer() {
  if (typeof window === "undefined") return;
  if ((window as any).electronAPI?.isElectron) {
    try {
      (window as any).electronAPI.kickCashDrawer();
    } catch (err) {
      console.warn("[Printer] Electron drawer kick failed:", err);
    }
  }
}

/**
 * 1. Print Kitchen Order Token (KOT)
 * Printed for the kitchen staff immediately upon sending order or add-ons.
 * Includes distinct, high-visibility packaging directives for DINE IN, TAKEAWAY, and FOODPANDA.
 */
export function printKitchenToken(
  order: any, 
  options: { items?: any[]; isAddon?: boolean; title?: string } = {}
) {
  const settings = getReceiptSettings();
  const itemsToPrint = options.items || order.items || order.order_items || [];
  const isAddon = options.isAddon || false;
  const tokenNumber = order.token_number ? order.token_number.toString().padStart(3, "0") : "000";
  const timeFormatted = new Date(order.created_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateFormatted = new Date(order.created_at || Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  const orderType = (order.order_type || 'TAKEAWAY').toUpperCase();

  // Distinct packaging directives & header themes
  let packingDirective = '>>> PACK IN TAKEAWAY BOXES + CARRY BAG <<<';
  let typeHeader = '🛍️ TAKEAWAY ORDER';

  if (orderType === 'DINE_IN') {
    packingDirective = '>>> SERVE ON DINE-IN TRAYS / PLATES <<<';
    typeHeader = `🍽️ DINE IN - TABLE ${order.table_number || 'OPEN'}`;
  } else if (orderType === 'FOODPANDA') {
    packingDirective = '>>> SEAL IN FOODPANDA DELIVERY BAG + STAPLE DISPATCH SLIP <<<';
    typeHeader = '🐼 FOODPANDA DELIVERY';
  }

  const is58mm = settings.paperWidth === '58mm';
  const widthStr = is58mm ? '54mm' : '76mm';
  const fontSize = is58mm ? '12px' : '14px';

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>KOT #${tokenNumber}</title>
        <style>
          @page {
            margin: 0;
            size: ${settings.paperWidth} auto;
          }
          @media print {
            html, body {
              width: ${widthStr} !important;
              max-width: ${widthStr} !important;
              margin: 0 auto !important;
              padding: 4px 6px 16px 6px !important;
              font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Courier New', monospace !important;
              font-size: ${fontSize} !important;
              font-weight: 800 !important;
              color: #000 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
          body {
            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Courier New', monospace;
            width: ${widthStr};
            margin: 0 auto;
            padding: 4px 4px 16px 4px;
            color: #000;
            background: #fff;
            font-size: ${fontSize};
            line-height: 1.25;
            font-weight: 700;
          }
          .center { text-align: center; }
          .bold { font-weight: 900; }
          .token-banner {
            border-top: 3px solid #000;
            border-bottom: 3px solid #000;
            padding: 6px 0;
            margin: 6px 0;
            text-align: center;
          }
          .token-title {
            font-size: ${is58mm ? '28px' : '36px'};
            font-weight: 900;
            margin: 0;
            letter-spacing: -1px;
          }
          .type-banner {
            background: #000;
            color: #fff;
            font-size: ${is58mm ? '12px' : '15px'};
            font-weight: 900;
            text-transform: uppercase;
            padding: 4px 2px;
            margin-top: 4px;
            letter-spacing: 0.5px;
          }
          .packing-box {
            border: 2px dashed #000;
            padding: 4px;
            margin: 6px 0;
            text-align: center;
            font-size: ${is58mm ? '10px' : '12px'};
            font-weight: 900;
          }
          .addon-alert {
            background: #000;
            color: #fff;
            padding: 4px 2px;
            font-weight: 900;
            text-align: center;
            margin: 4px 0;
            font-size: 13px;
          }
          .item-row {
            margin-bottom: 8px;
            padding-bottom: 6px;
            border-bottom: 1px dotted #666;
          }
          .item-main {
            font-weight: 900;
            font-size: ${is58mm ? '13px' : '16px'};
          }
          .modifier-row {
            font-size: ${is58mm ? '11px' : '13px'};
            font-weight: 800;
            padding-left: 12px;
            margin-top: 2px;
          }
          .footer-cut {
            margin-top: 15px;
            border-top: 2px dashed #000;
            text-align: center;
            font-size: 11px;
            padding-top: 6px;
            font-weight: 800;
          }
        </style>
      </head>
      <body>
        <div class="center bold" style="font-size: ${is58mm ? '13px' : '15px'};">
          ${options.title || "KITCHEN ORDER TICKET (KOT)"}
        </div>
        <div class="center" style="font-size: 11px;">
          ${settings.storeName} &bull; ${dateFormatted} ${timeFormatted}
        </div>

        ${isAddon ? '<div class="addon-alert">*** KOT ADD-ON TICKET (PREPARE NOW) ***</div>' : ''}

        <div class="token-banner">
          <div class="token-title">#${tokenNumber}</div>
          <div class="type-banner">${typeHeader}</div>
        </div>

        <div class="packing-box">
          ${packingDirective}
        </div>

        <div style="margin: 8px 0;">
          ${itemsToPrint.map((item: any) => `
            <div class="item-row">
              <div class="item-main">
                ${item.quantity}x ${item.item_name}
              </div>
              ${item.deal_swaps_json && item.deal_swaps_json.length > 0 ? `
                <div style="padding-left: 10px; margin-top: 2px;">
                  ${item.deal_swaps_json.map((comp: any) => `
                    <div style="font-size: ${is58mm ? '11px' : '13px'}; font-weight: 800;">
                      &bull; ${(comp.quantity || 1) * item.quantity}x ${comp.item_name}
                      ${comp.modifiers && comp.modifiers.length > 0 ? `
                        <span style="font-size: 10px; font-weight: bold;">
                          (${comp.modifiers.map((m: any) => `+${m.qty || 1} ${m.name}`).join(', ')})
                        </span>
                      ` : ''}
                    </div>
                  `).join('')}
                </div>
              ` : ''}
              ${item.modifiers_json && item.modifiers_json.length > 0 ? `
                <div>
                  ${item.modifiers_json.map((mod: any) => `
                    <div class="modifier-row">&bull; +${mod.qty || 1}x ${mod.name}</div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>

        <div class="footer-cut">
          *** END OF KOT (${itemsToPrint.length} ITEMS) ***
          <div style="height: 30px;"></div>
        </div>
      </body>
    </html>
  `;

  printHtmlContent(html);
}

/**
 * 2. Print Customer Bill / Foodpanda Dispatch Slip
 * - For FOODPANDA: Prints Foodpanda Dispatch Slip with ZERO prices, packing checklist, and rider instructions.
 * - For TAKEAWAY / DINE-IN: Prints complete itemized customer bill with prices, subtotal, net total, and payment QR.
 */
export function printCustomerReceipt(order: any, customSettings?: ReceiptSettings) {
  const settings = customSettings || getReceiptSettings();
  const items = order.items || order.order_items || [];
  const tokenNumber = order.token_number ? order.token_number.toString().padStart(3, "0") : "000";
  const timeFormatted = new Date(order.created_at || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateFormatted = new Date(order.created_at || Date.now()).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount || 0);
  const netTotal = Number(order.net_total || 0);
  const paymentMethod = (order.payment_method || "CASH").replace('_', ' ');
  const isFoodpanda = order.order_type === 'FOODPANDA';

  const is58mm = settings.paperWidth === '58mm';
  const widthStr = is58mm ? '54mm' : '76mm';
  const fontSize = is58mm ? '12px' : '14px';

  let html = '';

  if (isFoodpanda) {
    // ========================================================
    // FOODPANDA PACKING & DISPATCH SLIP (PRICES COMPLETELY HIDDEN)
    // ========================================================
    const totalItemQty = items.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 1), 0);

    html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Foodpanda Dispatch #${tokenNumber}</title>
          <style>
            @page {
              margin: 0;
              size: ${settings.paperWidth} auto;
            }
            @media print {
              html, body {
                width: ${widthStr} !important;
                max-width: ${widthStr} !important;
                margin: 0 auto !important;
                padding: 4px 6px 16px 6px !important;
                font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Courier New', monospace !important;
                font-size: ${fontSize} !important;
                font-weight: 700 !important;
                color: #000 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
            body {
              font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Courier New', monospace;
              width: ${widthStr};
              margin: 0 auto;
              padding: 4px 4px 16px 4px;
              color: #000;
              background: #fff;
              font-size: ${fontSize};
              line-height: 1.25;
              font-weight: 700;
            }
            .center { text-align: center; }
            .bold { font-weight: 900; }
            .fp-header-box {
              background: #000;
              color: #fff;
              text-align: center;
              font-weight: 900;
              font-size: ${is58mm ? '14px' : '17px'};
              padding: 6px 2px;
              margin: 4px 0;
              letter-spacing: 0.5px;
            }
            .token-block {
              border-top: 2px dashed #000;
              border-bottom: 2px dashed #000;
              padding: 6px 0;
              margin: 6px 0;
              text-align: center;
            }
            .token-lg {
              font-size: ${is58mm ? '28px' : '36px'};
              font-weight: 900;
              margin: 0;
            }
            .rider-warning {
              border: 2px solid #000;
              padding: 4px;
              margin: 6px 0;
              text-align: center;
              font-size: ${is58mm ? '11px' : '13px'};
              font-weight: 900;
            }
            .checklist-box {
              border: 1px dashed #000;
              padding: 5px;
              margin: 6px 0;
              font-size: 11px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin: 6px 0;
            }
            th {
              border-bottom: 2px solid #000;
              padding: 3px 0;
              font-size: 12px;
              text-align: left;
            }
            td {
              padding: 4px 0;
              vertical-align: top;
            }
            .divider { border-top: 1px dashed #000; margin: 6px 0; }
            .double-divider { border-top: 2px dashed #000; margin: 8px 0; }
          </style>
        </head>
        <body>
          <div class="center">
            <svg width="40" height="28" viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; margin: 0 auto 3px auto;">
              <text x="60" y="19" text-anchor="middle" fill="#000" font-family="'Brush Script MT', 'Comic Sans MS', cursive, sans-serif" font-weight="900" font-size="17" font-style="italic">YumYum!</text>
              <path d="M 43 56 C 43 30, 77 30, 77 56" stroke="#000" stroke-width="5" stroke-linecap="round" fill="none" />
              <path d="M 60 37 L 60 52" stroke="#000" stroke-width="3.5" stroke-linecap="round" />
              <circle cx="15" cy="36" r="4" fill="#000" />
              <circle cx="105" cy="36" r="4" fill="#000" />
              <path d="M 15 38 C 22 70, 43 65, 60 65 C 77 65, 98 70, 105 38" stroke="#000" stroke-width="5" stroke-linecap="round" fill="none" />
            </svg>
            <div style="font-size: ${is58mm ? '16px' : '20px'}; font-weight: 900;">${settings.storeName}</div>
            <div style="font-size: 10px; font-family: Georgia, serif; font-style: italic; margin-top: 1px;">${settings.tagline || 'An Oasis Of Taste'}</div>
            <div style="font-size: 10px;">${settings.address || "F-8 Markaz, Islamabad"}</div>
            ${settings.phone ? `<div style="font-size: 10px;">Ph: ${settings.phone}</div>` : ''}
          </div>

          <div class="fp-header-box">
            🐼 FOODPANDA DISPATCH SLIP 🐼
          </div>

          <div class="token-block">
            <div class="token-lg">#${tokenNumber}</div>
            <div style="font-size: 12px; font-weight: 900;">FOODPANDA DELIVERY</div>
            <div style="font-size: 10px; font-weight: normal; margin-top: 2px;">${dateFormatted} &bull; ${timeFormatted}</div>
          </div>

          <div class="checklist-box">
            <div style="font-weight: 900; text-decoration: underline; margin-bottom: 2px;">RIDER / PACKAGING CHECKLIST:</div>
            <div>[ ] All items verified in bag</div>
            <div>[ ] Sealed with Foodpanda security tape</div>
            <div>[ ] Staple this dispatch slip outside bag</div>
          </div>

          <div style="font-weight: 900; font-size: 12px; margin-top: 6px;">ITEMS TO PACK:</div>
          <table>
            <thead>
              <tr>
                <th style="width: 25%;">QTY</th>
                <th style="width: 75%;">ITEM NAME & MODIFIERS</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item: any) => `
                <tr style="border-bottom: 1px dotted #ccc;">
                  <td style="font-size: ${is58mm ? '14px' : '16px'}; font-weight: 900;">${item.quantity}x</td>
                  <td>
                    <div style="font-size: ${is58mm ? '13px' : '15px'}; font-weight: 900;">${item.item_name}</div>
                    ${item.deal_swaps_json && item.deal_swaps_json.length > 0 ? `
                      <div style="font-size: 11px; padding-left: 6px; color: #222; font-weight: bold; margin-top: 2px;">
                        ${item.deal_swaps_json.map((comp: any) => `
                          &bull; ${(comp.quantity || 1) * item.quantity}x ${comp.item_name}
                          ${comp.modifiers && comp.modifiers.length > 0 ? `
                            <span style="font-size: 10px;">(${comp.modifiers.map((m: any) => `+${m.qty || 1} ${m.name}`).join(', ')})</span>
                          ` : ''}
                        `).join('<br>')}
                      </div>
                    ` : ''}
                    ${item.modifiers_json && item.modifiers_json.length > 0 ? `
                      <div style="font-size: 11px; padding-left: 6px; color: #333; margin-top: 2px;">
                        ${item.modifiers_json.map((m: any) => `+ ${m.qty || 1}x ${m.name}`).join('<br>')}
                      </div>
                    ` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="divider"></div>

          <div style="display: flex; justify-content: space-between; font-weight: 900; font-size: 12px;">
            <span>Total Units Packed:</span>
            <span>${totalItemQty} items</span>
          </div>

          <div class="double-divider"></div>

          <div class="center" style="font-size: 10px; margin-top: 4px;">
            <div>Foodpanda Order Verified &bull; Internal Store Copy</div>
            <div style="border-top: 1px dashed #000; margin-top: 5px; padding-top: 4px;">
              <div style="font-weight: 900; font-size: 9px;">SOFTWARE BY TEDDOPS</div>
              <div style="font-size: 8px; font-weight: 800; font-family: monospace;">+92 329 7267098 &bull; +92 323 5930559</div>
            </div>
            <div style="height: 30px;"></div>
          </div>
        </body>
      </html>
    `;

  } else {
    // ========================================================
    // STANDARD CUSTOMER RECEIPT (TAKEAWAY / DINE-IN)
    // ========================================================
    html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Receipt #${tokenNumber}</title>
          <style>
            @page {
              margin: 0;
              size: ${settings.paperWidth} auto;
            }
            @media print {
              html, body {
                width: ${widthStr} !important;
                max-width: ${widthStr} !important;
                margin: 0 auto !important;
                padding: 4px 6px 16px 6px !important;
                font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Courier New', monospace !important;
                font-size: ${fontSize} !important;
                font-weight: 700 !important;
                color: #000 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
            }
            body {
              font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, 'Courier New', monospace;
              width: ${widthStr};
              margin: 0 auto;
              padding: 4px 4px 16px 4px;
              color: #000;
              background: #fff;
              font-size: ${fontSize};
              line-height: 1.25;
              font-weight: 700;
            }
            .center { text-align: center; }
            .right { text-align: right; }
            .bold { font-weight: 900; }
            .store-name {
              font-size: ${is58mm ? '18px' : '22px'};
              font-weight: 900;
              margin: 0;
              text-transform: uppercase;
            }
            .divider {
              border-top: 1px dashed #000;
              margin: 5px 0;
            }
            .double-divider {
              border-top: 2px dashed #000;
              margin: 6px 0;
            }
            table {
              width: 100%;
              border-collapse: collapse;
            }
            th {
              border-bottom: 2px solid #000;
              padding: 3px 0;
              font-size: 11px;
              text-align: left;
            }
            td {
              padding: 3px 0;
              vertical-align: top;
            }
            .net-total {
              font-size: ${is58mm ? '16px' : '20px'};
              font-weight: 900;
            }
            .qr-container {
              margin: 6px auto;
              text-align: center;
            }
            .qr-container img {
              width: 80px;
              height: 80px;
              display: inline-block;
            }
          </style>
        </head>
        <body>
          <div class="center">
            ${settings.showLogo !== false ? `
              <svg width="46" height="32" viewBox="0 0 120 84" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; margin: 0 auto 4px auto;">
                <text x="60" y="19" text-anchor="middle" fill="#000" font-family="'Brush Script MT', 'Comic Sans MS', cursive, sans-serif" font-weight="900" font-size="17" font-style="italic">YumYum!</text>
                <path d="M 43 56 C 43 30, 77 30, 77 56" stroke="#000" stroke-width="5" stroke-linecap="round" fill="none" />
                <path d="M 60 37 L 60 52" stroke="#000" stroke-width="3.5" stroke-linecap="round" />
                <circle cx="15" cy="36" r="4" fill="#000" />
                <circle cx="105" cy="36" r="4" fill="#000" />
                <path d="M 15 38 C 22 70, 43 65, 60 65 C 77 65, 98 70, 105 38" stroke="#000" stroke-width="5" stroke-linecap="round" fill="none" />
              </svg>
            ` : ''}
            <div class="store-name">${settings.storeName}</div>
            ${settings.showTagline !== false && settings.tagline ? `<div style="font-size: 11px; font-family: Georgia, serif; font-style: italic; letter-spacing: 0.5px; margin-top: 1px;">${settings.tagline}</div>` : ''}
            ${settings.showAddress !== false && settings.address ? `<div style="font-size: 10px;">${settings.address}</div>` : ''}
            ${settings.showPhone !== false && settings.phone ? `<div style="font-size: 10px;">Ph: ${settings.phone}</div>` : ''}
            ${settings.showNtn !== false && settings.ntn ? `<div style="font-size: 9px;">${settings.ntn}</div>` : ''}
            ${settings.showCustomHeaderNote !== false && settings.customHeaderNote ? `<div style="font-size: 10px; font-weight: bold; margin-top: 2px;">${settings.customHeaderNote}</div>` : ''}
          </div>

          <div class="divider"></div>

          <div style="font-size: 11px;">
            <div style="display: flex; justify-content: space-between;">
              ${settings.showTokenNumber !== false ? `<span>Token: <strong style="font-size: 13px;">#${tokenNumber}</strong></span>` : '<span></span>'}
              ${settings.showDateTime !== false ? `<span>Date: ${dateFormatted}</span>` : '<span></span>'}
            </div>
            <div style="display: flex; justify-content: space-between;">
              ${settings.showOrderType !== false ? `<span>Type: <strong>${(order.order_type || 'TAKEAWAY').replace('_', ' ')}${order.table_number ? ` (T${order.table_number})` : ''}</strong></span>` : '<span></span>'}
              ${settings.showDateTime !== false ? `<span>Time: ${timeFormatted}</span>` : '<span></span>'}
            </div>
          </div>

          <div class="double-divider"></div>

          ${order.amendment ? `
            <div style="background: #000; color: #fff; text-align: center; font-weight: 900; font-size: 11px; padding: 3px; margin: 4px 0;">
              *** AMENDED BILL ***
            </div>
          ` : ''}

          <table>
            <thead>
              <tr>
                <th style="width: 50%;">Item</th>
                <th class="center" style="width: 15%;">Qty</th>
                <th class="right" style="width: 35%;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${items.map((item: any) => {
                const itemTotal = Number(item.total_price || item.unit_price * item.quantity || 0);
                const isAddon = order.amendment && !item.is_original;
                return `
                  <tr>
                    <td class="bold">
                      ${item.item_name} ${isAddon ? '<span style="font-size: 8px; border: 1px solid #000; padding: 0 2px;">ADD-ON</span>' : ''}
                    </td>
                    <td class="center bold">${item.quantity}</td>
                    <td class="right bold">Rs. ${itemTotal.toFixed(0)}</td>
                  </tr>
                  ${item.deal_swaps_json && item.deal_swaps_json.length > 0 ? `
                    <tr>
                      <td colspan="3" style="padding-left: 8px; font-size: 10px; color: #222; font-weight: bold;">
                        ${item.deal_swaps_json.map((comp: any) => `
                          &bull; ${(comp.quantity || 1) * item.quantity}x ${comp.item_name}
                          ${comp.modifiers && comp.modifiers.length > 0 ? `
                            <span style="font-size: 9px; color: #555;">(${comp.modifiers.map((m: any) => `+${m.qty || 1} ${m.name}`).join(', ')})</span>
                          ` : ''}
                        `).join('<br>')}
                      </td>
                    </tr>
                  ` : ''}
                  ${item.modifiers_json && item.modifiers_json.length > 0 ? `
                    <tr>
                      <td colspan="3" style="padding-left: 8px; font-size: 10px; color: #333;">
                        ${item.modifiers_json.map((m: any) => `+ ${m.qty || 1}x ${m.name} (Rs. ${m.price || 0})`).join('<br>')}
                      </td>
                    </tr>
                  ` : ''}
                `;
              }).join('')}
            </tbody>
          </table>

          <div class="divider"></div>

          <div style="font-size: 11px;">
            <div style="display: flex; justify-content: space-between;">
              <span>Subtotal:</span>
              <span>Rs. ${subtotal.toFixed(0)}</span>
            </div>
            ${discount > 0 ? `
              <div style="display: flex; justify-content: space-between; font-weight: bold;">
                <span>Discount:</span>
                <span>-Rs. ${discount.toFixed(0)}</span>
              </div>
            ` : ''}
            ${order.amendment ? `
              <div style="border-top: 1px dashed #666; margin-top: 4px; padding-top: 4px;">
                <div style="display: flex; justify-content: space-between; color: #444;">
                  <span>Original Paid:</span>
                  <span>Rs. ${Number(order.amendment.originalNetTotal || 0).toFixed(0)}</span>
                </div>
                <div style="display: flex; justify-content: space-between; font-weight: bold;">
                  <span>Additional Balance Paid:</span>
                  <span>+Rs. ${Number(order.amendment.additionalBalanceDue || 0).toFixed(0)}</span>
                </div>
              </div>
            ` : ''}
          </div>

          <div class="double-divider"></div>

          <div style="display: flex; justify-content: space-between; align-items: center;" class="net-total">
            <span>NET TOTAL:</span>
            <span>Rs. ${netTotal.toFixed(0)}</span>
          </div>

          ${settings.showPaymentMethod !== false ? `
            <div style="margin-top: 4px; font-size: 11px; display: flex; justify-content: space-between;">
              <span>Payment Method:</span>
              <span class="bold">${paymentMethod}</span>
            </div>
          ` : ''}

          ${settings.showQrCode && settings.qrCodeUrl ? `
            <div class="qr-container">
              <img src="${settings.qrCodeUrl}" alt="Payment QR" />
              <div style="font-size: 9px; font-weight: bold;">${settings.qrNote || 'Scan to Pay via Raast / JazzCash / EasyPaisa'}</div>
            </div>
          ` : ''}

          ${settings.showBarcode !== false ? `
            <div style="text-align: center; margin: 6px 0; font-family: monospace; font-size: 11px; letter-spacing: 1px;">
              *MC-${tokenNumber}-${dateFormatted.replace(/\s+/g, '')}*
            </div>
          ` : ''}

          <div class="divider"></div>

          <div class="center" style="font-size: 10px; margin-top: 4px;">
            ${settings.showFooterMessage !== false && settings.receiptFooter ? `<div>${settings.receiptFooter}</div>` : ''}
            <div style="border-top: 1px dashed #000; margin-top: 6px; padding-top: 5px;">
              <div style="font-weight: 900; font-size: 10px; letter-spacing: 0.5px;">SOFTWARE BY TEDDOPS</div>
              <div style="font-size: 9px; font-weight: 700; margin-top: 1px;">Get POS &amp; Custom Software For Your Business</div>
              <div style="font-size: 9px; font-weight: 900; margin-top: 2px; font-family: monospace;">+92 329 7267098 &bull; +92 323 5930559</div>
            </div>
            <div style="height: 30px;"></div>
          </div>
        </body>
      </html>
    `;
  }

  printHtmlContent(html);
}

/**
 * 3. Combined KOT + Bill Printing
 * For Takeaway and Foodpanda orders: Prints KOT first, then customer / dispatch slip.
 */
export function printCombinedKotAndReceipt(order: any) {
  printKitchenToken(order);
  setTimeout(() => {
    printCustomerReceipt(order);
  }, 1000);
}

