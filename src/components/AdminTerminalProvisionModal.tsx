"use client";

import React, { useState, useEffect } from "react";
import { 
  X, Laptop, ShieldCheck, KeyRound, CheckCircle2, 
  AlertTriangle, RefreshCw, Lock, Mail, Eye, EyeOff 
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { modal } from "@/lib/modalStore";

interface AdminTerminalProvisionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminTerminalProvisionModal({ isOpen, onClose }: AdminTerminalProvisionModalProps) {
  const [isElectron, setIsElectron] = useState(false);
  const [isProvisioned, setIsProvisioned] = useState(false);
  const [provisionedEmail, setProvisionedEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      checkProvisioningStatus();
    }
  }, [isOpen]);

  const checkProvisioningStatus = async () => {
    setIsLoading(true);
    setStatusMessage(null);
    try {
      const electronAvailable = typeof window !== 'undefined' && Boolean((window as any).electronAPI?.getTerminalCredentials);
      setIsElectron(electronAvailable);

      if (electronAvailable) {
        const creds = await (window as any).electronAPI.getTerminalCredentials();
        if (creds && creds.email) {
          setIsProvisioned(true);
          setProvisionedEmail(creds.email);
          setEmail(creds.email);
        } else {
          setIsProvisioned(false);
          setProvisionedEmail(null);
        }
      }
    } catch (err: any) {
      console.warn("[Provisioning] Check error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestAndSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setStatusMessage({ type: 'error', text: 'Please enter both terminal email and password.' });
      return;
    }

    setIsSaving(true);
    setStatusMessage({ type: 'info', text: 'Validating credentials against Supabase Auth...' });

    try {
      // 1. Verify credentials by authenticating against Supabase
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: password.trim()
      });

      if (authError || !authData.session) {
        setStatusMessage({ 
          type: 'error', 
          text: `Authentication failed: ${authError?.message || 'Invalid credentials'}. Please verify the user account in Supabase Auth.` 
        });
        setIsSaving(false);
        return;
      }

      // 2. Encrypt and store hardware credentials via Electron safeStorage
      if ((window as any).electronAPI?.saveTerminalCredentials) {
        const saveRes = await (window as any).electronAPI.saveTerminalCredentials({
          email: email.trim(),
          password: password.trim()
        });

        if (saveRes.success) {
          setIsProvisioned(true);
          setProvisionedEmail(email.trim());
          setPassword("");
          setStatusMessage({ 
            type: 'success', 
            text: 'Terminal provisioned successfully! Credentials are encrypted with Windows DPAPI.' 
          });
          modal.toast.success("Hardware terminal credentials provisioned successfully.");
        } else {
          setStatusMessage({ 
            type: 'error', 
            text: `Hardware storage failed: ${saveRes.error}` 
          });
        }
      } else {
        setStatusMessage({ 
          type: 'error', 
          text: 'Hardware encryption API is only available inside the native Windows desktop app.' 
        });
      }
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: `Provisioning error: ${err.message}` });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col text-white">
        
        {/* Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">Terminal Provisioning & DPAPI</h2>
              <p className="text-xs text-slate-400">Offline token auto-recovery & machine authentication</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {!isElectron ? (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200 leading-relaxed">
                <span className="font-bold text-amber-300">Remote Cloud Mode Detected</span>
                <p className="mt-1">
                  Terminal hardware provisioning via Windows DPAPI (<code className="text-amber-300">safeStorage</code>) is only applicable on the counter laptop running the native desktop application.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Provisioning Status Badge */}
              <div className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className={`w-5 h-5 ${isProvisioned ? 'text-emerald-400' : 'text-amber-400'}`} />
                  <div>
                    <span className="text-xs font-bold block">
                      {isProvisioned ? "Hardware Provisioned" : "Not Yet Provisioned"}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {isProvisioned 
                        ? `Account: ${provisionedEmail}` 
                        : "Requires terminal service account"}
                    </span>
                  </div>
                </div>
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                  isProvisioned 
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' 
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                }`}>
                  {isProvisioned ? "DPAPI Active" : "Action Needed"}
                </span>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                When the terminal runs offline for weeks, cloud JWT refresh tokens expire. The stored machine account allows the sync engine to automatically re-authenticate and sync upstream with zero cashier intervention.
              </p>

              {/* Status Message */}
              {statusMessage && (
                <div className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  statusMessage.type === 'success' 
                    ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300' 
                    : statusMessage.type === 'error'
                    ? 'bg-red-500/10 border border-red-500/20 text-red-300'
                    : 'bg-blue-500/10 border border-blue-500/20 text-blue-300'
                }`}>
                  {statusMessage.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  ) : statusMessage.type === 'error' ? (
                    <AlertTriangle className="w-4 h-4 shrink-0 text-red-400" />
                  ) : (
                    <RefreshCw className="w-4 h-4 shrink-0 animate-spin text-blue-400" />
                  )}
                  <span>{statusMessage.text}</span>
                </div>
              )}

              {/* Form */}
              <form onSubmit={handleTestAndSave} className="space-y-3">
                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Terminal Service Account Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="terminal@muchachos.pk"
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-bold text-slate-400 block mb-1">
                    Terminal Service Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      required
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-9 py-2 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSaving}
                  className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 cursor-pointer mt-2"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Verifying &amp; Encrypting...
                    </>
                  ) : (
                    <>
                      <KeyRound className="w-4 h-4" /> Verify &amp; Save to safeStorage
                    </>
                  )}
                </button>
              </form>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex justify-between items-center text-xs text-slate-500">
          <span>Windows DPAPI Credential Store</span>
          <button 
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
}

