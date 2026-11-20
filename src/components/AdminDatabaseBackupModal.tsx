"use client";

import React, { useState, useEffect } from "react";
import { 
  X, Download, Upload, Database, CheckCircle2, AlertTriangle, 
  RefreshCw, HardDrive, ShieldAlert, Archive, Folder, FolderOpen, Check
} from "lucide-react";
import { db } from "@/lib/db";
import { modal } from "@/lib/modalStore";
import { 
  createBackup, 
  verifyBackupChecksum, 
  generateDexieBackupPayload 
} from "@/lib/auto-backup";

interface AdminDatabaseBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface TableStats {
  orders: number;
  shifts: number;
  menu_items: number;
  raw_inventory: number;
  recipes: number;
  deal_components: number;
  modifiers: number;
  categories: number;
  expenses: number;
  cashiers: number;
  inventory_logs: number;
  pendingTotal: number;
}

export default function AdminDatabaseBackupModal({ isOpen, onClose }: AdminDatabaseBackupModalProps) {
  const [stats, setStats] = useState<TableStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [activeTab, setActiveTab] = useState<'EXPORT' | 'RESTORE'>('EXPORT');
  const [backupDir, setBackupDir] = useState<string>('');
  const [restoreFile, setRestoreFile] = useState<{ name: string; content: string } | null>(null);
  const [restorePreview, setRestorePreview] = useState<any | null>(null);
  const [checksumStatus, setChecksumStatus] = useState<{ valid: boolean; message: string } | null>(null);
  const [backupList, setBackupList] = useState<Array<{ fileName: string; filePath: string; sizeBytes: number; createdAt: string }>>([]);
  const [backupListLoading, setBackupListLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadStats();
      loadBackupDirectory();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && activeTab === 'RESTORE') {
      loadBackupList();
    }
  }, [isOpen, activeTab]);

  const loadBackupList = async () => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.listBackups) return;
    setBackupListLoading(true);
    try {
      const files = await (window as any).electronAPI.listBackups();
      setBackupList(Array.isArray(files) ? files : []);
    } catch {
      setBackupList([]);
    } finally {
      setBackupListLoading(false);
    }
  };

  const handleSelectBackupFromList = async (filePath: string, fileName: string) => {
    if (typeof window === 'undefined' || !(window as any).electronAPI?.loadBackupFile) return;
    try {
      const res = await (window as any).electronAPI.loadBackupFile(filePath);
      if (res?.success && res.content) {
        await parseAndVerifyBackupString(res.content, fileName);
      } else {
        modal.toast.error('Could not read backup file: ' + (res?.error || 'Unknown error'));
      }
    } catch (err: any) {
      modal.toast.error('Error loading backup: ' + err.message);
    }
  };

  const loadBackupDirectory = async () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.getBackupDirectory) {
      try {
        const dir = await (window as any).electronAPI.getBackupDirectory();
        setBackupDir(dir || '');
      } catch {}
    }
  };

  const handleChangeFolder = async () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.selectBackupDirectory) {
      try {
        const res = await (window as any).electronAPI.selectBackupDirectory();
        if (res?.success && res.directory) {
          setBackupDir(res.directory);
          modal.toast.success("Backup folder updated successfully.");
        }
      } catch (err: any) {
        modal.toast.error("Could not change folder: " + err.message);
      }
    }
  };

  const loadStats = async () => {
    setIsLoading(true);
    try {
      const [
        orders, shifts, menu_items, raw_inventory,
        recipes, deal_components, modifiers, categories,
        expenses, cashiers, inventory_logs
      ] = await Promise.all([
        db.orders.toArray(),
        db.shifts.toArray(),
        db.menu_items.toArray(),
        db.raw_inventory.toArray(),
        db.recipes.toArray(),
        db.deal_components.toArray(),
        db.modifiers.toArray(),
        db.categories.toArray(),
        db.expenses.toArray(),
        db.cashiers.toArray(),
        db.inventory_logs.toArray()
      ]);

      const pendingOrders = orders.filter(o => o.sync_status === 'PENDING').length;
      const pendingShifts = shifts.filter(s => s.sync_status === 'PENDING').length;
      const pendingExpenses = expenses.filter(e => e.sync_status === 'PENDING').length;
      const pendingLogs = inventory_logs.filter(l => l.sync_status === 'PENDING').length;
      const pendingMenuItems = menu_items.filter(m => (m as any).sync_status === 'PENDING').length;
      const pendingRawInventory = raw_inventory.filter(r => (r as any).sync_status === 'PENDING').length;
      const pendingRecipes = recipes.filter(r => (r as any).sync_status === 'PENDING').length;

      setStats({
        orders: orders.length,
        shifts: shifts.length,
        menu_items: menu_items.length,
        raw_inventory: raw_inventory.length,
        recipes: recipes.length,
        deal_components: deal_components.length,
        modifiers: modifiers.length,
        categories: categories.length,
        expenses: expenses.length,
        cashiers: cashiers.length,
        inventory_logs: inventory_logs.length,
        pendingTotal: pendingOrders + pendingShifts + pendingExpenses + pendingLogs + pendingMenuItems + pendingRawInventory + pendingRecipes
      });
    } catch (err) {
      console.error("[Backup] Failed to inspect table stats:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportBackup = async () => {
    setIsBackingUp(true);
    try {
      const result = await createBackup('manual-admin-backup');
      if (result.success) {
        if (result.filePath) {
          modal.success(
            "Backup Created Successfully!",
            `Saved to: ${result.filePath}\nChecksum (SHA-256): ${result.manifest?.checksum.slice(0, 16)}...\nRetaining last 30 backups.`
          );
        } else {
          modal.toast.success("Backup downloaded with SHA-256 checksum manifest.");
        }
        loadStats();
      } else {
        modal.error("Backup Failed", result.error || "Could not write backup.");
      }
    } catch (err: any) {
      modal.error("Backup Error", err.message);
    } finally {
      setIsBackingUp(false);
    }
  };

  const parseAndVerifyBackupString = async (contentStr: string, fileName: string) => {
    try {
      const parsed = JSON.parse(contentStr);
      if (!parsed.database) {
        modal.warning("Invalid Backup File", "This JSON does not contain valid Muchachos POS database records.");
        setRestorePreview(null);
        setChecksumStatus(null);
        return;
      }

      setRestoreFile({ name: fileName, content: contentStr });
      setRestorePreview(parsed);

      // Verify SHA-256 checksum
      if (parsed.manifest?.checksum) {
        const verifyRes = await verifyBackupChecksum(parsed);
        if (verifyRes.valid) {
          setChecksumStatus({
            valid: true,
            message: `SHA-256 Checksum Verified: ${verifyRes.computedChecksum.slice(0, 16)}...`
          });
        } else {
          setChecksumStatus({
            valid: false,
            message: `Checksum mismatch! Expected: ${verifyRes.expectedChecksum.slice(0, 8)}..., Calculated: ${verifyRes.computedChecksum.slice(0, 8)}...`
          });
        }
      } else {
        setChecksumStatus({
          valid: true,
          message: "Legacy backup format (no manifest checksum attached)"
        });
      }
    } catch {
      modal.error("File Parse Error", "The selected file is not valid JSON.");
      setRestorePreview(null);
      setChecksumStatus(null);
    }
  };

  const handlePickNativeFile = async () => {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.pickBackupFile) {
      try {
        const res = await (window as any).electronAPI.pickBackupFile();
        if (res?.success && res.content) {
          await parseAndVerifyBackupString(res.content, res.fileName);
        }
      } catch (err: any) {
        modal.toast.error("Error opening backup: " + err.message);
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      await parseAndVerifyBackupString(content, file.name);
    };
    reader.readAsText(file);
  };

  const handleRestoreDatabase = async () => {
    if (!restorePreview || !restorePreview.database) return;

    if (checksumStatus && !checksumStatus.valid) {
      modal.error(
        "Checksum Verification Failed",
        "The SHA-256 checksum of this file does not match its manifest. The file may be corrupt or tampered with. Restore aborted for safety."
      );
      return;
    }

    const ok = await modal.confirm({
      title: "Restore & Overwrite Database?",
      message: `This will replace all current data with the backup from ${restorePreview.manifest?.timestamp || restorePreview.metadata?.exported_at}.\n\nA pre-restore safety backup will be created first automatically. Continue?`,
      confirmText: "Create Safety Backup & Restore",
      isDanger: true
    });
    if (!ok) return;

    setIsRestoring(true);
    try {
      // 1. Create automatic pre-restore safety backup first
      await createBackup('pre-restore-safety-backup');

      const d = restorePreview.database;

      // 2. Perform atomic restore inside Dexie transaction
      await db.transaction('rw', [
        db.orders, db.shifts, db.menu_items, db.raw_inventory,
        db.recipes, db.deal_components, db.modifiers, db.categories,
        db.expenses, db.cashiers, db.inventory_logs
      ], async () => {
        // Clear all tables
        await Promise.all([
          db.orders.clear(),
          db.shifts.clear(),
          db.menu_items.clear(),
          db.raw_inventory.clear(),
          db.recipes.clear(),
          db.deal_components.clear(),
          db.modifiers.clear(),
          db.categories.clear(),
          db.expenses.clear(),
          db.cashiers.clear(),
          db.inventory_logs.clear()
        ]);

        // Bulk insert restored snapshots
        if (d.orders?.length) await db.orders.bulkPut(d.orders);
        if (d.shifts?.length) await db.shifts.bulkPut(d.shifts);
        if (d.menu_items?.length) await db.menu_items.bulkPut(d.menu_items);
        if (d.raw_inventory?.length) await db.raw_inventory.bulkPut(d.raw_inventory);
        if (d.recipes?.length) await db.recipes.bulkPut(d.recipes);
        if (d.deal_components?.length) await db.deal_components.bulkPut(d.deal_components);
        if (d.modifiers?.length) await db.modifiers.bulkPut(d.modifiers);
        if (d.categories?.length) await db.categories.bulkPut(d.categories);
        if (d.expenses?.length) await db.expenses.bulkPut(d.expenses);
        if (d.cashiers?.length) await db.cashiers.bulkPut(d.cashiers);
        if (d.inventory_logs?.length) await db.inventory_logs.bulkPut(d.inventory_logs);
      });

      // 3. Restore LocalStorage Settings if present
      if (restorePreview.settings && typeof window !== 'undefined') {
        Object.entries(restorePreview.settings).forEach(([key, val]) => {
          if (typeof val === 'string') {
            localStorage.setItem(key, val);
          }
        });
      }

      modal.success("Restore Successful", "Database restored completely. The application will now reload.");
      setTimeout(() => {
        window.location.reload();
      }, 1200);
    } catch (err: any) {
      modal.error("Restore Failed", "Could not complete database restore: " + err.message);
    } finally {
      setIsRestoring(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">Muchachos Backup & Restore</h2>
              <p className="text-xs text-slate-400">Configurable JSON snapshots with SHA-256 checksums & 30-backup retention</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex border-b border-slate-800 bg-slate-950/30 px-5 pt-3">
          <button
            onClick={() => setActiveTab('EXPORT')}
            className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'EXPORT'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-4 h-4" /> Backup Now
          </button>
          <button
            onClick={() => setActiveTab('RESTORE')}
            className={`pb-3 px-4 text-xs font-bold uppercase tracking-wider flex items-center gap-2 border-b-2 transition-colors ${
              activeTab === 'RESTORE'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload className="w-4 h-4" /> Restore from Backup
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          {activeTab === 'EXPORT' ? (
            <>
              {/* Backup Folder Config */}
              <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                    <Folder className="w-3.5 h-3.5 text-blue-400" /> Backup Destination Folder
                  </div>
                  <div className="font-mono text-slate-200 truncate" title={backupDir || 'Documents/MuchachosPOS_Backups'}>
                    {backupDir || '%USERPROFILE%/Documents/MuchachosPOS_Backups/'}
                  </div>
                </div>
                {typeof window !== 'undefined' && Boolean((window as any).electronAPI?.selectBackupDirectory) && (
                  <button
                    onClick={handleChangeFolder}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs shrink-0 transition-colors flex items-center gap-1.5"
                  >
                    <FolderOpen className="w-3.5 h-3.5" /> Change Folder
                  </button>
                )}
              </div>

              {/* Table Metrics Summary */}
              <div className="bg-slate-950/50 border border-slate-800/80 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                    <HardDrive className="w-3.5 h-3.5 text-blue-400" /> Current Terminal Records (Dexie)
                  </span>
                  <button 
                    onClick={loadStats} 
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <div className="text-base font-black text-white">{stats?.orders ?? '—'}</div>
                    <div className="text-[10px] text-slate-400 uppercase">Orders</div>
                  </div>
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <div className="text-base font-black text-white">{stats?.shifts ?? '—'}</div>
                    <div className="text-[10px] text-slate-400 uppercase">Shifts</div>
                  </div>
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <div className="text-base font-black text-white">{stats?.menu_items ?? '—'}</div>
                    <div className="text-[10px] text-slate-400 uppercase">Menu Items</div>
                  </div>
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <div className="text-base font-black text-white">{stats?.raw_inventory ?? '—'}</div>
                    <div className="text-[10px] text-slate-400 uppercase">Raw Stock</div>
                  </div>
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <div className="text-base font-black text-white">{stats?.expenses ?? '—'}</div>
                    <div className="text-[10px] text-slate-400 uppercase">Expenses</div>
                  </div>
                  <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800">
                    <div className="text-base font-black text-white">{stats?.recipes ?? '—'}</div>
                    <div className="text-[10px] text-slate-400 uppercase">Recipes</div>
                  </div>
                </div>
              </div>

              {/* Automatic Trigger Notice */}
              <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300">
                <span className="font-bold">Automated Protections:</span> Backups are triggered automatically every 6 hours, upon shift close, and before dangerous operations. System automatically retains the last 30 backups.
              </div>

              <button
                onClick={handleExportBackup}
                disabled={isLoading || isBackingUp}
                className="w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50"
              >
                {isBackingUp ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Creating Backup...
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" /> Backup Now
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              {/* Restore Warning */}
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200">
                  <span className="font-bold text-amber-300">Restore & Integrity Check</span>
                  <p className="mt-0.5 text-amber-200/80">
                    Validates SHA-256 checksum, creates a safety backup of current data, then atomically replaces all Dexie tables.
                  </p>
                </div>
              </div>

              {/* Backup List from Electron */}
              {typeof window !== 'undefined' && Boolean((window as any).electronAPI?.listBackups) && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Backups on this machine ({backupList.length})
                    </span>
                    <button
                      onClick={loadBackupList}
                      className="text-[10px] text-slate-400 hover:text-slate-200 flex items-center gap-1 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${backupListLoading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                  </div>
                  <div className="rounded-xl border border-slate-700 overflow-hidden max-h-44 overflow-y-auto">
                    {backupListLoading ? (
                      <div className="p-4 text-center text-xs text-slate-500">Loading backups…</div>
                    ) : backupList.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-500">
                        No backups found in the configured backup folder.
                        <br />Set a folder in the Export tab first.
                      </div>
                    ) : (
                      backupList.map((b) => (
                        <button
                          key={b.filePath}
                          onClick={() => handleSelectBackupFromList(b.filePath, b.fileName)}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-slate-700/60 transition-colors border-b border-slate-800 last:border-0 ${restoreFile?.name === b.fileName ? 'bg-amber-900/30 border-l-2 border-l-amber-500' : 'bg-slate-900/60'}`}
                        >
                          <div className="flex flex-col min-w-0">
                            <span className="font-mono text-slate-200 truncate">{b.fileName}</span>
                            <span className="text-slate-500 text-[10px]">
                              {new Date(b.createdAt).toLocaleString()} · {(b.sizeBytes / 1024).toFixed(1)} KB
                            </span>
                          </div>
                          {restoreFile?.name === b.fileName && (
                            <Check className="w-3.5 h-3.5 text-amber-400 shrink-0 ml-2" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Divider / Import from elsewhere */}
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-slate-800" />
                <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">or import from elsewhere</span>
                <div className="flex-1 h-px bg-slate-800" />
              </div>

              {/* Native Picker Button if Electron */}
              {typeof window !== 'undefined' && Boolean((window as any).electronAPI?.pickBackupFile) && (
                <button
                  onClick={handlePickNativeFile}
                  className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold flex items-center justify-center gap-2 transition-colors border border-slate-700"
                >
                  <FolderOpen className="w-4 h-4 text-amber-400" /> Browse for backup file…
                </button>
              )}

              {/* File Uploader (web fallback) */}
              {(typeof window === 'undefined' || !(window as any).electronAPI) && (
                <div className="border-2 border-dashed border-slate-700 hover:border-slate-600 rounded-xl p-5 text-center bg-slate-950/30 transition-colors">
                  <input
                    type="file"
                    id="backupFileInput"
                    accept=".json"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <label htmlFor="backupFileInput" className="cursor-pointer flex flex-col items-center">
                    <Archive className="w-7 h-7 text-slate-400 mb-2" />
                    <span className="text-xs font-bold text-slate-300">
                      {restoreFile ? restoreFile.name : "Choose JSON Backup File"}
                    </span>
                    <span className="text-[11px] text-slate-500 mt-1">
                      Select a muchachos-backup-*.json file
                    </span>
                  </label>
                </div>
              )}

              {/* Checksum Status */}
              {checksumStatus && (
                <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
                  checksumStatus.valid 
                    ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' 
                    : 'bg-red-500/10 border-red-500/20 text-red-300'
                }`}>
                  {checksumStatus.valid ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <span>{checksumStatus.message}</span>
                </div>
              )}

              {/* Preview of Selected Backup */}
              {restorePreview && (
                <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3.5 space-y-2 text-xs">
                  <div className="font-bold text-white flex items-center justify-between">
                    <span>Backup Preview — {restoreFile?.name}</span>
                    <span className="text-[10px] text-emerald-400 font-mono">
                      {restorePreview.manifest?.schema_version ? `Schema v${restorePreview.manifest.schema_version}` : 'Snapshot'}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-slate-300 text-[11px]">
                    <div>Timestamp: <span className="font-mono text-white">{new Date(restorePreview.manifest?.timestamp || restorePreview.metadata?.exported_at).toLocaleString()}</span></div>
                    <div>App Version: <span className="font-mono text-white">{restorePreview.manifest?.app_version || '0.1.0'}</span></div>
                    <div>Orders: <span className="font-bold text-white">{restorePreview.database?.orders?.length || 0}</span></div>
                    <div>Shifts: <span className="font-bold text-white">{restorePreview.database?.shifts?.length || 0}</span></div>
                    <div>Menu Items: <span className="font-bold text-white">{restorePreview.database?.menu_items?.length || 0}</span></div>
                    <div>Raw Stock: <span className="font-bold text-white">{restorePreview.database?.raw_inventory?.length || 0}</span></div>
                  </div>
                </div>
              )}

              <button
                onClick={handleRestoreDatabase}
                disabled={Boolean(!restorePreview || isRestoring || (checksumStatus && !checksumStatus.valid))}
                className="w-full py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-600/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isRestoring ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Restoring Database & Settings...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" /> Restore from Backup
                  </>
                )}
              </button>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex justify-between items-center text-xs text-slate-500">
          <span>Muchachos POS Local Reliability Engine</span>
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
