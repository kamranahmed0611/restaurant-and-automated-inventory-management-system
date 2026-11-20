/**
 * MUCHACHOS POS: OWNER MASTER PIN SECURITY ENGINE
 * Features:
 * - PBKDF2 with SHA-256, 100,000 iterations via Web Crypto API
 * - Per-device 16-byte cryptographically random salt (no fixed salt)
 * - Zero hardcoded default PINs (forces first-run provisioning)
 * - Tamper-resistant brute-force lockout managed by Electron main process via IPC
 *   (immune to renderer localStorage clearing) with fallback for browser mode
 */

const STORAGE_PBKDF2_RECORD = 'muchachos_master_pin_pbkdf2';
const SESSION_UNLOCKED = 'muchachos_admin_session_unlocked';

// Browser fallback storage keys (used only when not running inside Electron)
const STORAGE_FALLBACK_FAILURES = 'muchachos_pin_failures_fb';
const STORAGE_FALLBACK_LOCKOUT = 'muchachos_pin_lockout_fb';

export interface MasterPinRecord {
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  saltHex: string;
  hashHex: string;
  created_at: string;
}

/**
 * Converts Uint8Array to hex string
 */
function toHex(buffer: Uint8Array): string {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Converts hex string to Uint8Array
 */
function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const DEFAULT_ITERATIONS = 600_000;

/**
 * Derives a PBKDF2 hash using Web Crypto API (OWASP recommended 600,000 rounds)
 */
async function derivePbkdf2Hash(pin: string, salt: Uint8Array, iterations = DEFAULT_ITERATIONS): Promise<string> {
  const encoder = new TextEncoder();
  const passwordBuffer = encoder.encode(pin.trim());

  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await window.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: iterations,
      hash: 'SHA-256'
    },
    baseKey,
    256 // 32 bytes (256 bits)
  );

  return toHex(new Uint8Array(derivedBits));
}

/**
 * Retrieves the stored Master PIN record from Electron DPAPI storage or localStorage
 */
export async function getStoredMasterPinRecord(): Promise<MasterPinRecord | null> {
  if (typeof window === 'undefined') return null;

  // Try Electron main process DPAPI storage first
  if ((window as any).electronAPI?.getMasterPinRecord) {
    try {
      const record = await (window as any).electronAPI.getMasterPinRecord();
      if (record && record.hashHex && record.saltHex) {
        return record;
      }
    } catch {}
  }

  // Fallback to localStorage
  const raw = localStorage.getItem(STORAGE_PBKDF2_RECORD);
  if (!raw) return null;
  try {
    const record: MasterPinRecord = JSON.parse(raw);
    if (record && record.hashHex && record.saltHex) {
      return record;
    }
  } catch {}
  return null;
}

/**
 * Checks if a Master PIN has been configured on this terminal (Async with Electron DPAPI)
 */
export async function isMasterPinConfiguredAsync(): Promise<boolean> {
  const record = await getStoredMasterPinRecord();
  return Boolean(record && record.hashHex && record.saltHex);
}

/**
 * Checks if a Master PIN has been configured on this terminal (Synchronous fallback)
 */
export function isMasterPinConfigured(): boolean {
  if (typeof window === 'undefined') return false;
  const raw = localStorage.getItem(STORAGE_PBKDF2_RECORD);
  if (!raw) return false;
  try {
    const record: MasterPinRecord = JSON.parse(raw);
    return Boolean(record.hashHex && record.saltHex);
  } catch {
    return false;
  }
}

/**
 * Gets remaining lockout time in seconds
 */
export async function getLockoutRemainingSeconds(): Promise<number> {
  if (typeof window === 'undefined') return 0;

  // Use Electron main process storage if available
  if ((window as any).electronAPI?.lockoutGetStatus) {
    try {
      const status = await (window as any).electronAPI.lockoutGetStatus();
      return status.remainingSeconds || 0;
    } catch {}
  }

  // Fallback to browser storage
  const lockoutUntilStr = localStorage.getItem(STORAGE_FALLBACK_LOCKOUT);
  if (!lockoutUntilStr) return 0;
  const lockoutUntil = parseInt(lockoutUntilStr, 10);
  const now = Date.now();
  if (now >= lockoutUntil) {
    localStorage.removeItem(STORAGE_FALLBACK_LOCKOUT);
    localStorage.removeItem(STORAGE_FALLBACK_FAILURES);
    return 0;
  }
  return Math.ceil((lockoutUntil - now) / 1000);
}

/**
 * Records a failed attempt and returns updated lockout status
 */
async function recordFailure(): Promise<{ lockedOut: boolean; remainingSeconds: number; attemptsRemaining: number }> {
  // Use Electron main process if available
  if ((window as any).electronAPI?.lockoutRecordFailure) {
    try {
      const res = await (window as any).electronAPI.lockoutRecordFailure();
      return {
        lockedOut: Boolean(res.lockedOut),
        remainingSeconds: res.remainingSeconds || 0,
        attemptsRemaining: res.attemptsRemaining || 0
      };
    } catch {}
  }

  // Browser fallback
  const count = parseInt(localStorage.getItem(STORAGE_FALLBACK_FAILURES) || '0', 10) + 1;
  localStorage.setItem(STORAGE_FALLBACK_FAILURES, String(count));
  if (count >= 5) {
    const lockoutUntil = Date.now() + (5 * 60 * 1000);
    localStorage.setItem(STORAGE_FALLBACK_LOCKOUT, String(lockoutUntil));
    return { lockedOut: true, remainingSeconds: 300, attemptsRemaining: 0 };
  }
  return { lockedOut: false, remainingSeconds: 0, attemptsRemaining: 5 - count };
}

/**
 * Resets the lockout failure counter
 */
async function resetFailures(): Promise<void> {
  if ((window as any).electronAPI?.lockoutReset) {
    try {
      await (window as any).electronAPI.lockoutReset();
    } catch {}
  }
  localStorage.removeItem(STORAGE_FALLBACK_FAILURES);
  localStorage.removeItem(STORAGE_FALLBACK_LOCKOUT);
}

/**
 * Creates/Sets a new Master PIN with random per-device salt and PBKDF2
 */
export async function setupMasterPin(newPin: string): Promise<{ success: boolean; error?: string }> {
  const clean = newPin.trim();
  if (clean.length < 4 || clean.length > 8) {
    return { success: false, error: 'Master PIN must be between 4 and 8 digits.' };
  }
  if (!/^\d+$/.test(clean)) {
    return { success: false, error: 'Master PIN must contain numbers only.' };
  }

  try {
    // Generate 16-byte random salt
    const randomSalt = window.crypto.getRandomValues(new Uint8Array(16));
    const saltHex = toHex(randomSalt);
    const hashHex = await derivePbkdf2Hash(clean, randomSalt, DEFAULT_ITERATIONS);

    const record: MasterPinRecord = {
      algorithm: 'PBKDF2-SHA256',
      iterations: DEFAULT_ITERATIONS,
      saltHex,
      hashHex,
      created_at: new Date().toISOString()
    };

    // Save to Electron DPAPI storage if running inside desktop app
    if ((window as any).electronAPI?.saveMasterPinRecord) {
      try {
        await (window as any).electronAPI.saveMasterPinRecord(record);
      } catch (e) {
        console.warn('[MasterPIN] Failed to persist to Electron DPAPI:', e);
      }
    }

    // Mirror to localStorage for fast access / web fallback
    localStorage.setItem(STORAGE_PBKDF2_RECORD, JSON.stringify(record));
    await resetFailures();
    setAdminSessionUnlocked(true);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: 'Cryptographic key derivation error: ' + err.message };
  }
}

/**
 * Verifies entered PIN against stored PBKDF2 hash
 */
export async function verifyMasterPin(enteredPin: string): Promise<{
  success: boolean;
  error?: string;
  remainingLockoutSeconds?: number;
  attemptsRemaining?: number;
}> {
  const remaining = await getLockoutRemainingSeconds();
  if (remaining > 0) {
    return {
      success: false,
      error: `Too many failed attempts. Terminal locked out for ${remaining} seconds.`,
      remainingLockoutSeconds: remaining,
      attemptsRemaining: 0
    };
  }

  const record = await getStoredMasterPinRecord();
  if (!record) {
    return {
      success: false,
      error: 'No Master PIN has been configured. Please complete first-run setup.'
    };
  }

  try {
    const salt = fromHex(record.saltHex);
    const computedHash = await derivePbkdf2Hash(enteredPin, salt, record.iterations || DEFAULT_ITERATIONS);

    if (computedHash === record.hashHex) {
      await resetFailures();
      setAdminSessionUnlocked(true);
      return { success: true };
    } else {
      const outcome = await recordFailure();
      if (outcome.lockedOut) {
        return {
          success: false,
          error: `Maximum attempts exceeded. Terminal locked out for ${outcome.remainingSeconds}s.`,
          remainingLockoutSeconds: outcome.remainingSeconds,
          attemptsRemaining: 0
        };
      }
      return {
        success: false,
        error: `Incorrect Master PIN. ${outcome.attemptsRemaining} attempt(s) remaining.`,
        attemptsRemaining: outcome.attemptsRemaining
      };
    }
  } catch (err: any) {
    return { success: false, error: 'Verification error: ' + err.message };
  }
}

/**
 * Changes an existing Master PIN
 */
export async function changeMasterPin(currentPin: string, newPin: string): Promise<{ success: boolean; error?: string }> {
  const verifyRes = await verifyMasterPin(currentPin);
  if (!verifyRes.success) {
    return { success: false, error: verifyRes.error || 'Current Master PIN is incorrect.' };
  }
  return await setupMasterPin(newPin);
}

/**
 * Session unlock state
 */
export function isAdminSessionUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(SESSION_UNLOCKED) === 'true';
}

export function setAdminSessionUnlocked(unlocked: boolean): void {
  if (typeof window === 'undefined') return;
  if (unlocked) {
    sessionStorage.setItem(SESSION_UNLOCKED, 'true');
  } else {
    sessionStorage.removeItem(SESSION_UNLOCKED);
  }
}
