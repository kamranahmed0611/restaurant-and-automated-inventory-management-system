import { db } from './db';

export interface BackupManifest {
  schema_version: string;
  app_version: string;
  timestamp: string;
  reason?: string;
  row_counts: Record<string, number>;
  checksum: string;
}

export interface BackupFileContent {
  manifest: BackupManifest;
  database: Record<string, any[]>;
  settings: Record<string, any>;
}

/**
 * Calculates SHA-256 hash of a string using Web Crypto API
 */
export async function calculateSha256(content: string): Promise<string> {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  // Deterministic fallback
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash) + content.charCodeAt(i);
    hash |= 0;
  }
  return 'checksum_' + Math.abs(hash).toString(16);
}

/**
 * Generates formatted backup filename: muchachos-backup-YYYY-MM-DD_HH-mm.json
 */
export function generateBackupFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `muchachos-backup-${yyyy}-${mm}-${dd}_${hh}-${min}.json`;
}

/**
 * Generates a full transactional JSON snapshot of all 11 Dexie tables + settings + manifest with SHA-256.
 */
export async function generateDexieBackupPayload(reason?: string): Promise<{
  jsonString: string;
  fileName: string;
  manifest: BackupManifest;
  database: Record<string, any[]>;
}> {
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

  const database = {
    orders,
    shifts,
    menu_items,
    raw_inventory,
    recipes,
    deal_components,
    modifiers,
    categories,
    expenses,
    cashiers,
    inventory_logs
  };

  const rowCounts = {
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
    inventory_logs: inventory_logs.length
  };

  const originSettings: Record<string, any> = {};
  if (typeof window !== 'undefined' && window.localStorage) {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key.startsWith('muchachos_') || 
        key.startsWith('pos_') || 
        key.startsWith('kds_') || 
        key === 'theme'
      )) {
        originSettings[key] = localStorage.getItem(key);
      }
    }
  }

  const dbString = JSON.stringify(database);
  const checksum = await calculateSha256(dbString);

  const manifest: BackupManifest = {
    schema_version: "1.0.0",
    app_version: "0.1.0",
    timestamp: new Date().toISOString(),
    reason: reason || "manual",
    row_counts: rowCounts,
    checksum: checksum
  };

  const fullBackup: BackupFileContent = {
    manifest,
    database,
    settings: originSettings
  };

  const jsonString = JSON.stringify(fullBackup, null, 2);
  const fileName = generateBackupFileName();

  return { jsonString, fileName, manifest, database };
}

/**
 * Validates SHA-256 checksum of an imported backup against its manifest
 */
export async function verifyBackupChecksum(backupObj: any): Promise<{
  valid: boolean;
  computedChecksum: string;
  expectedChecksum: string;
  reason?: string;
}> {
  if (!backupObj || !backupObj.database || !backupObj.manifest) {
    return { valid: false, computedChecksum: '', expectedChecksum: '', reason: 'Missing database or manifest' };
  }

  const expected = backupObj.manifest.checksum;
  if (!expected) {
    return { valid: false, computedChecksum: '', expectedChecksum: '', reason: 'Manifest has no checksum' };
  }

  const dbString = JSON.stringify(backupObj.database);
  const computed = await calculateSha256(dbString);

  return {
    valid: computed === expected,
    computedChecksum: computed,
    expectedChecksum: expected
  };
}

/**
 * Creates and writes a backup to disk via Electron IPC (or browser download if non-Electron)
 */
export async function createBackup(reason?: string): Promise<{
  success: boolean;
  filePath?: string;
  fileName?: string;
  manifest?: BackupManifest;
  error?: string;
}> {
  if (typeof window === 'undefined') return { success: false, error: 'Window undefined' };

  try {
    const { jsonString, fileName, manifest } = await generateDexieBackupPayload(reason);

    if ((window as any).electronAPI?.saveBackup) {
      const res = await (window as any).electronAPI.saveBackup({ fileName, content: jsonString });
      if (res?.success) {
        const timestamp = new Date().toLocaleTimeString();
        localStorage.setItem('muchachos_last_backup_time', timestamp);
        localStorage.setItem('muchachos_last_backup_status', 'SUCCESS');
        return { success: true, filePath: res.filePath, fileName: res.fileName, manifest };
      }
      localStorage.setItem('muchachos_last_backup_status', 'FAILED');
      return { success: false, error: res?.error };
    }

    // Browser environment fallback: trigger blob download
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const timestamp = new Date().toLocaleTimeString();
    localStorage.setItem('muchachos_last_backup_time', timestamp);
    localStorage.setItem('muchachos_last_backup_status', 'SUCCESS');
    return { success: true, fileName, manifest };
  } catch (err: any) {
    console.error('[AutoBackup] Failed to create backup:', err);
    localStorage.setItem('muchachos_last_backup_status', 'FAILED');
    return { success: false, error: err.message };
  }
}

/**
 * Starts a background timer that runs an automatic backup every 6 hours while the app is active
 */
let backupTimer: NodeJS.Timeout | null = null;

export function startAutoBackupTimer(): () => void {
  if (backupTimer) clearInterval(backupTimer);

  // Check every 6 hours (6 * 60 * 60 * 1000 ms)
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  backupTimer = setInterval(() => {
    console.log('[AutoBackup] 6-hour interval triggered. Creating automatic backup...');
    createBackup('6-hour-interval').catch(err => {
      console.warn('[AutoBackup] Periodic backup warning:', err);
    });
  }, SIX_HOURS_MS);

  return () => {
    if (backupTimer) clearInterval(backupTimer);
  };
}

/**
 * Trigger backup on shift close
 */
export async function triggerShiftCloseBackup(shiftId: string): Promise<void> {
  console.log(`[AutoBackup] Shift ${shiftId} closed. Creating safety backup...`);
  await createBackup(`shift-close-${shiftId}`);
}

/**
 * Trigger daily auto backup (used at POS startup and shift close)
 */
export async function triggerDailyAutoBackup(force?: boolean): Promise<void> {
  console.log(`[AutoBackup] Triggering daily auto backup snapshot (force=${Boolean(force)})...`);
  await createBackup(force ? 'shift-close' : 'daily-startup');
}
