"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { 
  X, Play, Square, FileText, CheckCircle2, AlertTriangle, 
  AlertCircle, Printer, Calculator, ArrowRight, ArrowLeft, 
  RefreshCw, Clock, DollarSign, Wallet, ShieldCheck, Check,
  ChevronDown, ChevronUp, History
} from "lucide-react";
import { db, LocalExpense } from "@/lib/db";
import { usePosStore } from "@/lib/store";
import { modal } from "@/lib/modalStore";
import { MuchachosSymbol } from "./MuchachosBrand";
import { print80mmFinancialReport, FinancialReportData } from "@/lib/thermal-reports";
import { triggerDailyAutoBackup } from "@/lib/auto-backup";
import { loadCostLookupData, computeItemCogsFromLookup } from "@/lib/inventory-service";
import { posBus } from "@/lib/broadcast-bus";

interface ZReportModalProps {
  onClose: () => void;
}

type ModalStage = 'START_SHIFT' | 'BLIND_COUNT_INPUT' | 'AUDIT_REVEALED' | 'CLOSED_SUCCESS';

interface PastShiftRecord {
  id: string;
  opened_at: string;
  closed_at: string | null;
  status: string;
  starting_cash: number;
  expected_cash: number;
  actual_cash: number;
  notes?: string | null;
}

export default function ZReportModal({ onClose }: ZReportModalProps) {
  const { activeShiftId, setActiveShift } = usePosStore();
  const [stage, setStage] = useState<ModalStage>('START_SHIFT');
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  // Shifts on current calendar day
  const [todayShifts, setTodayShifts] = useState<PastShiftRecord[]>([]);
  const [activeShift, setActiveShiftData] = useState<PastShiftRecord | null>(null);
  const [shiftSequence, setShiftSequence] = useState<number>(1);
  const [negativeStockItems, setNegativeStockItems] = useState<any[]>([]);
  const [reconcileInputs, setReconcileInputs] = useState<Record<string, { addedQty: number | ''; unitCost: number | '' }>>({});
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileSuccess, setReconcileSuccess] = useState(false);

  // Starting Shift Inputs
  const [cashierName, setCashierName] = useState("");
  const [startingCash, setStartingCash] = useState<number>(1000);
  const [startingNotes, setStartingNotes] = useState("");
  const [verifiedOpeningDrawer, setVerifiedOpeningDrawer] = useState(false);

  // Blind Check & Audit Inputs
  const [actualCash, setActualCash] = useState<number>(0);
  const [closingNotes, setClosingNotes] = useState("");
  const [useDenominationCounter, setUseDenominationCounter] = useState(false);
  const [denominations, setDenominations] = useState<{ [key: number]: number }>({
    5000: 0,
    1000: 0,
    500: 0,
    100: 0,
    50: 0,
    20: 0,
    10: 0
  });

  // Drawer Expenses / Payouts during this shift
  const [shiftExpenses, setShiftExpenses] = useState<LocalExpense[]>([]);
  const [isAddingExpense, setIsAddingExpense] = useState(false);
  const [expenseDesc, setExpenseDesc] = useState("");
  const [expenseAmount, setExpenseAmount] = useState<number | "">("");
  const [expenseCategory, setExpenseCategory] = useState("Drawer Payout");

  // Shift Sales Metrics
  const [shiftStats, setShiftStats] = useState({
    totalOrders: 0,
    grossSales: 0,
    cashSales: 0,
    jazzcashSales: 0,
    easypaisaSales: 0,
    cardSales: 0,
    digitalSalesTotal: 0,
    foodpandaSales: 0,
    expensesTotal: 0,
    totalCogs: 0
  });

  // Slip Printing Preview
  const [isPrintPreviewOpen, setIsPrintPreviewOpen] = useState(false);
  const [isLeftoverShift, setIsLeftoverShift] = useState(false);

  // Fetch all shifts today and active shift data (100% Offline-First via Dexie)
  const loadShiftData = useCallback(async () => {
    setIsLoading(true);
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      // Instant Local Dexie Load (0ms, standalone offline)
      const localShifts = await db.shifts.toArray();

      // Filter shifts for today (or past leftover open shifts)
      const shiftsList: PastShiftRecord[] = localShifts.map(s => ({
        id: s.id,
        opened_at: s.opened_at,
        closed_at: s.closed_at || null,
        status: s.status,
        starting_cash: Number(s.starting_cash || 0),
        expected_cash: Number(s.expected_cash || 0),
        actual_cash: Number(s.actual_cash || 0),
        notes: s.notes || null
      }));

      const todayShiftsList = shiftsList.filter(s => {
        const opened = new Date(s.opened_at);
        return opened >= startOfDay || s.status === 'OPEN';
      });

      setTodayShifts(todayShiftsList);

      // 3. Determine active shift if exists
      let currentActive: PastShiftRecord | null = null;
      if (activeShiftId) {
        currentActive = shiftsList.find(s => s.id === activeShiftId) || null;
      }
      if (!currentActive) {
        currentActive = shiftsList.find(s => s.status === 'OPEN') || null;
      }

      if (currentActive && currentActive.status === 'OPEN') {
        const isFromPreviousDay = new Date(currentActive.opened_at) < startOfDay;
        setIsLeftoverShift(isFromPreviousDay);
        setActiveShiftData(currentActive);
        setActiveShift(currentActive.id);

        if (isFromPreviousDay) {
          setShiftSequence(1);
        } else {
          const idx = todayShiftsList.findIndex(s => s.id === currentActive?.id);
          setShiftSequence(idx >= 0 ? idx + 1 : todayShiftsList.length);
        }

        setStage('BLIND_COUNT_INPUT');
        await calculateShiftSales(currentActive.id, currentActive.opened_at);
      } else {
        setIsLeftoverShift(false);
        setActiveShiftData(null);
        setActiveShift(null);
        setShiftSequence(todayShiftsList.length + 1);
        setStage('START_SHIFT');
      }

      // Check negative inventory stock from Dexie
      const negStock = await db.raw_inventory.filter(i => (i.current_stock || 0) < 0).toArray();
      setNegativeStockItems(negStock);
      const initialInputs: Record<string, { addedQty: number | ''; unitCost: number | '' }> = {};
      negStock.forEach(item => {
        const deficit = Math.abs(Number(item.current_stock || 0));
        initialInputs[item.id] = {
          addedQty: deficit,
          unitCost: item.cost_per_unit || ''
        };
      });
      setReconcileInputs(initialInputs);

    } catch (err) {
      console.error("Error loading shift data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeShiftId, setActiveShift]);

  useEffect(() => {
    loadShiftData();
  }, [loadShiftData]);

  // Calculate orders & revenue for this shift (Offline-First via Dexie)
  const calculateShiftSales = async (shiftId: string, shiftOpenedAt?: string, shiftClosedAt?: string) => {
    let orders: any[] = [];
    try {
      // 1. Load orders directly from local Dexie database
      const allLocalOrders = await db.orders.toArray();
      const shiftStartTime = shiftOpenedAt ? new Date(shiftOpenedAt).getTime() : 0;
      const shiftEndTime = shiftClosedAt ? new Date(shiftClosedAt).getTime() : Date.now();

      const matchedLocalOrders = allLocalOrders.filter(o => {
        // A: Explicit shift ID match
        if (o.shift_id && o.shift_id === shiftId) return true;
        // B: Unassigned or offline orders created within shift time window
        if (!o.shift_id && shiftOpenedAt) {
          const t = new Date(o.created_at).getTime();
          return t >= shiftStartTime && t <= shiftEndTime;
        }
        return false;
      });

      // Filter paid orders: exclude cancelled orders, exclude unpaid open tabs, require valid payment method
      orders = matchedLocalOrders.filter(o => 
        o.status !== 'CANCELLED' && 
        o.status !== 'OPEN_TAB' && 
        o.payment_method &&
        o.payment_method !== 'PENDING'
      );
    } catch (dexieErr) {
      console.warn("[Z-Report] Dexie orders load warning:", dexieErr);
    }


    let gross = 0;
    let cash = 0;
    let jazzcash = 0;
    let easypaisa = 0;
    let card = 0;
    let fp = 0;

    orders.forEach(o => {
      const net = Number(o.net_total || 0);
      gross += net;

      if (o.order_type === 'FOODPANDA' || o.payment_method === 'FOODPANDA_RECEIVABLE') {
        fp += net;
      } else if (o.payment_method === 'JAZZCASH') {
        jazzcash += net;
      } else if (o.payment_method === 'EASYPAISA') {
        easypaisa += net;
      } else if (o.payment_method === 'CARD') {
        card += net;
      } else {
        cash += net;
      }
    });

    // Calculate drawer payouts / expenses logged during this shift
    let expTotal = 0;
    try {
      const allExpenses = await db.expenses.toArray();
      const relevantExpenses = shiftOpenedAt 
        ? allExpenses.filter(e => e.created_at >= shiftOpenedAt)
        : allExpenses;
      setShiftExpenses(relevantExpenses);
      expTotal = relevantExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    } catch {
      expTotal = 0;
      setShiftExpenses([]);
    }

    const digitalTotal = jazzcash + easypaisa + card;

    // Calculate total COGS for this shift from local recipes & raw inventory
    let cogsTotal = 0;
    try {
      const lookup = await loadCostLookupData();
      orders.forEach(o => {
        (o.items || []).forEach((it: any) => {
          cogsTotal += computeItemCogsFromLookup(it, lookup);
        });
      });
    } catch (cogsErr) {
      console.warn("[ZReport] Error computing shift COGS:", cogsErr);
    }

    setShiftStats({
      totalOrders: orders.length,
      grossSales: gross,
      cashSales: cash,
      jazzcashSales: jazzcash,
      easypaisaSales: easypaisa,
      cardSales: card,
      digitalSalesTotal: digitalTotal,
      foodpandaSales: fp,
      expensesTotal: expTotal,
      totalCogs: cogsTotal
    });
  };

  // Reconcile and settle negative stock deficits and recalculate shift orders' COGS live
  const handleSettleDeficitStock = async () => {
    if (negativeStockItems.length === 0) return;
    setIsReconciling(true);
    try {
      for (const item of negativeStockItems) {
        const input = reconcileInputs[item.id];
        const addedQty = Number(input?.addedQty || 0);
        const newCost = Number(input?.unitCost || item.cost_per_unit || 0);

        const newStock = Number(item.current_stock || 0) + addedQty;
        await db.raw_inventory.update(item.id, {
          current_stock: newStock,
          cost_per_unit: newCost,
          sync_status: 'PENDING'
        });

        // Log replenishment in local audit log
        await db.inventory_logs.put({
          id: crypto.randomUUID(),
          inventory_item_id: item.id,
          change_qty: addedQty,
          change_type: 'PURCHASE_RESTOCK',
          reason: 'Shift Close Deficit Settlement & Price Update',
          created_at: new Date().toISOString(),
          sync_status: 'PENDING'
        });
      }

      // Recalculate historical shift orders so that overriden orders permanently follow the settled prices!
      if (activeShift) {
        const shiftStartTime = activeShift.opened_at ? new Date(activeShift.opened_at).getTime() : 0;
        const allOrders = await db.orders.toArray();
        const shiftOrders = allOrders.filter(o => {
          if (o.shift_id && o.shift_id === activeShift.id) return true;
          if (!o.shift_id && activeShift.opened_at) {
            const t = new Date(o.created_at).getTime();
            return t >= shiftStartTime;
          }
          return false;
        });

        const updatedLookup = await loadCostLookupData();

        for (const order of shiftOrders) {
          let hasOrderChanged = false;
          const newItems = (order.items || []).map((it: any) => {
            const freshCogs = computeItemCogsFromLookup({ ...it, cogs_total: undefined }, updatedLookup);
            if (it.cogs_total !== freshCogs) {
              hasOrderChanged = true;
              return { ...it, cogs_total: freshCogs };
            }
            return it;
          });

          if (hasOrderChanged) {
            await db.orders.update(order.id, { items: newItems });
          }
        }

        // Re-calculate shift sales and COGS live
        await calculateShiftSales(activeShift.id, activeShift.opened_at);
      }

      // Refresh negative stock items list
      const remainingNeg = await db.raw_inventory.filter(i => (i.current_stock || 0) < 0).toArray();
      setNegativeStockItems(remainingNeg);
      setReconcileSuccess(true);
      modal.toast.success("Negative stock reconciled & shift COGS recalculated!");
      posBus.publish('MENU_UPDATED', {});
    } catch (err: any) {
      console.error("Deficit settlement failed:", err);
      modal.toast.error("Failed to settle deficit: " + err.message);
    } finally {
      setIsReconciling(false);
    }
  };

  // Add new drawer payout / expense during shift
  const handleAddShiftExpense = async () => {
    if (!expenseDesc.trim()) {
      modal.warning("Missing Description", "Please enter a description for this drawer expense.");
      return;
    }
    const amt = Number(expenseAmount);
    if (!amt || amt <= 0) {
      modal.warning("Invalid Amount", "Please enter a valid expense amount in PKR.");
      return;
    }

    try {
      const isOwnerWithdrawal = expenseCategory === 'Owner Withdrawal';
      const resolvedCategory = isOwnerWithdrawal 
        ? 'Owner Cash Payout (Drawer)' 
        : `Shift Drawer - ${expenseCategory}`;

      const newExp: LocalExpense = {
        id: crypto.randomUUID(),
        description: `[Shift Drawer] ${expenseDesc.trim()}`,
        amount: amt,
        category: resolvedCategory,
        logged_by: cashierName || "Counter Cashier",
        created_at: new Date().toISOString(),
        sync_status: 'PENDING'
      };

      await db.expenses.put(newExp);
      posBus.publish('EXPENSE_LOGGED', { id: newExp.id, amount: amt, category: newExp.category });
      modal.toast.success(`Drawer payout of Rs. ${amt.toLocaleString()} recorded.`);
      setExpenseDesc("");
      setExpenseAmount("");
      setIsAddingExpense(false);

      if (activeShift) {
        await calculateShiftSales(activeShift.id, activeShift.opened_at);
      }
    } catch (err: any) {
      modal.error("Failed to Record Expense", err.message || "Could not save drawer expense.");
    }
  };

  // Denomination counter calculation
  const calculatedDenomTotal = useMemo(() => {
    return Object.entries(denominations).reduce((sum, [denom, count]) => {
      return sum + Number(denom) * (Number(count) || 0);
    }, 0);
  }, [denominations]);

  const handleDenominationChange = (denom: number, count: number) => {
    const updated = { ...denominations, [denom]: Math.max(0, count) };
    setDenominations(updated);
    const newTotal = Object.entries(updated).reduce((sum, [d, c]) => sum + Number(d) * (Number(c) || 0), 0);
    setActualCash(newTotal);
  };

  // 1. OPEN REGISTER (Start Shift - 100% Offline Capable)
  const handleStartShift = async () => {
    if (startingCash < 0) {
      modal.warning("Invalid Starting Cash", "Starting cash cannot be negative.");
      return;
    }
    setIsProcessing(true);
    try {
      const notesFormatted = [
        cashierName.trim() ? `Cashier: ${cashierName.trim()}` : '',
        startingNotes.trim() ? `Note: ${startingNotes.trim()}` : ''
      ].filter(Boolean).join(' | ');

      const newShiftId = crypto.randomUUID();
      const openedAt = new Date().toISOString();

      const newShiftPayload: PastShiftRecord = {
        id: newShiftId,
        starting_cash: Number(startingCash || 0),
        status: 'OPEN',
        opened_at: openedAt,
        closed_at: null,
        expected_cash: 0,
        actual_cash: 0,
        notes: notesFormatted || null
      };

      // A. Write to Local Dexie DB first (0ms offline guarantee)
      await db.shifts.put({
        id: newShiftId,
        opened_at: openedAt,
        starting_cash: Number(startingCash || 0),
        status: 'OPEN',
        notes: notesFormatted || null,
        sync_status: 'PENDING'
      });

      setActiveShift(newShiftId);
      setActiveShiftData(newShiftPayload);
      localStorage.setItem('muchachos_active_shift_id', newShiftId);


      modal.toast.success("Shift register opened successfully.");
      await loadShiftData();
    } catch (err: any) {
      modal.error("Open Shift Failed", "Failed to start shift: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. BLIND COUNT REVELATION (Step 1 -> Step 2)
  const handleRevealAudit = async () => {
    if (actualCash < 0) {
      modal.warning("Invalid Cash Count", "Actual cash counted cannot be negative.");
      return;
    }
    // Re-verify shift orders calculation immediately to ensure 100% up-to-date data
    if (activeShift) {
      await calculateShiftSales(activeShift.id, activeShift.opened_at);
    }
    setStage('AUDIT_REVEALED');
  };

  // Mathematical Reconciliation Calculations (Start + Cash Sales - Drawer Expenses)
  const expectedCashInDrawer = useMemo(() => {
    const starting = Number(activeShift?.starting_cash || 0);
    return Math.max(0, starting + shiftStats.cashSales - shiftStats.expensesTotal);
  }, [activeShift, shiftStats.cashSales, shiftStats.expensesTotal]);

  const variance = useMemo(() => {
    return actualCash - expectedCashInDrawer;
  }, [actualCash, expectedCashInDrawer]);

  const isBalanced = variance === 0;
  const isShortage = variance < 0;
  const isOverage = variance > 0;

  // 3. CONFIRM & FINALIZE SHIFT CLOSING (Step 2 -> Step 3 - 100% Offline Capable)
  const handleFinalizeShift = async () => {
    if (!activeShift) return;
    setIsProcessing(true);
    try {
      const existingNotes = activeShift.notes ? `${activeShift.notes} | ` : '';
      const finalNotes = closingNotes.trim()
        ? `${existingNotes}Closing Note: ${closingNotes.trim()} (Variance: ${variance >= 0 ? '+' : ''}${variance})`
        : `${existingNotes}Variance: ${variance >= 0 ? '+' : ''}${variance}`;

      const closedAt = new Date().toISOString();

      // A. Write to Local Dexie DB first
      await db.shifts.update(activeShift.id, {
        status: 'CLOSED',
        closed_at: closedAt,
        expected_cash: expectedCashInDrawer,
        actual_cash: actualCash,
        notes: finalNotes,
        sync_status: 'PENDING'
      });


      // C. Trigger immediate automated local & USB backup snapshot on shift finalization
      triggerDailyAutoBackup(true).catch(bErr => console.warn('[AutoBackup] Shift-close auto backup note:', bErr));

      localStorage.removeItem('muchachos_active_shift_id');
      const closedShiftId = activeShift.id;
      setActiveShift(null);
      setStage('CLOSED_SUCCESS');
      posBus.publish('SHIFT_CLOSED', { shiftId: closedShiftId });
      modal.toast.success("Shift closed, Z-Report finalized, and local backup secured.");
      await loadShiftData();
    } catch (err: any) {
      modal.error("Shift Close Failed", "Failed to close shift: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrintZReportThermal = () => {
    const zData: FinancialReportData = {
      title: "CASHIER CLOSING REPORT (Z-REPORT)",
      periodLabel: `Shift #${shiftSequence} (${new Date().toLocaleDateString('en-GB')})`,
      generatedAt: new Date().toLocaleString('en-GB'),
      generatedBy: cashierName || "Counter Cashier",
      totalOrders: shiftStats.totalOrders,
      grossSales: shiftStats.grossSales,
      discounts: 0,
      netSales: shiftStats.grossSales,
      avgTicketSize: shiftStats.totalOrders > 0 ? Math.round(shiftStats.grossSales / shiftStats.totalOrders) : 0,
      paymentMethods: {
        cash: shiftStats.cashSales,
        card: shiftStats.cardSales,
        jazzcash: shiftStats.jazzcashSales,
        easypaisa: shiftStats.easypaisaSales,
        foodpandaGross: shiftStats.foodpandaSales,
        foodpandaNet: Math.round(shiftStats.foodpandaSales * 0.7)
      },
      expensesByCategory: {},
      totalExpenses: shiftStats.expensesTotal,
      totalCogs: shiftStats.totalCogs,
      grossProfit: shiftStats.grossSales - shiftStats.totalCogs,
      grossMarginPct: shiftStats.grossSales > 0 ? Number((((shiftStats.grossSales - shiftStats.totalCogs) / shiftStats.grossSales) * 100).toFixed(1)) : 0,
      netProfit: (shiftStats.grossSales - shiftStats.totalCogs) - shiftStats.expensesTotal,
      netMarginPct: shiftStats.grossSales > 0 ? Number(((((shiftStats.grossSales - shiftStats.totalCogs) - shiftStats.expensesTotal) / shiftStats.grossSales) * 100).toFixed(1)) : 0,
      cashDrawer: {
        openingCash: startingCash,
        cashSales: shiftStats.cashSales,
        cashExpenses: shiftStats.expensesTotal,
        expectedCash: expectedCashInDrawer,
        actualCash: actualCash,
        variance: variance
      },
      topSellingItems: []
    };
    print80mmFinancialReport(zData);
    modal.toast.success("Closing Z-Report sent to 80mm thermal printer!");
  };

  // Formatted date string
  const todayFormatted = new Date().toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
        <div className="bg-card p-6 rounded-2xl border border-border shadow-xl flex items-center gap-3 text-foreground">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          <span className="font-bold text-sm">Verifying cashier shift state...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-card w-full max-w-xl max-h-[92vh] rounded-2xl shadow-2xl border border-border overflow-hidden flex flex-col text-foreground">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#E11D2A] text-white flex items-center justify-center p-2 shadow-sm shrink-0 border border-red-500/40">
              <MuchachosSymbol size={28} color="#FFFFFF" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black tracking-tight text-white flex items-center gap-1.5">
                  MUCHACHOS <span className="text-slate-300 font-bold text-sm">Shift Register</span>
                </h2>
                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  Shift #{shiftSequence}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 font-medium flex items-center gap-1.5">
                <span className="font-serif italic text-red-300">An Oasis Of Taste</span> &bull; {todayFormatted} &bull; Blind Cash Reconciliation
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">

          {/* ========================================================================= */}
          {/* STAGE 1: START A NEW SHIFT                                               */}
          {/* ========================================================================= */}
          {stage === 'START_SHIFT' && (
            <div className="space-y-6 animate-in fade-in">
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-500/10 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-blue-500/20">
                  <Play className="w-8 h-8 ml-1" />
                </div>
                <h3 className="text-2xl font-black text-foreground">
                  Open Register: Shift #{shiftSequence}
                </h3>
                <p className="text-mutedForeground text-xs font-medium mt-1">
                  Ready to take orders for <strong>{todayFormatted}</strong>. Count the starting drawer float before opening.
                </p>
              </div>

              {/* Past shifts summary on this day if any */}
              {todayShifts.length > 0 && (
                <div className="p-3.5 bg-muted/40 rounded-xl border border-border space-y-2 text-xs">
                  <div className="flex items-center justify-between font-bold text-mutedForeground">
                    <span className="flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-primary" /> Past Shifts Recorded Today:
                    </span>
                    <span className="text-[10px] font-black">{todayShifts.length} Shift(s)</span>
                  </div>
                  <div className="divide-y divide-border">
                    {todayShifts.map((s, idx) => (
                      <div key={s.id} className="py-1.5 flex items-center justify-between text-[11px]">
                        <span className="font-bold text-foreground">Shift #{idx + 1} ({s.status})</span>
                        <span className="text-mutedForeground">
                          {new Date(s.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} &rarr;{' '}
                          {s.closed_at ? new Date(s.closed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Open'}
                        </span>
                        <span className="font-bold text-foreground">Float: Rs. {s.starting_cash}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cashier Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-mutedForeground uppercase tracking-wider">
                  Cashier Name / Shift Tag (Optional)
                </label>
                <input 
                  type="text"
                  placeholder="e.g. Kamran (Evening Shift)"
                  value={cashierName}
                  onChange={(e) => setCashierName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-background border border-border rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Starting Cash Float */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-mutedForeground uppercase tracking-wider">
                    Starting Cash Float in Drawer (Opening Balance) *
                  </label>
                  <span className="text-[11px] font-bold text-primary">Petty Cash</span>
                </div>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-mutedForeground font-black text-lg">Rs.</span>
                  <input 
                    type="number"
                    value={startingCash === 0 ? '' : startingCash}
                    onChange={(e) => setStartingCash(Number(e.target.value))}
                    placeholder="1000"
                    className="w-full pl-12 pr-4 py-3 bg-background border-2 border-border focus:border-primary rounded-xl font-black text-2xl outline-none"
                  />
                </div>

                {/* Quick Float Buttons */}
                <div className="flex items-center gap-2 pt-1">
                  {[1000, 2000, 5000, 10000].map(amt => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setStartingCash(amt)}
                      className="px-3 py-1 bg-muted hover:bg-muted/80 text-foreground rounded-lg text-xs font-bold border border-border transition-colors"
                    >
                      Rs. {amt.toLocaleString()}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setStartingCash(0)}
                    className="px-2 py-1 text-mutedForeground hover:text-foreground text-xs font-bold"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Opening Verification Checkbox */}
              <label className="flex items-start gap-2.5 p-3 bg-muted/30 border border-border rounded-xl cursor-pointer">
                <input 
                  type="checkbox"
                  checked={verifiedOpeningDrawer}
                  onChange={(e) => setVerifiedOpeningDrawer(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-xs font-semibold text-foreground/90">
                  I confirm that I have physically counted <strong>Rs. {startingCash.toLocaleString()}</strong> in the register drawer before starting orders.
                </span>
              </label>

              {/* Start Button */}
              <button
                disabled={!verifiedOpeningDrawer || isProcessing}
                onClick={handleStartShift}
                className="w-full py-4 bg-primary hover:opacity-90 disabled:opacity-50 text-primaryForeground font-black text-lg rounded-xl shadow-lg transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>{isProcessing ? 'OPENING REGISTER...' : `OPEN REGISTER (START SHIFT #${shiftSequence})`}</span>
              </button>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STAGE 2: BLIND CASH AUDIT INPUT (Close Shift Step 1)                      */}
          {/* ========================================================================= */}
          {stage === 'BLIND_COUNT_INPUT' && activeShift && (
            <div className="space-y-6 animate-in fade-in">
              <div className="text-center">
                <div className="w-16 h-16 bg-red-500/10 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-3 border border-red-500/20">
                  <Square className="w-8 h-8 fill-current" />
                </div>
                <div className="flex items-center justify-center gap-2">
                  <h3 className="text-2xl font-black text-foreground">
                    Close Shift #{shiftSequence} (Z-Report)
                  </h3>
                </div>
                <p className="text-mutedForeground text-xs font-medium mt-1">
                  Opened at <strong>{new Date(activeShift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong> &bull; Float: <strong>Rs. {Number(activeShift.starting_cash || 0).toLocaleString()}</strong>
                  {activeShift.notes && <span className="block text-[11px] text-mutedForeground mt-0.5">({activeShift.notes})</span>}
                </p>
              </div>

              {/* LEFTOVER SHIFT WARNING BANNER */}
              {isLeftoverShift && (
                <div className="bg-amber-500/15 border-2 border-amber-500 rounded-2xl p-4 text-amber-900 dark:text-amber-200 flex items-start gap-3 shadow-md animate-in fade-in">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-black text-sm uppercase tracking-wide text-amber-800 dark:text-amber-300">
                      Yesterday&apos;s Shift Was Left Open!
                    </h4>
                    <p className="text-xs font-semibold mt-1">
                      Yesterday&apos;s Shift was left open ({new Date(activeShift.opened_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at {new Date(activeShift.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}). Please perform the blind cash count to close it before opening today&apos;s Shift #1.
                    </p>
                  </div>
                </div>
              )}

              {/* Blind Check Notice & Digital Overview */}
              <div className="bg-muted/40 rounded-2xl p-4 border border-border space-y-3">
                <div className="text-center pb-2 border-b border-border">
                  <p className="font-black text-sm text-foreground flex items-center justify-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-500" /> Blind Cash Drawer Check Active
                  </p>
                  <p className="text-[11px] text-mutedForeground mt-0.5">
                    Cash sales &amp; expected totals are strictly hidden to ensure honest blind physical counting.
                  </p>
                </div>

                {/* 3 Metric Summary Boxes */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-card p-3 rounded-xl border border-border text-center shadow-xs">
                    <span className="text-[10px] font-bold text-mutedForeground uppercase block">Cash Sales</span>
                    <span className="text-xl font-black text-mutedForeground tracking-widest block mt-0.5">***</span>
                    <span className="text-[9px] font-bold text-mutedForeground">Blind Hidden</span>
                  </div>

                  <div className="bg-blue-500/10 p-3 rounded-xl border border-blue-500/20 text-center shadow-xs">
                    <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase block">Digital Income</span>
                    <span className="text-lg font-black text-blue-600 dark:text-blue-400 block mt-0.5">
                      Rs. {shiftStats.digitalSalesTotal.toLocaleString()}
                    </span>
                    <span className="text-[9px] font-semibold text-mutedForeground block">
                      JC: {shiftStats.jazzcashSales} | EP: {shiftStats.easypaisaSales}
                    </span>
                  </div>

                  <div className="bg-pink-500/10 p-3 rounded-xl border border-pink-500/20 text-center shadow-xs">
                    <span className="text-[10px] font-bold text-pink-600 dark:text-pink-400 uppercase block">Foodpanda</span>
                    <span className="text-lg font-black text-pink-600 dark:text-pink-400 block mt-0.5">
                      Rs. {shiftStats.foodpandaSales.toLocaleString()}
                    </span>
                    <span className="text-[9px] font-semibold text-mutedForeground">Receivable</span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs pt-1 px-1">
                  <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-xl text-center">
                    <span className="text-[10px] text-mutedForeground font-bold uppercase block">Shift Orders</span>
                    <strong className="text-sm font-black text-foreground">{shiftStats.totalOrders}</strong>
                  </div>
                  <div className="bg-slate-100 dark:bg-slate-800 p-2 rounded-xl text-center">
                    <span className="text-[10px] text-mutedForeground font-bold uppercase block">Opening Float</span>
                    <strong className="text-sm font-black text-foreground">Rs. {Number(activeShift.starting_cash || 0).toLocaleString()}</strong>
                  </div>
                  <div className="bg-emerald-500/10 border border-emerald-500/20 p-2 rounded-xl text-center">
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold uppercase block">Expected In Drawer</span>
                    <strong className="text-sm font-black text-emerald-600 dark:text-emerald-400">Rs. {expectedCashInDrawer.toLocaleString()}</strong>
                  </div>
                </div>
              </div>

              {/* Physical Cash Input & Optional Denomination Calculator */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground uppercase tracking-wider">
                    Actual Physical Cash Counted in Drawer (Rs.) *
                  </label>
                  <button
                    type="button"
                    onClick={() => setUseDenominationCounter(!useDenominationCounter)}
                    className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    <span>{useDenominationCounter ? 'Direct Input Mode' : 'Open Note Counter Calculator'}</span>
                  </button>
                </div>

                {useDenominationCounter ? (
                  /* Denomination Note Counter */
                  <div className="p-4 bg-muted/30 border border-border rounded-2xl space-y-2.5 animate-in fade-in">
                    <span className="text-xs font-bold text-mutedForeground block mb-2">Count Note Quantities:</span>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {[5000, 1000, 500, 100, 50, 20, 10].map(denom => (
                        <div key={denom} className="flex items-center justify-between bg-card p-2 rounded-lg border border-border">
                          <span className="font-bold text-foreground">Rs. {denom}:</span>
                          <div className="flex items-center gap-1.5">
                            <input 
                              type="number"
                              min="0"
                              value={denominations[denom] || ''}
                              onChange={(e) => handleDenominationChange(denom, parseInt(e.target.value) || 0)}
                              placeholder="0"
                              className="w-14 px-2 py-1 bg-background border border-border rounded text-center font-bold text-xs"
                            />
                            <span className="w-16 text-right font-semibold text-mutedForeground text-[11px]">
                              = {(denom * (denominations[denom] || 0)).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="pt-2 border-t border-border flex items-center justify-between font-black text-sm text-foreground">
                      <span>Total Counted from Notes:</span>
                      <span className="text-lg text-primary">Rs. {calculatedDenomTotal.toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  /* Direct Cash Input */
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-mutedForeground font-black text-xl">Rs.</span>
                    <input 
                      type="number"
                      value={actualCash === 0 ? '' : actualCash}
                      onChange={(e) => setActualCash(Number(e.target.value))}
                      placeholder="Enter counted physical cash..."
                      className="w-full pl-14 pr-4 py-3.5 bg-background border-2 border-border focus:border-red-500 rounded-xl font-black text-2xl outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Drawer Expenses & Cash Payouts Section */}
              <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-4 border border-slate-200 dark:border-slate-700/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wallet className="w-4 h-4 text-amber-500" />
                    <span className="font-black text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">
                      Drawer Expenses &amp; Cash Payouts
                    </span>
                  </div>
                  <span className="text-xs font-black text-red-600 dark:text-red-400">
                    Total: Rs. {shiftStats.expensesTotal.toLocaleString()}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  Did the cashier or owner take cash from the drawer during this shift (e.g. mints, ice, owner cash)? Log it here to balance expected drawer cash.
                </p>

                {/* List of expenses logged this shift */}
                {shiftExpenses.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    {shiftExpenses.map(exp => (
                      <div key={exp.id} className="flex items-center justify-between p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                        <div>
                          <p className="font-bold text-slate-800 dark:text-white">{exp.description}</p>
                          <span className="text-[10px] text-slate-400 uppercase font-semibold">{exp.category}</span>
                        </div>
                        <span className="font-black text-red-600 dark:text-red-400">
                          -Rs. {Number(exp.amount).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Expense Form / Button */}
                {!isAddingExpense ? (
                  <button
                    type="button"
                    onClick={() => setIsAddingExpense(true)}
                    className="w-full py-2 px-3 border border-dashed border-amber-500/60 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>+ Add Drawer Expense / Owner Payout</span>
                  </button>
                ) : (
                  <div className="p-3 bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-xl space-y-2.5 animate-in fade-in">
                    <span className="text-xs font-black text-amber-600 dark:text-amber-400 block">
                      Record Cash Taken from Drawer
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={expenseDesc}
                        onChange={e => setExpenseDesc(e.target.value)}
                        placeholder="Description (e.g. Owner Withdrawal, Ice, Mint)"
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none"
                      />
                      <input
                        type="number"
                        min="1"
                        value={expenseAmount}
                        onChange={e => setExpenseAmount(e.target.value === '' ? '' : Number(e.target.value))}
                        placeholder="Amount (Rs.)"
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <select
                        value={expenseCategory}
                        onChange={e => setExpenseCategory(e.target.value)}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-bold outline-none"
                      >
                        <option value="Owner Withdrawal">Owner Withdrawal</option>
                        <option value="Kitchen Petty Cash">Kitchen Petty Cash</option>
                        <option value="Supplies & Mint">Supplies &amp; Mint</option>
                        <option value="Maintenance">Maintenance</option>
                        <option value="Delivery Fuel">Delivery Fuel</option>
                        <option value="Misc">Misc</option>
                      </select>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => { setIsAddingExpense(false); setExpenseDesc(""); setExpenseAmount(""); }}
                          className="px-3 py-1 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={handleAddShiftExpense}
                          className="px-3.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white font-black text-xs shadow-xs cursor-pointer"
                        >
                          Save Payout
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Negative Stock Interactive Reconciliation Card */}
              {negativeStockItems.length > 0 ? (
                <div className="bg-red-500/10 dark:bg-red-950/30 text-red-700 dark:text-red-300 p-4 sm:p-5 rounded-2xl border-2 border-red-500/30 space-y-3.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                      <div>
                        <h4 className="font-black text-sm uppercase tracking-wide text-red-900 dark:text-red-200">
                          Inventory Deficit Overrides Detected ({negativeStockItems.length})
                        </h4>
                        <p className="text-[11px] font-medium text-red-700/80 dark:text-red-300/80">
                          Kitchen overrode negative stock during this shift. Enter replenished stock &amp; current purchase cost to recalculate accurate shift COGS &amp; Gross Profit before closing.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 bg-white dark:bg-slate-900 rounded-xl p-3 border border-red-200 dark:border-red-900/50 divide-y divide-slate-100 dark:divide-slate-800">
                    {negativeStockItems.map(item => {
                      const input = reconcileInputs[item.id] || { addedQty: '', unitCost: '' };
                      return (
                        <div key={item.id} className="pt-2 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                          <div className="min-w-0 flex-1">
                            <span className="font-black text-xs text-slate-900 dark:text-slate-100 block truncate">
                              {item.name}
                            </span>
                            <span className="text-[11px] font-bold text-red-600 dark:text-red-400">
                              Deficit: {Number(item.current_stock).toFixed(0)} {item.base_unit || 'units'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div>
                              <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">
                                +Replenish Qty
                              </label>
                              <input
                                type="number"
                                inputMode="decimal"
                                value={input.addedQty}
                                onChange={e => {
                                  const val = e.target.value === '' ? '' : Number(e.target.value);
                                  setReconcileInputs(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], addedQty: val }
                                  }));
                                }}
                                className="w-24 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-black bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
                              />
                            </div>

                            <div>
                              <label className="text-[9px] font-black uppercase text-slate-400 block mb-0.5">
                                Unit Cost (Rs.)
                              </label>
                              <input
                                type="number"
                                inputMode="numeric"
                                value={input.unitCost}
                                onChange={e => {
                                  const val = e.target.value === '' ? '' : Number(e.target.value);
                                  setReconcileInputs(prev => ({
                                    ...prev,
                                    [item.id]: { ...prev[item.id], unitCost: val }
                                  }));
                                }}
                                className="w-24 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-black bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 outline-none"
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={handleSettleDeficitStock}
                    disabled={isReconciling}
                    className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white font-black text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {isReconciling ? 'Recalculating Shift COGS...' : 'Settle Stock & Recalculate Shift COGS Now'}
                  </button>
                </div>
              ) : reconcileSuccess ? (
                <div className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 p-3.5 rounded-xl border border-emerald-500/30 text-xs font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>All inventory deficits settled. Shift Gross Profit and COGS are 100% accurate!</span>
                </div>
              ) : null}

              {/* Reveal Audit Button */}
              <button
                onClick={handleRevealAudit}
                className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-black text-lg rounded-xl shadow-lg shadow-red-600/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <span>REVEAL Z-REPORT &amp; AUDIT DRAWER</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STAGE 3: THE REVEALED AUDIT REPORT & MESSAGE (Close Shift Step 2)         */}
          {/* ========================================================================= */}
          {stage === 'AUDIT_REVEALED' && activeShift && (
            <div className="space-y-6 animate-in zoom-in-95 duration-200">
              
              {/* THE REVELATION BANNER & STATUS MESSAGE */}
              {isBalanced ? (
                <div className="p-4 bg-emerald-500/10 border-2 border-emerald-500/40 rounded-2xl flex items-center gap-3 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="w-8 h-8 shrink-0" />
                  <div>
                    <h4 className="font-black text-base uppercase tracking-tight">
                      🎉 PERFECT DRAWER BALANCE!
                    </h4>
                    <p className="text-xs font-semibold mt-0.5">
                      Actual cash matches expected cash exactly. Zero variance detected (Rs. 0).
                    </p>
                  </div>
                </div>
              ) : isShortage ? (
                <div className="p-4 bg-red-500/10 border-2 border-red-500/40 rounded-2xl flex items-center gap-3 text-red-700 dark:text-red-400">
                  <AlertTriangle className="w-8 h-8 shrink-0 text-red-600" />
                  <div>
                    <h4 className="font-black text-base uppercase tracking-tight flex items-center gap-2">
                      ⚠️ CASH SHORTAGE: -Rs. {Math.abs(variance).toLocaleString()}
                    </h4>
                    <p className="text-xs font-semibold mt-0.5">
                      The drawer has less cash than expected from cash sales + float. Please log an explanation note below.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-blue-500/10 border-2 border-blue-500/40 rounded-2xl flex items-center gap-3 text-blue-700 dark:text-blue-400">
                  <AlertCircle className="w-8 h-8 shrink-0 text-blue-600" />
                  <div>
                    <h4 className="font-black text-base uppercase tracking-tight flex items-center gap-2">
                      ✨ CASH OVERAGE: +Rs. {variance.toLocaleString()}
                    </h4>
                    <p className="text-xs font-semibold mt-0.5">
                      The drawer has extra cash beyond recorded cash sales + opening float.
                    </p>
                  </div>
                </div>
              )}

              {/* RECONCILIATION SUMMARY TABLE */}
              <div className="bg-muted/30 border border-border rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between pb-2.5 border-b border-border text-xs font-bold text-mutedForeground">
                  <span>FINANCIAL AUDIT ITEM</span>
                  <span>AMOUNT (PKR)</span>
                </div>

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-mutedForeground">Opening Cash Float:</span>
                    <span className="font-bold text-foreground">Rs. {Number(activeShift.starting_cash || 0).toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between items-center">
                    <span className="text-mutedForeground">Total Cash Sales Collected:</span>
                    <span className="font-bold text-foreground">Rs. {shiftStats.cashSales.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between items-center text-red-600 dark:text-red-400">
                    <span>Drawer Expenses / Payouts Deducted:</span>
                    <span className="font-bold">-Rs. {shiftStats.expensesTotal.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between items-center py-2 px-3 bg-muted/60 rounded-xl font-bold text-foreground">
                    <span>Expected Cash in Drawer (Float + Cash - Payouts):</span>
                    <span className="text-sm font-black text-primary">Rs. {expectedCashInDrawer.toLocaleString()}</span>
                  </div>

                  <div className="flex justify-between items-center py-2 px-3 bg-muted/60 rounded-xl font-bold text-foreground">
                    <span>Actual Cash Counted by Cashier:</span>
                    <span className="text-sm font-black text-foreground">Rs. {actualCash.toLocaleString()}</span>
                  </div>

                  {/* Variance Row */}
                  <div className={`flex justify-between items-center py-2.5 px-3 rounded-xl font-black text-sm border ${
                    isBalanced ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600' :
                    isShortage ? 'bg-red-500/10 border-red-500/30 text-red-600' :
                    'bg-blue-500/10 border-blue-500/30 text-blue-600'
                  }`}>
                    <span>Drawer Discrepancy / Variance:</span>
                    <span className="text-base">
                      {variance === 0 ? 'Rs. 0 (Balanced)' : `${variance > 0 ? '+' : ''}Rs. ${variance.toLocaleString()}`}
                    </span>
                  </div>

                  {/* Non-cash breakdown */}
                  <div className="pt-2 border-t border-border space-y-1.5 text-[11px] text-mutedForeground">
                    <div className="flex justify-between">
                      <span>Digital Income (JazzCash / EasyPaisa / Card):</span>
                      <span className="font-bold text-foreground">Rs. {shiftStats.digitalSalesTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Foodpanda Receivable:</span>
                      <span className="font-bold text-foreground">Rs. {shiftStats.foodpandaSales.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between font-black text-foreground text-xs pt-1 border-t border-border">
                      <span>TOTAL GROSS REVENUE THIS SHIFT:</span>
                      <span className="text-primary">Rs. {shiftStats.grossSales.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span>Shift Orders Handled:</span>
                      <span className="font-bold text-foreground">{shiftStats.totalOrders} Orders</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Handover & Variance Notes Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-mutedForeground uppercase tracking-wider block">
                  Closing Handover Notes / Variance Explanation
                </label>
                <textarea
                  rows={2}
                  placeholder={
                    isShortage 
                      ? "Explain why the drawer is short (e.g. customer change dispute, petty expense)..." 
                      : "Optional notes for shift handover..."
                  }
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-background border border-border rounded-xl text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              {/* Action Buttons */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setStage('BLIND_COUNT_INPUT')}
                    className="px-4 py-3.5 rounded-xl bg-muted hover:bg-muted/80 text-foreground font-bold text-xs flex items-center justify-center gap-1.5 border border-border transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Re-count Cash</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsPrintPreviewOpen(true)}
                    className="flex-1 py-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow transition-colors"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Print Z-Report Slip</span>
                  </button>
                </div>

                <button
                  disabled={isProcessing}
                  onClick={handleFinalizeShift}
                  className="w-full py-4 bg-red-600 hover:bg-red-700 text-white font-black text-lg rounded-xl shadow-lg shadow-red-600/30 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  <Square className="w-5 h-5 fill-current" />
                  <span>{isProcessing ? 'CLOSING REGISTER...' : `CONFIRM & CLOSE SHIFT #${shiftSequence}`}</span>
                </button>
              </div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* STAGE 4: SHIFT CLOSED SUCCESS CONFIRMATION                                */}
          {/* ========================================================================= */}
          {stage === 'CLOSED_SUCCESS' && (
            <div className="text-center py-6 space-y-6 animate-in fade-in">
              <div className="w-20 h-20 bg-emerald-500/10 text-emerald-600 rounded-full flex items-center justify-center mx-auto border-2 border-emerald-500/30">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div className="space-y-1">
                <h3 className="text-2xl font-black text-foreground">
                  Shift #{shiftSequence} Officially Closed!
                </h3>
                <p className="text-xs text-mutedForeground">
                  Register drawer reconciled for {todayFormatted}. All sales and variance numbers recorded in system.
                </p>
              </div>

              <div className="p-4 bg-muted/40 rounded-2xl border border-border max-w-sm mx-auto text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-mutedForeground">Actual Cash Deposited:</span>
                  <span className="font-black text-foreground">Rs. {actualCash.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mutedForeground">Drawer Variance:</span>
                  <span className={`font-black ${variance < 0 ? 'text-red-500' : variance > 0 ? 'text-blue-500' : 'text-emerald-500'}`}>
                    {variance === 0 ? 'Rs. 0 (Balanced)' : `${variance > 0 ? '+' : ''}Rs. ${variance.toLocaleString()}`}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-mutedForeground">Total Gross Shift Revenue:</span>
                  <span className="font-black text-primary">Rs. {shiftStats.grossSales.toLocaleString()}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 max-w-sm mx-auto pt-2">
                <button
                  onClick={() => {
                    setStage('START_SHIFT');
                    setShiftSequence(prev => prev + 1);
                    setStartingCash(1000);
                    setActualCash(0);
                    setVerifiedOpeningDrawer(false);
                  }}
                  className="flex-1 py-3.5 bg-primary text-primaryForeground font-black text-xs rounded-xl shadow transition-all active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Start Next Shift (#{shiftSequence + 1})</span>
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-3.5 bg-muted hover:bg-muted/80 text-foreground font-bold text-xs rounded-xl border border-border transition-colors"
                >
                  Return to POS
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ========================================================================= */}
      {/* THERMAL Z-REPORT PRINTABLE SLIP MODAL                                     */}
      {/* ========================================================================= */}
      {isPrintPreviewOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-white text-slate-900 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 p-6 font-mono text-xs flex flex-col max-h-[88vh]">
            <div className="flex items-center justify-between pb-3 border-b border-dashed border-slate-300 mb-3">
              <span className="font-black text-sm uppercase">MUCHACHOS Z-REPORT</span>
              <button onClick={() => setIsPrintPreviewOpen(false)} className="p-1 hover:bg-slate-100 rounded">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-center pb-3 border-b border-dashed border-slate-300 space-y-0.5">
              <div className="flex justify-center mb-1">
                <MuchachosSymbol size={32} color="#000000" />
              </div>
              <h3 className="text-xl font-black tracking-wider text-black">MUCHACHOS</h3>
              <p className="text-[10px] font-serif italic text-slate-600">An Oasis Of Taste</p>
              <h4 className="text-xs font-black uppercase text-slate-800 pt-1 tracking-wider">END OF SHIFT REPORT</h4>
              <p className="font-bold text-slate-700 text-[11px]">SHIFT #{shiftSequence} OF TODAY</p>
              <p className="text-[10px] text-slate-500">{todayFormatted}</p>
              <p className="text-[10px] text-slate-500">
                Opened: {activeShift ? new Date(activeShift.opened_at).toLocaleTimeString() : ''}
              </p>
              <p className="text-[10px] text-slate-500">
                Closed: {new Date().toLocaleTimeString()}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 py-3 border-b border-dashed border-slate-300">
              <div className="flex justify-between">
                <span>Opening Cash Float:</span>
                <span className="font-bold">Rs. {Number(activeShift?.starting_cash || 0).toFixed(0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Cash Sales:</span>
                <span className="font-bold">Rs. {shiftStats.cashSales.toFixed(0)}</span>
              </div>
              <div className="flex justify-between font-bold pt-1 border-t border-slate-100">
                <span>Expected Drawer Cash:</span>
                <span>Rs. {expectedCashInDrawer.toFixed(0)}</span>
              </div>
              <div className="flex justify-between font-bold">
                <span>Actual Counted Cash:</span>
                <span>Rs. {actualCash.toFixed(0)}</span>
              </div>
              <div className={`flex justify-between font-black text-sm pt-1 border-t border-slate-200 ${
                variance < 0 ? 'text-red-600' : variance > 0 ? 'text-blue-600' : 'text-emerald-600'
              }`}>
                <span>DRAWER VARIANCE:</span>
                <span>{variance === 0 ? 'Rs. 0 (BALANCED)' : `${variance > 0 ? '+' : ''}Rs. ${variance.toFixed(0)}`}</span>
              </div>

              <div className="pt-2 border-t border-dashed border-slate-200 space-y-1 text-[11px] text-slate-600">
                <div className="flex justify-between">
                  <span>JazzCash Sales:</span>
                  <span>Rs. {shiftStats.jazzcashSales.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>EasyPaisa Sales:</span>
                  <span>Rs. {shiftStats.easypaisaSales.toFixed(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Foodpanda Receivable:</span>
                  <span>Rs. {shiftStats.foodpandaSales.toFixed(0)}</span>
                </div>
                <div className="flex justify-between font-black text-slate-900 pt-1 border-t border-slate-200">
                  <span>GROSS REVENUE:</span>
                  <span>Rs. {shiftStats.grossSales.toFixed(0)}</span>
                </div>
                <div className="flex justify-between text-[10px]">
                  <span>Total Shift Orders:</span>
                  <span>{shiftStats.totalOrders} Orders</span>
                </div>
              </div>

              {closingNotes && (
                <div className="pt-2 text-[10px] text-slate-600">
                  <span className="font-bold block">Closing Notes:</span>
                  <p>{closingNotes}</p>
                </div>
              )}
            </div>

            <div className="pt-3 space-y-4 text-[10px] text-slate-500">
              <div className="flex justify-between pt-4">
                <span className="border-t border-slate-400 pt-1 w-24 text-center">Cashier Sign</span>
                <span className="border-t border-slate-400 pt-1 w-24 text-center">Manager Sign</span>
              </div>
            </div>

            <div className="mt-4 pt-2 flex gap-2">
              <button
                onClick={handlePrintZReportThermal}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow cursor-pointer active:scale-95 transition-all"
                title="Print 80mm Z-Report on standard thermal receipt printer"
              >
                <Printer className="w-4 h-4" /> Print 80mm Z-Report
              </button>
              <button
                onClick={() => setIsPrintPreviewOpen(false)}
                className="py-2.5 px-4 rounded-xl bg-slate-100 text-slate-700 font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
