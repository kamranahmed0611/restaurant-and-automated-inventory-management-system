"use client";

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { 
  Lock, Mail, Eye, EyeOff, ShieldCheck, ArrowRight, 
  Store, AlertCircle, Sun, Moon, CheckCircle2 
} from "lucide-react";
import { useTheme } from "next-themes";
import { supabase } from "@/lib/supabase";
import MuchachosBrand, { MuchachosSymbol } from "@/components/MuchachosBrand";
import TeddopsBranding from "@/components/TeddopsBranding";
import { isLaptopWriter } from "@/lib/device-mode";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/admin';

  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isLaptop, setIsLaptop] = useState(false);
  const isAdminOnly = process.env.NEXT_PUBLIC_ADMIN_ONLY === 'true';

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    const laptop = isLaptopWriter();
    setIsLaptop(laptop);
    if (laptop) {
      window.location.href = '/pos';
      return;
    }
    // If redirected here from /admin on remote cloud, do not automatically bounce back into an infinite redirect loop
    if (searchParams.get('redirect')) {
      return;
    }
    async function checkExistingSession() {
      try {
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          window.location.href = redirectPath;
        }
      } catch (err) {
        console.warn("[Auth] Check session note:", err);
      }
    }
    checkExistingSession();
  }, [redirectPath, searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setErrorMessage("Please enter both email and password.");
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || result?.error) {
        const errorMsg = result?.error || 'Authentication failed.';
        if (errorMsg.includes('Invalid login credentials')) {
          setErrorMessage('Invalid email or password. Please verify your Owner credentials.');
        } else if (errorMsg.includes('Email not confirmed')) {
          setErrorMessage('Email not confirmed in Supabase. Please disable Email Confirmation in Supabase Auth settings.');
        } else {
          setErrorMessage(errorMsg);
        }
        setIsLoading(false);
        return;
      }

      setSuccessMessage('Authenticated successfully! Redirecting...');
      setTimeout(() => {
        window.location.href = redirectPath;
      }, 500);
    } catch (err: any) {
      // Fallback: try client-side direct auth
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password,
        });

        if (error) {
          setErrorMessage(error.message || 'Failed to sign in. Please check your credentials.');
          setIsLoading(false);
          return;
        }

        if (data?.session) {
          setSuccessMessage('Authenticated successfully! Redirecting...');
          setTimeout(() => {
            window.location.href = redirectPath;
          }, 500);
          return;
        }
      } catch (clientErr: any) {
        setErrorMessage(clientErr.message || 'Failed to connect to authentication service.');
      }
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col justify-between bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-200 selection:bg-red-600 selection:text-white">
      
      {/* Top Navigation Bar */}
      <header className="px-4 sm:px-8 py-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <MuchachosBrand size="sm" subtitle="EXECUTIVE" />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="p-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 transition-all cursor-pointer shadow-sm active:scale-95"
            title="Toggle theme"
          >
            {mounted && resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4 text-amber-400" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* Main Login Card Area */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl p-6 sm:p-10 flex flex-col">
          
          {/* Brand Header */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="mb-4">
              <div className="w-16 h-16 rounded-xl bg-red-600 flex items-center justify-center shadow-md">
                <MuchachosSymbol className="w-10 h-10 text-white" />
              </div>
            </div>

            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white uppercase flex items-center gap-2">
              <span>Owner Portal</span>
            </h1>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mt-2 max-w-xs leading-relaxed">
              Sign in to manage recipes, menu prices, expenses &amp; store financials
            </p>
          </div>

          {/* Feedback Messages */}
          {errorMessage && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 text-red-600 dark:text-red-400 text-sm font-medium flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-5 p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-sm font-medium flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                Owner Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Mail className="w-4 h-4" />
                </div>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@muchachos.pk"
                  disabled={isLoading}
                  className="w-full pl-10 pr-4 py-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all disabled:opacity-60 shadow-sm"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="login-password" className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Password
                </label>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  disabled={isLoading}
                  className="w-full pl-10 pr-11 py-3 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all disabled:opacity-60 shadow-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-3 px-4 rounded-lg bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {isLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Verifying Session...</span>
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Cashier Terminal Quick Switch */}
          {!isAdminOnly && (
            <div className="mt-8 pt-6 border-t border-slate-200 dark:border-slate-800 text-center">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                Are you a shop cashier?
              </p>
              <a
                href="/"
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-sm transition-all active:scale-95 border border-slate-200 dark:border-slate-700"
              >
                <span>Go to POS Terminal &rarr;</span>
              </a>
            </div>
          )}
        </div>

        {/* Official Engineering & Company Credits */}
        <TeddopsBranding variant="card" className="mt-8 max-w-md w-full" />
      </main>

      {/* Security Footer */}
      <footer className="py-4 px-6 text-center text-xs font-medium text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <ShieldCheck className="w-4 h-4 text-emerald-500" />
        <span>Supabase Cloud Auth &bull; 256-bit Encrypted Session</span>
      </footer>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="w-8 h-8 border-3 border-[#E11D2A] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}