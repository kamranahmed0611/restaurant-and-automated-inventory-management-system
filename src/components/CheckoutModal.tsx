"use client";

import React, { useState } from "react";
import { X, Banknote, Smartphone, Bike, AlertCircle, RefreshCw, Receipt } from "lucide-react";
import { usePosStore } from "@/lib/store";
import { db, getNextTokenNumber, LocalOrder } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { syncOfflineOrders } from "@/lib/sync-engine";
import { deductOrderInventory, executeCheckoutTransaction, populateOrderItemsCogs } from "@/lib/inventory-service";
import { OrderItem } from "@/types/database";
import ThermalReceiptPreviewModal, { AmendmentDetails } from "./ThermalReceiptPreviewModal";
import { printCustomerReceipt, getReceiptSettings } from "@/lib/receipt-printer";
import { posBus } from "@/lib/broadcast-bus";
import { modal } from "@/lib/modalStore";

type OrderType = 'TAKEAWAY' | 'DINE_IN' | 'FOODPANDA';
type PaymentMethod = 'CASH' | 'JAZZCASH' | 'EASYPAISA' | 'FOODPANDA_RECEIVABLE';

interface CheckoutModalProps {
  onClose: () => void;
}

export default function CheckoutModal({ onClose }: CheckoutModalProps) {
  const { 
    cart, subtotal, netTotal, clearCart, 
    activeOrderId, activeTableNumber, activeShiftId,
    amendingBill, cancelAmendingBill 
  } = usePosStore();

  const [orderType, setOrderType] = useState<OrderType>(
    amendingBill ? (amendingBill.originalOrderType as OrderType) : activeOrderId ? 'DINE_IN' : 'TAKEAWAY'
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [isProcessing, setIsProcessing] = useState(false);

  // State to hold slip data for ThermalReceiptPreviewModal
  const [previewData, setPreviewData] = useState<{
    order: any;
    items: any[];
    addonItems?: any[];
    amendmentInfo?: AmendmentDetails | null;
    initialTab?: 'RECEIPT' | 'KOT';
  } | null>(null);

  // Amendment Calculations
  const newAddonItems = amendingBill ? cart.filter(i => !i.is_original) : [];
  const additionalBalanceDue = amendingBill 
    ? newAddonItems.reduce((sum, i) => sum + i.total_price, 0)
    : 0;
  const wholeAmendedTotal = amendingBill 
    ? (amendingBill.originalNetTotal + additionalBalanceDue)
    : netTotal;

  const handlePrintBillOnly = async () => {
    if (!activeOrderId) return;
    try {
      const existingOrder = await db.orders.get(activeOrderId);
      if (existingOrder) {
        const orderToPrint = { ...existingOrder, items: cart };
        const receiptSettings = getReceiptSettings();
        if (receiptSettings.autoPrintTakeaway) {
          printCustomerReceipt(orderToPrint);
          modal.toast.success(`Bill printed for Table ${existingOrder.table_number}! Tab remains open.`);
          onClose();
        } else {
          setPreviewData({
            order: orderToPrint,
            items: cart,
            amendmentInfo: null,
            initialTab: 'RECEIPT'
          });
        }
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (isProcessing) return; 
    setIsProcessing(true);

    try {
      if (amendingBill) {
        // ==========================================
        // FLOW 1: REOPEN & COLLECT ADDITIONAL BALANCE
        // ==========================================
        if (newAddonItems.length === 0) {
          modal.warning("No Items Added", "No new items were added to this bill. Please add items from the menu first.");
          setIsProcessing(false);
          return;
        }

        // 1. Deduct inventory ONLY for newly added items
        await deductOrderInventory(newAddonItems as OrderItem[], amendingBill.originalOrderId);

        // 2. Update local Dexie DB with calculated COGS
        const existingOrder = await db.orders.get(amendingBill.originalOrderId);
        const enrichedCart = await populateOrderItemsCogs(cart as OrderItem[]);
        const updatedLocalOrder: LocalOrder = {
          ...(existingOrder || {
            id: amendingBill.originalOrderId,
            token_number: amendingBill.originalTokenNumber,
            order_type: amendingBill.originalOrderType as any,
            payment_method: paymentMethod as any,
            shift_id: activeShiftId || undefined,
            discount: 0,
            foodpanda_commission_pct: 0,
            created_at: new Date().toISOString()
          }),
          status: 'COMPLETED',
          subtotal: wholeAmendedTotal,
          net_total: wholeAmendedTotal,
          items: enrichedCart, // complete updated cart with COGS
          sync_status: 'PENDING'
        };
        await db.orders.put(updatedLocalOrder);

        // 3. Trigger background sync & broadcast instant notification to KDS
        setTimeout(() => syncOfflineOrders(), 50);

        posBus.publish('ORDER_UPDATED', { 
          orderId: amendingBill.originalOrderId, 
          tokenNumber: amendingBill.originalTokenNumber 
        });

        // 5. Open Cropped Thermal Receipt Slip Preview
        setPreviewData({
          order: updatedLocalOrder,
          items: cart,
          addonItems: newAddonItems,
          amendmentInfo: {
            originalNetTotal: amendingBill.originalNetTotal,
            additionalBalanceDue,
            previousPaymentMethod: amendingBill.originalPaymentMethod
          },
          initialTab: 'RECEIPT'
        });

      } else if (activeOrderId) {
        // ==========================================
        // FLOW 2: SETTLE EXISTING DINE-IN OPEN TAB
        // ==========================================
        const existingOrder = await db.orders.get(activeOrderId);
        if (existingOrder) {
          const isFp = orderType === 'FOODPANDA' || paymentMethod === 'FOODPANDA_RECEIVABLE';
          const enrichedCart = await populateOrderItemsCogs(cart as OrderItem[]);
          const settledOrder: LocalOrder = {
            ...existingOrder,
            status: 'COMPLETED' as const,
            payment_method: (isFp ? 'FOODPANDA_RECEIVABLE' : paymentMethod) as any,
            shift_id: activeShiftId || undefined,
            subtotal,
            net_total: netTotal,
            foodpanda_commission_pct: isFp ? 30 : 0,
            fp_payout_status: isFp ? 'PENDING_PAYOUT' : 'NOT_APPLICABLE',
            items: enrichedCart,
            sync_status: 'PENDING' as const
          };
          await db.orders.put(settledOrder);
          setTimeout(() => syncOfflineOrders(), 50);

          if (activeTableNumber) {
            usePosStore.getState().clearParkedCart(activeTableNumber);
          }

          posBus.publish('ORDER_COMPLETED', { 
            orderId: activeOrderId, 
            tokenNumber: settledOrder.token_number,
            fullOrder: settledOrder
          });

          const receiptSettings = getReceiptSettings();
          if (receiptSettings.autoPrintTakeaway) {
            printCustomerReceipt(settledOrder);
            modal.toast.success(`Table ${activeTableNumber} settled and bill printed!`);
            handleFinishAndClose();
            return;
          }

          // Open Cropped Thermal Receipt Slip Preview
          setPreviewData({
            order: settledOrder,
            items: cart,
            amendmentInfo: null,
            initialTab: 'RECEIPT'
          });
        }
      } else {
        // ==========================================
        // FLOW 3: FAST-CASUAL (Takeaway / Foodpanda) - ONE ATOMIC DEXIE TRANSACTION
        // ==========================================
        const isFp = orderType === 'FOODPANDA' || paymentMethod === 'FOODPANDA_RECEIVABLE';
        const newOrder = await executeCheckoutTransaction({
          id: uuidv4(),
          order_type: orderType,
          payment_method: (isFp ? 'FOODPANDA_RECEIVABLE' : paymentMethod) as any,
          shift_id: activeShiftId || undefined,
          status: 'PENDING', 
          subtotal,
          discount: 0,
          net_total: netTotal,
          foodpanda_commission_pct: isFp ? 30 : 0,
          fp_payout_status: isFp ? 'PENDING_PAYOUT' : 'NOT_APPLICABLE',
          created_at: new Date().toISOString(),
          items: cart,
          sync_status: 'PENDING'
        });

        posBus.publish('ORDER_CREATED', { 
          orderId: newOrder.id, 
          tokenNumber: newOrder.token_number, 
          orderType 
        });

        const receiptSettings = getReceiptSettings();
        if (receiptSettings.autoPrintTakeaway) {
          printCustomerReceipt(newOrder);
          modal.toast.success(`Order #${newOrder.token_number} complete and sent to printer!`);
          handleFinishAndClose();
          return;
        }

        // Open Cropped Thermal Receipt Slip Preview
        setPreviewData({
          order: newOrder,
          items: cart,
          amendmentInfo: null,
          initialTab: 'RECEIPT'
        });
      }
    } catch (error) {
      console.error("Checkout failed:", error);
      modal.error("Checkout Failed", "Failed to save order. Please check network/offline storage status.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFinishAndClose = () => {
    setPreviewData(null);
    clearCart();
    onClose();
  };

  // If cropped thermal slip preview is active, render it
  if (previewData) {
    return (
      <ThermalReceiptPreviewModal
        isOpen={true}
        onClose={handleFinishAndClose}
        order={previewData.order}
        items={previewData.items}
        addonItems={previewData.addonItems}
        amendmentInfo={previewData.amendmentInfo}
        initialTab={previewData.initialTab || 'RECEIPT'}
        onPrintCompleted={handleFinishAndClose}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in select-none">
      <div className="bg-card w-full max-w-lg rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border bg-background">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center p-2 shadow-xs shrink-0 border border-emerald-200 dark:border-emerald-800">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-black text-foreground">
                {amendingBill 
                  ? `Amend Order #${amendingBill.originalTokenNumber.toString().padStart(3, '0')}`
                  : activeOrderId 
                    ? `Settle Bill: Table ${activeTableNumber}` 
                    : 'Checkout & Settlement'}
              </h2>
              <p className="text-xs text-mutedForeground mt-0.5">
                {amendingBill 
                  ? 'Additional balance due for add-ons' 
                  : 'Confirm payment method and print receipt'}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-mutedForeground hover:bg-muted rounded-full transition-colors cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          
          {/* Amendment Financial Breakdown Card */}
          {amendingBill && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2 text-xs">
              <div className="flex items-center justify-between text-mutedForeground">
                <span>Original Bill Paid:</span>
                <span className="font-bold">Rs. {amendingBill.originalNetTotal.toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between text-amber-700 dark:text-amber-300 font-bold">
                <span>New Add-on Items ({newAddonItems.length}):</span>
                <span className="font-black">+Rs. {additionalBalanceDue.toFixed(0)}</span>
              </div>
              <div className="border-t border-amber-500/20 pt-2 flex items-center justify-between text-foreground font-black text-sm">
                <span>Updated Grand Total:</span>
                <span>Rs. {wholeAmendedTotal.toFixed(0)}</span>
              </div>
            </div>
          )}

          {/* Order Type Selector (Only for non-table, non-amendment fast-casual) */}
          {!activeOrderId && !amendingBill && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-mutedForeground uppercase tracking-wider">Order Type</label>
              <div className="grid grid-cols-2 gap-3">
                {['TAKEAWAY', 'FOODPANDA'].map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      const newType = type as OrderType;
                      setOrderType(newType);
                      if (newType === 'FOODPANDA') {
                        setPaymentMethod('FOODPANDA_RECEIVABLE');
                      } else if (paymentMethod === 'FOODPANDA_RECEIVABLE') {
                        setPaymentMethod('CASH');
                      }
                    }}
                    className={`py-3 rounded-xl font-bold text-sm transition-all border ${
                      orderType === type 
                        ? 'bg-primary text-primaryForeground border-primary shadow-sm' 
                        : 'bg-background text-foreground border-border hover:border-primary/50'
                    }`}
                  >
                    {type.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Payment Method Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-mutedForeground uppercase tracking-wider">
              {amendingBill ? 'Payment Method for Balance Due' : 'Payment Method'}
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                onClick={() => setPaymentMethod('CASH')}
                className={`flex flex-col items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-xs transition-all border ${
                  paymentMethod === 'CASH' ? 'bg-primary text-primaryForeground border-primary shadow-sm' : 'bg-background text-foreground border-border hover:border-primary/50'
                }`}
              >
                <Banknote className="w-5 h-5" /> Cash
              </button>
              <button
                onClick={() => setPaymentMethod('JAZZCASH')}
                className={`flex flex-col items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-xs transition-all border ${
                  paymentMethod === 'JAZZCASH' ? 'bg-[#ff0000] text-white border-[#ff0000] shadow-sm' : 'bg-background text-foreground border-border hover:border-[#ff0000]/50'
                }`}
              >
                <Smartphone className="w-5 h-5" /> JazzCash
              </button>
              <button
                onClick={() => setPaymentMethod('EASYPAISA')}
                className={`flex flex-col items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-xs transition-all border ${
                  paymentMethod === 'EASYPAISA' ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : 'bg-background text-foreground border-border hover:border-emerald-500/50'
                }`}
              >
                <Smartphone className="w-5 h-5" /> EasyPaisa
              </button>
              {orderType === 'FOODPANDA' && !amendingBill && (
                <button
                  onClick={() => setPaymentMethod('FOODPANDA_RECEIVABLE')}
                  className={`col-span-3 flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-xs transition-all border ${
                    paymentMethod === 'FOODPANDA_RECEIVABLE' ? 'bg-[#D70F64] text-white border-[#D70F64] shadow-sm' : 'bg-background text-foreground border-border hover:border-[#D70F64]/50'
                  }`}
                >
                  <Bike className="w-5 h-5" /> Foodpanda Receivable
                </button>
              )}
            </div>
          </div>

          {/* Amount Due Card */}
          <div className="p-4 rounded-xl bg-background border border-border flex items-center justify-between">
            <span className="font-bold text-mutedForeground">
              {amendingBill ? 'Additional Balance Due Now:' : 'Amount Due:'}
            </span>
            <span className="text-3xl font-black text-foreground">
              Rs. {(amendingBill ? additionalBalanceDue : netTotal).toFixed(0)}
            </span>
          </div>
        </div>

        {/* Action Button */}
        <div className="p-5 border-t border-border bg-background space-y-3">
          {activeOrderId && !amendingBill ? (
            <div className="grid grid-cols-2 gap-3">
              <button
                disabled={isProcessing}
                onClick={handlePrintBillOnly}
                className="w-full py-4 rounded-xl bg-blue-100 hover:bg-blue-200 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 font-black text-sm tracking-wide shadow-sm active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer border border-blue-200 dark:border-blue-800"
              >
                PRINT BILL (KEEP OPEN)
              </button>
              <button
                disabled={isProcessing}
                onClick={handleCheckout}
                className="w-full py-4 rounded-xl bg-primary hover:opacity-90 text-primaryForeground font-black text-sm tracking-wide shadow-md active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                    SAVING...
                  </span>
                ) : (
                  'COLLECT PAYMENT & CLOSE TAB'
                )}
              </button>
            </div>
          ) : (
            <button 
              disabled={isProcessing || (amendingBill ? additionalBalanceDue <= 0 : false)}
              onClick={handleCheckout}
              className="w-full py-4 rounded-xl bg-primary hover:opacity-90 text-primaryForeground font-black text-lg tracking-wide shadow-md active:scale-[0.98] transition-all disabled:opacity-50 cursor-pointer"
            >
              {isProcessing ? (
                <span className="flex items-center justify-center gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  SAVING ORDER...
                </span>
              ) : amendingBill ? (
                `COLLECT EXTRA RS. ${additionalBalanceDue.toFixed(0)} & PREVIEW BILL`
              ) : (
                'CONFIRM & PREVIEW TICKET'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

