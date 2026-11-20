"use client";

import React, { useState, useEffect } from "react";
import { X, Printer, QrCode, Save, CheckCircle2, Sliders, Smartphone, MapPin, Phone, FileText } from "lucide-react";
import { getReceiptSettings, saveReceiptSettings, ReceiptSettings, printCustomerReceipt } from "@/lib/receipt-printer";
import ReceiptQrCode from "./ReceiptQrCode";

interface ReceiptSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function ReceiptSettingsModal({ isOpen, onClose }: ReceiptSettingsModalProps) {
  const [settings, setSettings] = useState<ReceiptSettings>(getReceiptSettings());
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const current = getReceiptSettings();
    setSettings(current);

    // Loaded from local receipt settings
  }, [isOpen]);

  const handleChange = (field: keyof ReceiptSettings, value: any) => {
    setSettings(prev => {
      const updated = { ...prev, [field]: value };
      saveReceiptSettings(updated);
      return updated;
    });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      saveReceiptSettings(settings);
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestPrint = () => {
    const sampleOrder = {
      token_number: 99,
      order_type: 'TAKEAWAY',
      table_number: '',
      payment_method: 'CASH',
      created_at: new Date().toISOString(),
      subtotal: 1250,
      discount: 0,
      net_total: 1250,
      items: [
        {
          quantity: 2,
          item_name: "Crunch Burger",
          unit_price: 550,
          total_price: 1100,
          modifiers_json: [{ name: "Extra Cheese", qty: 1, price: 50 }]
        },
        {
          quantity: 1,
          item_name: "Gourmet Fries",
          unit_price: 150,
          total_price: 150,
          modifiers_json: []
        }
      ]
    };

    printCustomerReceipt(sampleOrder, settings);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col text-slate-800">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 border border-blue-500/30 rounded-xl text-blue-400">
              <Printer className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">Thermal Printer &amp; Receipt Designer</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Customize store details, bill display checkboxes, paper width (80mm/58mm), and auto-print behavior.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Columns: Settings Form (Left) & Real-time Live Preview (Right) */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 md:grid-cols-12 gap-6 bg-slate-50/50">
          
          {/* Left Form (7 cols) */}
          <div className="md:col-span-7 space-y-4">
            
            {/* Store Identity */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
              <h3 className="font-black text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-blue-600" /> Store Branding &amp; Contact Info
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Restaurant / Store Name *</label>
                  <input 
                    type="text" 
                    value={settings.storeName} 
                    onChange={e => handleChange('storeName', e.target.value)} 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-blue-500 outline-none"
                    placeholder="MUCHACHOS"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-600">Tagline / Subtitle</label>
                    <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-600">
                      <input 
                        type="checkbox"
                        checked={settings.showTagline !== false}
                        onChange={e => handleChange('showTagline', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 w-3 h-3"
                      />
                      <span>Print</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    value={settings.tagline} 
                    onChange={e => handleChange('tagline', e.target.value)} 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:border-blue-500 outline-none"
                    placeholder="Real Mexican & Fast Food Experience"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-600">Branch Address</label>
                    <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-600">
                      <input 
                        type="checkbox"
                        checked={settings.showAddress !== false}
                        onChange={e => handleChange('showAddress', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 w-3 h-3"
                      />
                      <span>Print</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    value={settings.address} 
                    onChange={e => handleChange('address', e.target.value)} 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:border-blue-500 outline-none"
                    placeholder="F-8 Markaz, Islamabad"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-600">Contact Phone</label>
                    <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-600">
                      <input 
                        type="checkbox"
                        checked={settings.showPhone !== false}
                        onChange={e => handleChange('showPhone', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 w-3 h-3"
                      />
                      <span>Print</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    value={settings.phone} 
                    onChange={e => handleChange('phone', e.target.value)} 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:border-blue-500 outline-none"
                    placeholder="0300-1234567"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-600">NTN / STRN (Tax ID)</label>
                    <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-600">
                      <input 
                        type="checkbox"
                        checked={settings.showNtn !== false}
                        onChange={e => handleChange('showNtn', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 w-3 h-3"
                      />
                      <span>Print</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    value={settings.ntn} 
                    onChange={e => handleChange('ntn', e.target.value)} 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:border-blue-500 outline-none"
                    placeholder="NTN-9988776-5"
                  />
                </div>

                <div className="col-span-2 sm:col-span-1">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-600">Custom Header Note</label>
                    <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-600">
                      <input 
                        type="checkbox"
                        checked={settings.showCustomHeaderNote !== false}
                        onChange={e => handleChange('showCustomHeaderNote', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 w-3 h-3"
                      />
                      <span>Print</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    value={settings.customHeaderNote || ''} 
                    onChange={e => handleChange('customHeaderNote', e.target.value)} 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:border-blue-500 outline-none"
                    placeholder="E.g. Freshly Grilled Every Day"
                  />
                </div>

                <div className="col-span-2">
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-bold text-slate-600">Receipt Footer Message</label>
                    <label className="flex items-center gap-1 cursor-pointer text-[10px] font-bold text-blue-600">
                      <input 
                        type="checkbox"
                        checked={settings.showFooterMessage !== false}
                        onChange={e => handleChange('showFooterMessage', e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 w-3 h-3"
                      />
                      <span>Print</span>
                    </label>
                  </div>
                  <input 
                    type="text" 
                    value={settings.receiptFooter} 
                    onChange={e => handleChange('receiptFooter', e.target.value)} 
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:border-blue-500 outline-none"
                    placeholder="Thank you for dining at Muchachos! Please visit again."
                  />
                </div>
              </div>
            </div>

            {/* Bill Line Items & Metadata Toggles */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
              <h3 className="font-black text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-600" /> Bill Header &amp; Metadata Switches
              </h3>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={settings.showTokenNumber !== false} 
                    onChange={e => handleChange('showTokenNumber', e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 w-3.5 h-3.5"
                  />
                  <span className="text-[11px] font-bold text-slate-700">Token (#099)</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={settings.showOrderType !== false} 
                    onChange={e => handleChange('showOrderType', e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 w-3.5 h-3.5"
                  />
                  <span className="text-[11px] font-bold text-slate-700">Order Type</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={settings.showDateTime !== false} 
                    onChange={e => handleChange('showDateTime', e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 w-3.5 h-3.5"
                  />
                  <span className="text-[11px] font-bold text-slate-700">Date &amp; Time</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer p-2 rounded-lg bg-slate-50 border border-slate-200 hover:border-blue-300 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={settings.showPaymentMethod !== false} 
                    onChange={e => handleChange('showPaymentMethod', e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 w-3.5 h-3.5"
                  />
                  <span className="text-[11px] font-bold text-slate-700">Payment Mode</span>
                </label>
              </div>
            </div>

            {/* Hardware & Paper Specs */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
              <h3 className="font-black text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Printer className="w-3.5 h-3.5 text-blue-600" /> Thermal Paper Size &amp; Behavior
              </h3>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Paper Roll Width</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleChange('paperWidth', '80mm')}
                      className={`py-2 rounded-lg text-xs font-black border transition-all ${
                        settings.paperWidth === '80mm'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-blue-400'
                      }`}
                    >
                      80mm (Standard)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChange('paperWidth', '58mm')}
                      className={`py-2 rounded-lg text-xs font-black border transition-all ${
                        settings.paperWidth === '58mm'
                          ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-blue-400'
                      }`}
                    >
                      58mm (Compact)
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-600 block mb-1">Auto-Print Triggers</label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                    <input 
                      type="checkbox" 
                      checked={settings.autoPrintTakeaway} 
                      onChange={e => handleChange('autoPrintTakeaway', e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                    />
                    <span>Auto-print KOT + Bill on Takeaway</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700">
                    <input 
                      type="checkbox" 
                      checked={settings.autoPrintDineInKot} 
                      onChange={e => handleChange('autoPrintDineInKot', e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                    />
                    <span>Auto-print KOT on Dine-In send</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Payment QR Code & Bill Extras */}
            <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <h3 className="font-black text-xs text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                  <QrCode className="w-3.5 h-3.5 text-blue-600" /> Digital Payment QR &amp; Visual Options
                </h3>
                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-blue-600">
                  <input 
                    type="checkbox" 
                    checked={settings.showQrCode} 
                    onChange={e => handleChange('showQrCode', e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                  />
                  <span>Show QR Code on Bill</span>
                </label>
              </div>

              {settings.showQrCode && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">
                      Payment Account / Link / Data
                    </label>
                    <input 
                      type="text" 
                      value={settings.qrCodeUrl} 
                      onChange={e => handleChange('qrCodeUrl', e.target.value)} 
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:border-blue-500 outline-none"
                      placeholder="03001234567 or account title"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold text-slate-600 block mb-1">
                      QR Instruction Subtitle
                    </label>
                    <input 
                      type="text" 
                      value={settings.qrNote || 'Raast • JazzCash • EasyPaisa'} 
                      onChange={e => handleChange('qrNote', e.target.value)} 
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:border-blue-500 outline-none"
                      placeholder="Raast • JazzCash • EasyPaisa"
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-5 pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                  <input 
                    type="checkbox" 
                    checked={settings.showLogo !== false} 
                    onChange={e => handleChange('showLogo', e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                  />
                  <span>Print Brand Logo Icon</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-700">
                  <input 
                    type="checkbox" 
                    checked={settings.showBarcode !== false} 
                    onChange={e => handleChange('showBarcode', e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500" 
                  />
                  <span>Print Order Barcode Strip</span>
                </label>
              </div>

              <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <span>🔒 Developer Attribution &bull; TEDDOPS (Permanent footer)</span>
                <span className="font-mono text-[10px] text-slate-500">+92 329 7267098 &bull; +92 323 5930559</span>
              </div>
            </div>

          </div>

          {/* Right Column: Live Thermal Receipt Preview (5 cols) */}
          <div className="md:col-span-5 flex flex-col items-center">
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-wider mb-2">
              Live Thermal Paper Preview ({settings.paperWidth})
            </span>

            <div 
              className={`bg-white shadow-xl border-2 border-slate-300 rounded-xl p-5 font-mono text-[11px] leading-tight text-slate-900 w-full transition-all ${
                settings.paperWidth === '58mm' ? 'max-w-[260px] text-[10px]' : 'max-w-[320px]'
              }`}
            >
              <div className="text-center">
                {settings.showLogo !== false && (
                  <div className="font-serif italic font-black text-base text-black mb-0.5">YumYum!</div>
                )}
                <div className="font-black text-lg uppercase tracking-tight">{settings.storeName || 'MUCHACHOS'}</div>
                {settings.showTagline !== false && settings.tagline && <div className="text-[9px] text-slate-500">{settings.tagline}</div>}
                {settings.showAddress !== false && settings.address && <div className="text-[9px] text-slate-500">{settings.address}</div>}
                {settings.showPhone !== false && settings.phone && <div className="text-[9px] text-slate-500">Ph: {settings.phone}</div>}
                {settings.showNtn !== false && settings.ntn && <div className="text-[9px] text-slate-400">{settings.ntn}</div>}
                {settings.showCustomHeaderNote !== false && settings.customHeaderNote && <div className="text-[9px] font-bold text-slate-600">{settings.customHeaderNote}</div>}
              </div>

              <div className="border-t border-dashed border-slate-300 my-2"></div>

              <div className="flex justify-between text-[10px]">
                {settings.showTokenNumber !== false ? <span>Token: <strong>#099</strong></span> : <span></span>}
                {settings.showOrderType !== false ? <span>Type: <strong>TAKEAWAY</strong></span> : <span></span>}
              </div>
              {settings.showDateTime !== false && (
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>{new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}

              <div className="border-t-2 border-dashed border-slate-300 my-2"></div>

              <div className="space-y-1.5 py-1">
                <div>
                  <div className="flex justify-between font-bold">
                    <span>2x Crunch Burger</span>
                    <span>Rs. 1,100</span>
                  </div>
                  <div className="text-[9px] text-slate-500 pl-2">+ 1x Extra Cheese (Rs. 50)</div>
                </div>
                <div className="flex justify-between font-bold">
                  <span>1x Gourmet Fries</span>
                  <span>Rs. 150</span>
                </div>
              </div>

              <div className="border-t border-dashed border-slate-300 my-2"></div>

              <div className="flex justify-between text-[10px]">
                <span>Subtotal:</span>
                <span>Rs. 1,250</span>
              </div>

              <div className="border-t-2 border-dashed border-slate-300 my-2"></div>

              <div className="flex justify-between items-center font-black text-sm">
                <span>NET TOTAL:</span>
                <span>Rs. 1,250</span>
              </div>

              {settings.showPaymentMethod !== false && (
                <div className="flex justify-between text-[10px] mt-1 text-slate-600">
                  <span>Payment:</span>
                  <span className="font-bold">CASH</span>
                </div>
              )}

              {settings.showQrCode && (
                <div className="text-center my-3">
                  <div className="inline-block bg-white p-1 border border-slate-200 rounded">
                    <ReceiptQrCode value={settings.qrCodeUrl || "MuchachosPayment"} size={64} />
                  </div>
                  <div className="text-[8px] font-bold mt-1 text-slate-600">
                    {settings.qrNote || "Scan to Pay via Mobile"}
                  </div>
                </div>
              )}

              {settings.showBarcode !== false && (
                <div className="my-2 text-center font-mono text-[9px] tracking-wider text-slate-500">
                  *MC-099-BILL*
                </div>
              )}

              <div className="border-t border-dashed border-slate-300 my-2"></div>

              <div className="text-center text-[9px] text-slate-500 mt-2 space-y-1">
                {settings.showFooterMessage !== false && settings.receiptFooter && <div>{settings.receiptFooter}</div>}
                <div className="border-t border-dashed border-slate-300 pt-1.5 mt-1.5">
                  <div className="font-black text-slate-900 text-[9px] uppercase tracking-wider">SOFTWARE BY TEDDOPS</div>
                  <div className="text-[8px] text-slate-600">Get POS &amp; Custom Software For Your Business</div>
                  <div className="font-bold text-slate-900 font-mono text-[9px] mt-0.5">+92 329 7267098 &bull; +92 323 5930559</div>
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-white border-t border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={handleTestPrint}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors border border-slate-200"
            >
              <Printer className="w-4 h-4 text-blue-600" />
              <span>Test Print Sample Receipt</span>
            </button>
            {isSaved && (
              <span className="text-xs font-bold text-emerald-600 flex items-center gap-1 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4" /> Settings Saved!
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-slate-600 hover:bg-slate-100 font-bold text-xs rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-black text-xs rounded-xl shadow-md transition-all active:scale-95 flex items-center gap-1.5"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'SAVING...' : 'SAVE SETTINGS'}</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
