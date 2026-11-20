"use client";

import React, { useState, useEffect } from "react";
import { 
  Printer, X, QrCode, Sliders, CheckCircle2, 
  Receipt, UtensilsCrossed, Package
} from "lucide-react";
import { 
  getReceiptSettings, saveReceiptSettings, ReceiptSettings, 
  printCustomerReceipt, printKitchenToken 
} from "@/lib/receipt-printer";
import { MuchachosSymbol } from "./MuchachosBrand";
import ReceiptQrCode from "./ReceiptQrCode";

export interface AmendmentDetails {
  originalNetTotal: number;
  additionalBalanceDue: number;
  previousPaymentMethod: string;
}

interface ThermalReceiptPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: any;
  items?: any[];
  addonItems?: any[];
  amendmentInfo?: AmendmentDetails | null;
  initialTab?: 'RECEIPT' | 'KOT';
  onPrintCompleted?: () => void;
}

export default function ThermalReceiptPreviewModal({
  isOpen,
  onClose,
  order,
  items,
  addonItems,
  amendmentInfo,
  initialTab = 'RECEIPT',
  onPrintCompleted
}: ThermalReceiptPreviewModalProps) {
  const [activeTab, setActiveTab] = useState<'RECEIPT' | 'KOT'>(initialTab);
  const [settings, setSettings] = useState<ReceiptSettings>(getReceiptSettings());
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [printSuccess, setPrintSuccess] = useState<string | null>(null);
  const [paperWidth, setPaperWidth] = useState<'80mm' | '58mm'>(settings.paperWidth || '80mm');

  useEffect(() => {
    if (!isOpen) return;
    const current = getReceiptSettings();
    setSettings(current);
    setPaperWidth(current.paperWidth || '80mm');
    setActiveTab(initialTab);
    setPrintSuccess(null);
  }, [isOpen, initialTab]);

  const handlePrintKitchenOnly = () => {
    const orderItemsList = items || order?.items || order?.order_items || [];
    const kotItems = addonItems && addonItems.length > 0 ? addonItems : orderItemsList;
    printKitchenToken(order, { 
      items: kotItems, 
      isAddon: Boolean(amendmentInfo || (addonItems && addonItems.length > 0)),
      title: amendmentInfo ? "KOT ADD-ON TICKET" : undefined
    });
    setPrintSuccess("Kitchen token sent to printer!");
    setTimeout(() => {
      setPrintSuccess(null);
      if (onPrintCompleted) onPrintCompleted();
    }, 1500);
  };

  const handlePrintBoth = () => {
    const orderItemsList = items || order?.items || order?.order_items || [];
    const orderWithAmendment = amendmentInfo ? { ...order, amendment: amendmentInfo, items: orderItemsList } : { ...order, items: orderItemsList };
    const kotItems = addonItems && addonItems.length > 0 ? addonItems : orderItemsList;
    
    printKitchenToken(order, { 
      items: kotItems, 
      isAddon: Boolean(amendmentInfo || (addonItems && addonItems.length > 0)),
      title: amendmentInfo ? "KOT ADD-ON TICKET" : undefined
    });

    setTimeout(() => {
      printCustomerReceipt(orderWithAmendment, { ...settings, paperWidth });
      setPrintSuccess("KOT + Receipt sent to printer!");
      setTimeout(() => {
        setPrintSuccess(null);
        if (onPrintCompleted) onPrintCompleted();
      }, 1800);
    }, 800);
  };

  // Keyboard shortcut listener: Enter to Print, Escape to Close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && !isSettingsOpen) {
        e.preventDefault();
        const ot = (order?.order_type || 'TAKEAWAY').toUpperCase();
        if (ot === 'DINE_IN') {
          handlePrintKitchenOnly();
        } else {
          handlePrintBoth();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSettingsOpen, order, items, addonItems, amendmentInfo, settings, paperWidth]);

  if (!isOpen || !order) return null;

  const orderItems = items || order.items || order.order_items || [];
  const tokenNumber = order.token_number ? order.token_number.toString().padStart(3, "0") : "000";
  const orderTime = new Date(order.created_at || Date.now());
  const timeFormatted = orderTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateFormatted = orderTime.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const subtotal = Number(order.subtotal || orderItems.reduce((s: number, i: any) => s + (i.total_price || (i.unit_price * i.quantity) || 0), 0));
  const discount = Number(order.discount || 0);
  const netTotal = Number(order.net_total || (subtotal - discount));
  const paymentMethod = (order.payment_method || "CASH").replace('_', ' ');

  const orderType = (order.order_type || 'TAKEAWAY').toUpperCase();
  const isFoodpanda = orderType === 'FOODPANDA';
  const isDineIn = orderType === 'DINE_IN';

  const totalItemUnits = orderItems.reduce((sum: number, i: any) => sum + (Number(i.quantity) || 1), 0);

  const handleSettingChange = (key: keyof ReceiptSettings, value: any) => {
    const updated = saveReceiptSettings({ [key]: value });
    setSettings(updated);
    if (key === 'paperWidth') {
      setPaperWidth(value);
    }
  };

  const handlePrintSlip = () => {
    const orderWithAmendment = amendmentInfo ? { ...order, amendment: amendmentInfo, items: orderItems } : { ...order, items: orderItems };
    
    if (activeTab === 'RECEIPT') {
      printCustomerReceipt(orderWithAmendment, { ...settings, paperWidth });
      setPrintSuccess(isFoodpanda ? "Foodpanda Dispatch Slip sent to printer!" : "Customer receipt sent to printer!");
    } else {
      const kotItems = addonItems && addonItems.length > 0 ? addonItems : orderItems;
      printKitchenToken(order, { 
        items: kotItems, 
        isAddon: Boolean(amendmentInfo || (addonItems && addonItems.length > 0)),
        title: amendmentInfo ? "KOT ADD-ON TICKET" : undefined
      });
      setPrintSuccess("Kitchen token sent to printer!");
    }

    setTimeout(() => {
      setPrintSuccess(null);
      if (onPrintCompleted) onPrintCompleted();
    }, 1500);
  };

  const is58 = paperWidth === '58mm';
  const paperWidthClass = is58 ? 'w-[270px]' : 'w-[340px]';
  const teethCount = is58 ? 27 : 34;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in select-none">
      <div className="relative w-full max-w-lg my-auto max-h-[92vh] flex flex-col rounded-3xl bg-slate-900 border border-slate-700/80 shadow-2xl overflow-hidden text-white">
        
        {/* Top Header Bar */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-800 bg-slate-950 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
              <Printer className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-black tracking-tight text-white">
                  Thermal Receipt Preview
                </h3>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-800 text-slate-200 border border-slate-700">
                  Token #{tokenNumber}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                {orderType.replace('_', ' ')} {order.table_number ? `• Table ${order.table_number}` : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 80mm vs 58mm Paper Toggle */}
            <div className="flex items-center bg-slate-800/90 border border-slate-700 rounded-xl p-0.5 text-xs font-bold">
              <button
                onClick={() => handleSettingChange('paperWidth', '80mm')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                  paperWidth === '80mm' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                80mm
              </button>
              <button
                onClick={() => handleSettingChange('paperWidth', '58mm')}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                  paperWidth === '58mm' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                58mm
              </button>
            </div>

            {/* Quick Edit Slip Toggle */}
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                isSettingsOpen ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
              }`}
              title="Edit Store Name, Phone, NTN, QR Code on slip"
            >
              <Sliders className="w-4 h-4" />
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick Settings Drawer (When expanded) */}
        {isSettingsOpen && (
          <div className="bg-slate-950/98 border-b border-slate-800 p-3 sm:p-4 animate-in slide-in-from-top duration-150 text-xs shrink-0 max-h-72 overflow-y-auto">
            <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-slate-800">
              <span className="text-[11px] font-black uppercase text-amber-400 tracking-wider">
                Full Bill Customizer (Instant Live Sync)
              </span>
              <span className="text-[10px] text-slate-400">
                Edits apply to screen preview &amp; printer instantly
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Store / Brand Name</label>
                <input
                  type="text"
                  value={settings.storeName}
                  onChange={(e) => handleSettingChange('storeName', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-medium outline-none text-xs focus:border-blue-500"
                  placeholder="MUCHACHOS"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Tagline / Subtitle</label>
                  <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-400">
                    <input 
                      type="checkbox"
                      checked={settings.showTagline !== false}
                      onChange={(e) => handleSettingChange('showTagline', e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3 h-3"
                    />
                    <span>Print</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={settings.tagline || ''}
                  onChange={(e) => handleSettingChange('tagline', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-medium outline-none text-xs focus:border-blue-500"
                  placeholder="Real Mexican & Fast Food"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Branch Address</label>
                  <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-400">
                    <input 
                      type="checkbox"
                      checked={settings.showAddress !== false}
                      onChange={(e) => handleSettingChange('showAddress', e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3 h-3"
                    />
                    <span>Print</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={settings.address || ''}
                  onChange={(e) => handleSettingChange('address', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-medium outline-none text-xs focus:border-blue-500"
                  placeholder="F-8 Markaz, Islamabad"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Phone Number</label>
                  <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-400">
                    <input 
                      type="checkbox"
                      checked={settings.showPhone !== false}
                      onChange={(e) => handleSettingChange('showPhone', e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3 h-3"
                    />
                    <span>Print</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={settings.phone || ''}
                  onChange={(e) => handleSettingChange('phone', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-medium outline-none text-xs focus:border-blue-500"
                  placeholder="0300-1234567"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">NTN / STRN Tax ID</label>
                  <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-400">
                    <input 
                      type="checkbox"
                      checked={settings.showNtn !== false}
                      onChange={(e) => handleSettingChange('showNtn', e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3 h-3"
                    />
                    <span>Print</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={settings.ntn || ''}
                  onChange={(e) => handleSettingChange('ntn', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-medium outline-none text-xs focus:border-blue-500"
                  placeholder="NTN-9988776-5"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Receipt Footer Message</label>
                  <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-400">
                    <input 
                      type="checkbox"
                      checked={settings.showFooterMessage !== false}
                      onChange={(e) => handleSettingChange('showFooterMessage', e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3 h-3"
                    />
                    <span>Print</span>
                  </label>
                </div>
                <input
                  type="text"
                  value={settings.receiptFooter || ''}
                  onChange={(e) => handleSettingChange('receiptFooter', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-medium outline-none text-xs focus:border-blue-500"
                  placeholder="Thank you for dining at Muchachos!"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Payment QR Note</label>
                <input
                  type="text"
                  value={settings.qrNote || 'Raast • JazzCash • EasyPaisa'}
                  onChange={(e) => handleSettingChange('qrNote', e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-white font-medium outline-none text-xs focus:border-blue-500"
                  placeholder="Raast • JazzCash • EasyPaisa"
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Payment QR String / URL</label>
                <div className="flex items-center gap-1.5">
                  <label className="flex items-center gap-1 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={settings.showQrCode}
                      onChange={(e) => handleSettingChange('showQrCode', e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3.5 h-3.5"
                    />
                    <span className="text-[11px] font-bold">QR</span>
                  </label>
                  {settings.showQrCode && (
                    <input
                      type="text"
                      value={settings.qrCodeUrl || ''}
                      onChange={(e) => handleSettingChange('qrCodeUrl', e.target.value)}
                      className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-white font-mono text-[10px] outline-none focus:border-blue-500"
                      placeholder="Account number or pay link"
                    />
                  )}
                </div>
              </div>

              <div className="col-span-1 sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-4 pt-2 border-t border-slate-800">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={settings.showLogo !== false}
                    onChange={(e) => handleSettingChange('showLogo', e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3.5 h-3.5"
                  />
                  <span>Show Logo</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={settings.showBarcode !== false}
                    onChange={(e) => handleSettingChange('showBarcode', e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3.5 h-3.5"
                  />
                  <span>Show Barcode</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={settings.showTokenNumber !== false}
                    onChange={(e) => handleSettingChange('showTokenNumber', e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3.5 h-3.5"
                  />
                  <span>Show Token</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={settings.showOrderType !== false}
                    onChange={(e) => handleSettingChange('showOrderType', e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3.5 h-3.5"
                  />
                  <span>Show Type</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={settings.showDateTime !== false}
                    onChange={(e) => handleSettingChange('showDateTime', e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3.5 h-3.5"
                  />
                  <span>Show Date/Time</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={settings.showPaymentMethod !== false}
                    onChange={(e) => handleSettingChange('showPaymentMethod', e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-blue-500 w-3.5 h-3.5"
                  />
                  <span>Show Payment Method</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Tab Selector */}
        <div className="flex items-center justify-center p-2.5 bg-slate-950/80 border-b border-slate-800 shrink-0">
          <div className="inline-flex items-center bg-slate-900 p-1 rounded-2xl border border-slate-800 gap-1">
            <button
              onClick={() => setActiveTab('RECEIPT')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl font-black text-xs transition-all cursor-pointer ${
                activeTab === 'RECEIPT'
                  ? isFoodpanda ? 'bg-pink-600 text-white shadow-sm' : 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {isFoodpanda ? <Package className="w-3.5 h-3.5" /> : <Receipt className="w-3.5 h-3.5" />}
              <span>{isFoodpanda ? 'Foodpanda Dispatch Slip' : 'Customer Receipt'}</span>
              {amendmentInfo && <span className="bg-amber-400 text-slate-950 text-[9px] px-1.5 py-0.2 rounded font-black">AMENDED</span>}
            </button>

            <button
              onClick={() => setActiveTab('KOT')}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-xl font-black text-xs transition-all cursor-pointer ${
                activeTab === 'KOT'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <UtensilsCrossed className="w-3.5 h-3.5" />
              <span>Kitchen Token (KOT)</span>
              {(amendmentInfo || (addonItems && addonItems.length > 0)) && (
                <span className="bg-white text-slate-950 text-[9px] px-1.5 py-0.2 rounded font-black">ADD-ON</span>
              )}
            </button>
          </div>
        </div>

        {/* Main Preview: Realistic Cropped Thermal Slip */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-950/90 flex items-start justify-center">
          <div className={`transition-all duration-200 select-text ${paperWidthClass}`}>
            
            {/* Top Cutter Teeth (Realistic Paper Tear Notch) */}
            <div className="w-full h-3 flex overflow-hidden">
              {Array.from({ length: teethCount }).map((_, i) => (
                <div 
                  key={i} 
                  className="w-2.5 h-3 bg-[#FAFAFA]"
                  style={{ clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' }}
                />
              ))}
            </div>

            {/* Thermal Paper Body */}
            <div className="bg-[#FAFAFA] text-zinc-900 px-4 sm:px-5 py-4 shadow-2xl border-x border-zinc-200 font-mono leading-tight text-xs">
              
              {activeTab === 'RECEIPT' ? (
                isFoodpanda ? (
                  /* ========================================================= */
                  /* FOODPANDA DISPATCH & PACKING SLIP                         */
                  /* ========================================================= */
                  <div>
                    <div className="text-center py-1">
                      {settings.showLogo !== false && (
                        <div className="inline-flex items-center justify-center w-10 h-10 rounded-2xl bg-black text-white p-1 mb-1.5 shadow-xs">
                          <MuchachosSymbol size={26} color="#FFFFFF" />
                        </div>
                      )}
                      <h2 className="text-lg font-black tracking-wider uppercase text-black font-sans leading-none">
                        {settings.storeName || "MUCHACHOS"}
                      </h2>
                      <p className="text-[10px] font-bold text-zinc-700 tracking-wide mt-1 uppercase">
                        {settings.tagline || "Real Mexican & Fast Food"}
                      </p>
                      <p className="text-[10px] text-zinc-600 mt-0.5">{settings.address || "F-8 Markaz, Islamabad"}</p>
                      {settings.phone && <p className="text-[10px] text-zinc-800 font-bold mt-0.5">Ph: {settings.phone}</p>}
                    </div>

                    <div className="bg-black text-white text-center py-1.5 font-black text-xs uppercase tracking-wider my-2 rounded">
                      🐼 FOODPANDA DISPATCH SLIP 🐼
                    </div>

                    <div className="border-y-2 border-dashed border-black py-2 my-2 text-center">
                      <div className="text-[10px] font-black uppercase text-zinc-500">DISPATCH TOKEN</div>
                      <div className="text-3xl font-black text-black leading-tight">#{tokenNumber}</div>
                      <div className="text-[10px] font-bold text-zinc-600 mt-0.5">{dateFormatted} &bull; {timeFormatted}</div>
                    </div>

                    <div className="border border-dashed border-black p-2 my-2 text-[10px] space-y-0.5 bg-zinc-100 rounded">
                      <div className="font-black underline mb-1">PACKAGING &amp; DISPATCH CHECKLIST:</div>
                      <div>[ ] All items verified in bag</div>
                      <div>[ ] Sealed with Foodpanda security tape</div>
                      <div>[ ] Staple this dispatch slip to outside of bag</div>
                    </div>

                    <div className="font-black text-xs uppercase mt-3 mb-1 text-black">
                      ITEMS TO PACK:
                    </div>

                    <div className="border-t-2 border-black divide-y divide-dotted divide-zinc-300 py-1">
                      {orderItems.map((item: any, idx: number) => (
                        <div key={item.id || idx} className="py-1.5">
                          <div className="flex items-start gap-2">
                            <span className="font-black text-sm bg-black text-white px-1.5 py-0.5 rounded text-[11px] shrink-0">
                              {item.quantity}x
                            </span>
                            <span className="font-black text-sm text-black flex-1 leading-tight">{item.item_name}</span>
                          </div>
                          {item.deal_swaps_json && item.deal_swaps_json.length > 0 && (
                            <div className="pl-6 mt-1 space-y-0.5 text-[10px] text-zinc-800 font-bold">
                              {item.deal_swaps_json.map((comp: any, cIdx: number) => (
                                <div key={cIdx}>
                                  &bull; {(comp.quantity || 1) * item.quantity}x {comp.item_name}
                                </div>
                              ))}
                            </div>
                          )}
                          {item.modifiers_json && item.modifiers_json.length > 0 && (
                            <div className="pl-6 mt-0.5 space-y-0.5 text-[10px] text-zinc-700 font-bold">
                              {item.modifiers_json.map((m: any, mIdx: number) => (
                                <div key={mIdx}>+ {m.qty || 1}x {m.name}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="border-t-2 border-black mt-2 pt-2 flex justify-between font-black text-xs">
                      <span>TOTAL PACKED UNITS:</span>
                      <span>{totalItemUnits} items</span>
                    </div>

                    {/* Barcode Simulation */}
                    {settings.showBarcode !== false && (
                      <div className="my-3 text-center">
                        <div className="inline-flex items-center justify-center gap-[2px] h-7 px-2 bg-white border border-zinc-200">
                          {[2,1,3,1,1,4,2,1,2,3,1,2,4,1,1,3,2,1,4,1,2,3,1,2,3,1,4,1].map((w, idx) => (
                            <div key={idx} className="bg-black h-full" style={{ width: `${w * 1.3}px` }} />
                          ))}
                        </div>
                        <div className="text-[8px] font-mono tracking-widest text-zinc-500 mt-0.5">
                          *FP-{tokenNumber}-{dateFormatted.replace(/\s+/g, '')}*
                        </div>
                      </div>
                    )}

                    <div className="border-t border-dashed border-zinc-400 mt-2 pt-2 text-center space-y-0.5 text-[9px] text-zinc-600">
                      <div>Foodpanda Order Verified &bull; Internal Store Record</div>
                      <div className="font-bold text-black">SOFTWARE BY TEDDOPS &bull; +92 329 7267098 &bull; +92 323 5930559</div>
                    </div>
                  </div>
                ) : (
                  /* ========================================================= */
                  /* STANDARD CUSTOMER BILL (TAKEAWAY / DINE-IN)               */
                  /* ========================================================= */
                  <div>
                    {/* Header */}
                    <div className="text-center py-1">
                      {settings.showLogo !== false && (
                        <div className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-black text-white p-1 mb-1.5 shadow-xs">
                          <MuchachosSymbol size={28} color="#FFFFFF" />
                        </div>
                      )}
                      <h2 className="text-xl font-black tracking-wider uppercase text-black font-sans leading-none">
                        {settings.storeName || "MUCHACHOS"}
                      </h2>
                      {settings.showTagline !== false && settings.tagline && (
                        <p className="text-[11px] font-bold text-zinc-800 tracking-wide mt-1 uppercase">
                          {settings.tagline}
                        </p>
                      )}
                      {settings.showAddress !== false && settings.address && (
                        <p className="text-[10px] text-zinc-600 mt-0.5">{settings.address}</p>
                      )}
                      <div className="flex items-center justify-center gap-2 text-[10px] text-zinc-700 font-bold mt-0.5">
                        {settings.showPhone !== false && settings.phone && <span>Ph: {settings.phone}</span>}
                        {settings.showNtn !== false && settings.ntn && <span>&bull; NTN: {settings.ntn}</span>}
                      </div>
                    </div>

                    {/* Prominent High-Contrast Order Banner */}
                    <div className="border-y-2 border-dashed border-black py-2 my-2.5 text-center">
                      {settings.showTokenNumber !== false && (
                        <>
                          <div className="text-[10px] font-black uppercase tracking-widest text-zinc-500">ORDER TOKEN</div>
                          <div className="text-3xl font-black text-black tracking-tight leading-none my-1">
                            #{tokenNumber}
                          </div>
                        </>
                      )}
                      <div className="flex items-center justify-center gap-2 text-[11px] font-black uppercase text-black">
                        {settings.showOrderType !== false && (
                          <span className="bg-black text-white px-2 py-0.5 rounded text-[10px] tracking-wider">
                            {orderType.replace('_', ' ')}
                          </span>
                        )}
                        {order.table_number && <span>TABLE {order.table_number}</span>}
                        {settings.showDateTime !== false && <span className="text-zinc-600 font-normal">&bull; {timeFormatted}</span>}
                      </div>
                      {settings.showDateTime !== false && (
                        <div className="text-[9px] text-zinc-500 mt-1 font-mono">{dateFormatted}</div>
                      )}
                    </div>

                    {amendmentInfo && (
                      <div className="my-2 bg-amber-400 text-black text-center py-1 font-black text-xs uppercase tracking-wider rounded border border-black">
                        *** AMENDED BILL ***
                      </div>
                    )}

                    {/* Itemized Table */}
                    <div>
                      <div className="border-b-2 border-black pb-1 mb-1.5 flex justify-between text-[11px] font-black uppercase text-black tracking-wider">
                        <span className="flex-1">ITEM</span>
                        <span className="w-10 text-center">QTY</span>
                        <span className="w-18 text-right">TOTAL</span>
                      </div>

                      <div className="divide-y divide-dotted divide-zinc-200 py-0.5">
                        {orderItems.map((item: any, idx: number) => {
                          const itemTotal = Number(item.total_price || (item.unit_price * item.quantity) || 0);
                          const isNewAddon = !item.is_original && amendmentInfo;

                          return (
                            <div key={item.id || idx} className="py-1">
                              <div className="flex justify-between items-baseline font-bold text-xs text-black">
                                <div className="flex-1 pr-1 leading-tight">
                                  <span className="font-black">{item.item_name}</span>
                                  {isNewAddon && (
                                    <span className="ml-1 text-[8px] bg-amber-300 text-black border border-black px-1 rounded font-black">
                                      ADD-ON
                                    </span>
                                  )}
                                </div>
                                <span className="w-10 text-center font-black">{item.quantity}</span>
                                <span className="w-18 text-right font-black">Rs. {itemTotal.toLocaleString()}</span>
                              </div>

                              {/* Deal Swaps / Constituents */}
                              {item.deal_swaps_json && item.deal_swaps_json.length > 0 && (
                                <div className="pl-2 mt-1 space-y-0.5 text-[10px] text-zinc-700 font-mono">
                                  {item.deal_swaps_json.map((comp: any, cIdx: number) => (
                                    <div key={cIdx} className="flex items-center gap-1">
                                      <span className="text-zinc-400">└</span>
                                      <span className="font-bold">{(comp.quantity || 1) * item.quantity}x {comp.item_name}</span>
                                      {comp.modifiers && comp.modifiers.length > 0 && (
                                        <span className="text-zinc-500 font-normal">
                                          ({comp.modifiers.map((m: any) => `+${m.name}`).join(', ')})
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {/* Modifiers */}
                              {item.modifiers_json && item.modifiers_json.length > 0 && (
                                <div className="pl-2 mt-0.5 space-y-0.5 text-[10px] text-zinc-700 font-mono">
                                  {item.modifiers_json.map((m: any, mIdx: number) => (
                                    <div key={m.modifier_id || mIdx} className="flex items-center gap-1">
                                      <span className="text-zinc-400">+</span>
                                      <span>{m.qty || 1}x {m.name}</span>
                                      {m.price ? <span className="text-zinc-500">(Rs. {m.price})</span> : null}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Subtotal & Discount */}
                    <div className="border-t border-dashed border-zinc-400 pt-2 mt-2 space-y-1 text-xs">
                      <div className="flex justify-between font-bold text-zinc-700">
                        <span>Subtotal:</span>
                        <span className="text-black font-black">Rs. {subtotal.toLocaleString()}</span>
                      </div>
                      {discount > 0 && (
                        <div className="flex justify-between font-bold text-red-600">
                          <span>Discount:</span>
                          <span>-Rs. {discount.toLocaleString()}</span>
                        </div>
                      )}
                    </div>

                    {/* Amendment Breakdown */}
                    {amendmentInfo && (
                      <div className="bg-zinc-100 p-2 rounded-lg border border-zinc-300 my-2 space-y-1 text-xs">
                        <div className="flex justify-between text-zinc-600">
                          <span>Original Paid:</span>
                          <span className="font-bold">Rs. {amendmentInfo.originalNetTotal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between font-black text-black">
                          <span>Additional Balance Paid:</span>
                          <span>+Rs. {amendmentInfo.additionalBalanceDue.toLocaleString()}</span>
                        </div>
                      </div>
                    )}

                    {/* Net Total & Payment Status */}
                    <div className="border-t-2 border-black pt-2 mt-2">
                      <div className="flex justify-between items-baseline">
                        <span className="text-xs font-black uppercase tracking-wider text-black">NET PAYABLE:</span>
                        <span className="text-lg font-black text-black tracking-tight">Rs. {netTotal.toLocaleString()}</span>
                      </div>
                      {settings.showPaymentMethod !== false && (
                        <div className="flex justify-between items-center text-[10px] font-bold text-zinc-700 mt-1.5">
                          <span className="uppercase">Payment Method:</span>
                          <span className="bg-black text-white px-2 py-0.5 rounded font-black text-[10px] uppercase tracking-wider">
                            PAID &bull; {paymentMethod}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Payment QR */}
                    {settings.showQrCode && (
                      <div className="my-3 text-center border-t border-dashed border-zinc-400 pt-2.5">
                        <div className="inline-block bg-white p-1.5 border border-zinc-300 rounded-lg shadow-2xs">
                          <ReceiptQrCode 
                            value={settings.qrCodeUrl || "MuchachosPayment"} 
                            size={64}
                          />
                        </div>
                        <p className="text-[9px] font-black uppercase tracking-wider text-zinc-800 mt-1">
                          Scan to Pay / Verify
                        </p>
                        <p className="text-[8px] text-zinc-500">
                          {settings.qrNote || "Raast • JazzCash • EasyPaisa"}
                        </p>
                      </div>
                    )}

                    {/* Realistic Barcode Graphic Simulation */}
                    {settings.showBarcode !== false && (
                      <div className="my-2.5 text-center">
                        <div className="inline-flex items-center justify-center gap-[2px] h-7 px-2 bg-white border border-zinc-200">
                          {[2,1,3,1,1,4,2,1,2,3,1,2,4,1,1,3,2,1,4,1,2,3,1,2,3,1,4,1].map((w, idx) => (
                            <div key={idx} className="bg-black h-full" style={{ width: `${w * 1.3}px` }} />
                          ))}
                        </div>
                        <div className="text-[8px] font-mono tracking-widest text-zinc-500 mt-0.5">
                          *MC-{tokenNumber}-{dateFormatted.replace(/\s+/g, '')}*
                        </div>
                      </div>
                    )}

                    {/* Footer */}
                    <div className="border-t border-dashed border-zinc-400 mt-2.5 pt-2 text-center space-y-1">
                      {settings.showFooterMessage !== false && settings.receiptFooter && (
                        <p className="text-[10px] text-zinc-800 font-bold">{settings.receiptFooter}</p>
                      )}
                      <div className="border-t border-dashed border-zinc-300 pt-1.5 mt-1.5">
                        <p className="text-[9px] font-black tracking-wider text-black uppercase">
                          SOFTWARE BY TEDDOPS
                        </p>
                        <p className="text-[8px] text-zinc-600 font-semibold">
                          Get POS &amp; Custom Software For Your Business
                        </p>
                        <p className="text-[9px] font-bold text-black font-mono mt-0.5">
                          +92 329 7267098 &bull; +92 323 5930559
                        </p>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                /* ========================================================= */
                /* KITCHEN ORDER TICKET (KOT) PREVIEW                        */
                /* ========================================================= */
                <div>
                  <div className="text-center font-black text-xs uppercase tracking-wider text-black pt-1">
                    KITCHEN ORDER TICKET (KOT)
                  </div>
                  <div className="text-center text-[10px] text-zinc-600 mt-0.5">
                    {settings.storeName} &bull; <span className="font-serif italic text-zinc-800">An Oasis Of Taste</span> &bull; {dateFormatted} {timeFormatted}
                  </div>

                  {(amendmentInfo || (addonItems && addonItems.length > 0)) && (
                    <div className="my-2 bg-black text-white text-center py-1 font-black text-xs uppercase tracking-wider rounded">
                      *** KOT ADD-ON TICKET (PREPARE NOW) ***
                    </div>
                  )}

                  <div className="border-y-2 border-black my-2.5 py-2 text-center">
                    <div className="text-[10px] font-black uppercase text-zinc-500">PREPARATION TOKEN</div>
                    <div className="text-3xl font-black text-black leading-none my-1">#{tokenNumber}</div>
                    <div className="bg-black text-white text-xs font-black uppercase py-1 mt-1 rounded tracking-wider">
                      {isDineIn ? `🍽️ DINE IN - TABLE ${order.table_number || 'OPEN'}` : isFoodpanda ? '🐼 FOODPANDA DELIVERY' : '🛍️ TAKEAWAY ORDER'}
                    </div>
                  </div>

                  {/* Packaging Directive Alert Box */}
                  <div className="border-2 border-dashed border-black p-2 my-2 text-center font-black text-[11px] bg-zinc-100 rounded">
                    {isDineIn 
                      ? '>>> PACKING: SERVE ON DINE-IN TRAYS / PLATES <<<' 
                      : isFoodpanda 
                        ? '>>> PACKING: SEALED FOODPANDA BAG + STAPLE DISPATCH SLIP <<<' 
                        : '>>> PACKING: TAKEAWAY BOXES + CARRY BAG <<<'}
                  </div>

                  <div className="space-y-2 py-2 divide-y divide-dotted divide-zinc-300">
                    {(addonItems && addonItems.length > 0 ? addonItems : orderItems).map((item: any, idx: number) => (
                      <div key={item.id || idx} className="pt-2">
                        <div className="flex items-start gap-2.5">
                          <span className="text-sm font-black text-white bg-black w-7 h-7 rounded flex items-center justify-center shrink-0">
                            {item.quantity}
                          </span>
                          <span className="text-sm font-black text-black leading-tight flex-1 pt-0.5">
                            {item.item_name}
                          </span>
                        </div>
                        {item.deal_swaps_json && item.deal_swaps_json.length > 0 && (
                          <div className="pl-9 mt-1 space-y-0.5 text-xs font-bold text-zinc-900">
                            {item.deal_swaps_json.map((comp: any, cIdx: number) => (
                              <div key={cIdx}>
                                &bull; {(comp.quantity || 1) * item.quantity}x {comp.item_name}
                                {comp.modifiers && comp.modifiers.length > 0 && (
                                  <span className="text-zinc-600 font-normal ml-1">
                                    ({comp.modifiers.map((m: any) => `+${m.qty || 1} ${m.name}`).join(', ')})
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {item.modifiers_json && item.modifiers_json.length > 0 && (
                          <div className="pl-9 mt-1 space-y-0.5 text-xs font-bold text-zinc-800">
                            {item.modifiers_json.map((m: any, mIdx: number) => (
                              <div key={mIdx}>+ {m.qty || 1}x {m.name}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="border-t-2 border-black mt-2 pt-2 text-center text-[10px] text-zinc-500 font-bold uppercase">
                    --- END OF KITCHEN TOKEN #{tokenNumber} ---
                  </div>
                </div>
              )}

            </div>

            {/* Bottom Cutter Teeth (Paper Tear Notch) */}
            <div className="w-full h-3 flex overflow-hidden">
              {Array.from({ length: teethCount }).map((_, i) => (
                <div 
                  key={i} 
                  className="w-2.5 h-3 bg-[#FAFAFA]"
                  style={{ clipPath: 'polygon(50% 100%, 0% 0%, 100% 0%)' }}
                />
              ))}
            </div>

          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-t border-slate-800 bg-slate-950 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div>
            {printSuccess ? (
              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-700 px-3 py-1.5 rounded-xl">
                <CheckCircle2 className="w-4 h-4" />
                <span>{printSuccess}</span>
              </div>
            ) : (
              <span className="text-[11px] text-slate-400">
                Press <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-white text-[10px] font-mono font-bold">Enter</kbd> to {isDineIn ? "Print KOT (Kitchen Only)" : "Print Both (KOT + Receipt)"} &bull; <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-white text-[10px] font-mono font-bold">Esc</kbd> to Close
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-bold transition-all active:scale-95 cursor-pointer"
            >
              Close
            </button>

            {/* Print Action Buttons */}
            {isDineIn ? (
              <button
                onClick={handlePrintKitchenOnly}
                className="px-3.5 py-2 rounded-xl border border-blue-500/40 bg-blue-500/10 hover:bg-blue-600 text-blue-300 hover:text-white text-xs font-black transition-all flex items-center gap-1.5 active:scale-95 shadow-xs cursor-pointer"
                title="Prints Kitchen Ticket Only for Dine-In"
              >
                <UtensilsCrossed className="w-3.5 h-3.5" />
                <span>Kitchen Only [Enter ↵]</span>
              </button>
            ) : (
              !amendmentInfo && (
                <button
                  onClick={handlePrintBoth}
                  className="px-3.5 py-2 rounded-xl border border-amber-600/40 bg-amber-500/10 hover:bg-amber-500 text-amber-300 hover:text-slate-950 text-xs font-black transition-all flex items-center gap-1.5 active:scale-95 shadow-xs cursor-pointer"
                  title="Prints Kitchen Ticket first, then Customer/Dispatch Bill"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Print Both [Enter ↵]</span>
                </button>
              )
            )}

            {/* Print Active Selected Slip */}
            <button
              onClick={handlePrintSlip}
              className={`px-4 py-2 rounded-xl text-white text-xs font-black tracking-wide transition-all flex items-center gap-2 shadow-lg active:scale-95 cursor-pointer ${
                isFoodpanda && activeTab === 'RECEIPT'
                  ? 'bg-pink-600 hover:bg-pink-500'
                  : 'bg-[#E11D2A] hover:bg-red-700 text-white'
              }`}
            >
              <Printer className="w-3.5 h-3.5" />
              <span>
                {activeTab === 'RECEIPT' 
                  ? (isFoodpanda ? 'PRINT DISPATCH SLIP' : amendmentInfo ? 'PRINT AMENDED BILL' : 'PRINT CUSTOMER SLIP') 
                  : (amendmentInfo ? 'PRINT ADD-ON KOT' : 'PRINT KOT TICKET')}
              </span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
