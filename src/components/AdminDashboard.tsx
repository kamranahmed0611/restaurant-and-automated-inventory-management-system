"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Order } from "@/types/database";
import { DollarSign, TrendingUp, CreditCard, Bike, Receipt, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function AdminDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTodayStats();
  }, []);

  const fetchTodayStats = async () => {
    setIsLoading(true);
    const today = new Date().toISOString().split('T')[0];

    // Fetch all completed/synced orders for today
    const { data } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', today)
      .order('created_at', { ascending: false });

    if (data) {
      setOrders(data);
    }
    setIsLoading(false);
  };

  // Calculate Metrics
  const activeOrders = orders.filter(o => o.status !== 'CANCELLED');
  const totalRevenue = activeOrders.reduce((sum, order) => sum + Number(order.net_total), 0);
  const cashRevenue = activeOrders.filter(o => o.payment_method === 'CASH').reduce((sum, order) => sum + Number(order.net_total), 0);
  const fpRevenue = activeOrders.filter(o => o.payment_method === 'FOODPANDA_RECEIVABLE').reduce((sum, order) => sum + Number(order.net_total), 0);
  
  // Real Foodpanda payout minus their commission
  const fpActualPayout = activeOrders.filter(o => o.payment_method === 'FOODPANDA_RECEIVABLE' && (o as any).fp_payout_status !== 'VOIDED').reduce((sum, order) => {
    const net = Number(order.net_total);
    const commission = net * (Number(order.foodpanda_commission_pct || 30) / 100);
    return sum + (net - commission);
  }, 0);

  return (
    <div className="flex flex-col gap-8">


      <div className="flex flex-col gap-8">
        
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2">
            <div className="flex items-center gap-2 text-slate-500 font-bold text-sm uppercase tracking-wider">
              <TrendingUp className="w-4 h-4 text-green-500" /> Total Gross Sales
            </div>
            <div className="text-4xl font-black text-slate-900">Rs. {totalRevenue.toFixed(0)}</div>
            <div className="text-xs font-bold text-slate-400 mt-1">{orders.length} Orders Today</div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2">
            <div className="flex items-center gap-2 text-slate-500 font-bold text-sm uppercase tracking-wider">
              <DollarSign className="w-4 h-4 text-emerald-500" /> Cash Drawer
            </div>
            <div className="text-4xl font-black text-emerald-600">Rs. {cashRevenue.toFixed(0)}</div>
            <div className="text-xs font-bold text-slate-400 mt-1">Physical cash expected</div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2">
            <div className="flex items-center gap-2 text-slate-500 font-bold text-sm uppercase tracking-wider">
              <Bike className="w-4 h-4 text-pink-500" /> Foodpanda Gross
            </div>
            <div className="text-4xl font-black text-slate-900">Rs. {fpRevenue.toFixed(0)}</div>
            <div className="text-xs font-bold text-pink-500 mt-1">Est. Payout: Rs. {fpActualPayout.toFixed(0)} (-30%)</div>
          </div>

          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-2">
            <div className="flex items-center gap-2 text-slate-500 font-bold text-sm uppercase tracking-wider">
              <CreditCard className="w-4 h-4 text-blue-500" /> JazzCash & EasyPaisa
            </div>
            <div className="text-4xl font-black text-slate-900">
              Rs. {orders.filter(o => ['JAZZCASH', 'EASYPAISA'].includes(o.payment_method as string)).reduce((s, o) => s + Number(o.net_total), 0).toFixed(0)}
            </div>
            <div className="text-xs font-bold text-slate-400 mt-1">Direct to bank</div>
          </div>
        </div>

        {/* Recent Transactions Table */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-slate-500" />
            <h2 className="font-bold text-slate-700">Today&apos;s Transactions</h2>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 text-xs uppercase tracking-wider font-bold">
                  <th className="p-4">Time</th>
                  <th className="p-4">Token</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Payment</th>
                  <th className="p-4 text-right">Amount</th>
                  <th className="p-4 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400 font-medium">Loading ledger...</td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400 font-medium">No sales recorded today.</td>
                  </tr>
                ) : (
                  orders.map(order => (
                    <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                      <td className="p-4 text-sm font-medium text-slate-600">
                        {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="p-4 font-black text-slate-900">#{order.token_number.toString().padStart(3, '0')}</td>
                      <td className="p-4">
                        <span className="text-xs font-bold bg-slate-100 text-slate-600 px-2 py-1 rounded">
                          {order.order_type.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          order.payment_method === 'CASH' ? 'bg-emerald-100 text-emerald-700' : order.payment_method === 'FOODPANDA_RECEIVABLE' ? 'bg-pink-100 text-pink-700' : order.payment_method === 'EASYPAISA' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'
                        }`}>
                          {order.payment_method.replace('_RECEIVABLE', '')}
                        </span>
                      </td>
                      <td className="p-4 text-right font-black text-slate-900">Rs. {Number(order.net_total).toFixed(0)}</td>
                      <td className="p-4 text-center">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${
                          order.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                        }`}>
                          {order.status}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}



