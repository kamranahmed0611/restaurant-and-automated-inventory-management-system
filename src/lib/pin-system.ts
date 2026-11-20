import { db, LocalCashier } from './db';

export const DEFAULT_ADMIN_PIN = '7788';
export const DEFAULT_CASHIER_PIN = '1234';
export const SUPER_ADMIN_PIN = '888888';

const STORAGE_ADMIN_PIN_HASH = 'muchachos_admin_pin_hash';
const STORAGE_PIN_SALT = 'muchachos_pin_salt';
const STORAGE_ADMIN_UNLOCKED = 'muchachos_admin_session_unlocked';
const STORAGE_FAILURES = 'muchachos_pin_failures';
const STORAGE_LOCKED_UNTIL = 'muchachos_pin_locked_until';

const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 60 * 1000; // 60 seconds (1 minute)

/**
 * Generates or retrieves local device salt for PIN hashing
 */
function getOrCreateDeviceSalt(): string {
  if (typeof window === 'undefined') return 'muchachos_salt_default';
  let salt = localStorage.getItem(STORAGE_PIN_SALT);
  if (!salt) {
    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      salt = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } else {
      salt = 'salt_' + Math.random().toString(36).substring(2);
    }
    localStorage.setItem(STORAGE_PIN_SALT, salt);
  }
  return salt;
}

/**
 * Computes SHA-256 hash of a string with device salt
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = getOrCreateDeviceSalt();
  const input = `${salt}:${pin.trim()}`;

  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Deterministic fallback
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return 'sha256_' + Math.abs(hash).toString(16);
}

/**
 * Initializes default admin PIN hash if not present
 */
async function ensureAdminPinHash(): Promise<string> {
  if (typeof window === 'undefined') return '';
  let stored = localStorage.getItem(STORAGE_ADMIN_PIN_HASH);
  if (!stored) {
    stored = await hashPin(DEFAULT_ADMIN_PIN);
    localStorage.setItem(STORAGE_ADMIN_PIN_HASH, stored);
  }
  return stored;
}

/**
 * Sets a new 4-digit Master PIN
 */
export async function setAdminPin(newPin: string): Promise<void> {
  const hash = await hashPin(newPin);
  localStorage.setItem(STORAGE_ADMIN_PIN_HASH, hash);
}

/**
 * Verifies entered admin PIN
 */
export async function verifyAdminPin(enteredPin: string): Promise<boolean> {
  const clean = enteredPin.trim();
  // Super Admin & Default Admin PIN
  if (clean === SUPER_ADMIN_PIN || clean === DEFAULT_ADMIN_PIN) {
    return true;
  }

  const rawAdminPin = localStorage.getItem('muchachos_admin_pin_raw');
  if (rawAdminPin && clean === rawAdminPin) {
    return true;
  }

  const expectedHash = await ensureAdminPinHash();
  const enteredHash = await hashPin(clean);
  return enteredHash === expectedHash;
}

/**
 * Checks if current admin session is unlocked
 */
export function isAdminUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(STORAGE_ADMIN_UNLOCKED) === 'true';
}

/**
 * Sets admin session unlock state
 */
export function setAdminUnlocked(unlocked: boolean): void {
  if (typeof window === 'undefined') return;
  if (unlocked) {
    sessionStorage.setItem(STORAGE_ADMIN_UNLOCKED, 'true');
  } else {
    sessionStorage.removeItem(STORAGE_ADMIN_UNLOCKED);
  }
}

/**
 * Lockout Status Inspector (No lockout in simple restaurant mode)
 */
export function getLockoutStatus(): { isLocked: boolean; remainingSeconds: number } {
  return { isLocked: false, remainingSeconds: 0 };
}

/**
 * Records a failed PIN attempt (No lockout)
 */
export function recordFailedAttempt(): { isLocked: boolean; remainingSeconds: number; attemptsRemaining: number } {
  return {
    isLocked: false,
    remainingSeconds: 0,
    attemptsRemaining: 99
  };
}

/**
 * Resets brute-force lockout counters
 */
export function resetLockout(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_FAILURES);
  localStorage.removeItem(STORAGE_LOCKED_UNTIL);
}

/**
 * Verifies a cashier PIN against Dexie database
 */
export async function verifyCashierPin(enteredPin: string): Promise<LocalCashier | null> {
  const clean = enteredPin.trim();

  // Super Admin Emergency Override for Cashier Lock
  if (clean === SUPER_ADMIN_PIN) {
    return {
      id: 'super-admin',
      name: 'Super Admin',
      pin_hash: 'super_admin',
      role: 'ADMIN'
    };
  }

  const cashiers = await db.cashiers.toArray();

  if (cashiers.length === 0) {
    // Default fallback cashier
    if (clean === DEFAULT_CASHIER_PIN) {
      return {
        id: 'default-cashier',
        name: 'Head Cashier',
        pin_hash: '1234',
        role: 'CASHIER'
      };
    }
    return null;
  }

  const inputHash = await hashPin(clean);

  for (const cashier of cashiers) {
    // Direct unhashed match OR hashed match
    if (
      cashier.pin_hash === clean || 
      (cashier as any).pin === clean || 
      cashier.pin_hash === inputHash
    ) {
      return cashier;
    }
  }

  return null;
}

/**
 * Emergency Super Admin Override to reset Admin and Cashier PINs
 */
export async function superAdminEmergencyReset(
  superAdminKey: string,
  newAdminPin?: string,
  newCashierPin?: string
): Promise<{ success: boolean; message: string }> {
  if (superAdminKey.trim() !== SUPER_ADMIN_PIN) {
    return { success: false, message: 'Invalid Super Admin Key.' };
  }

  // Clear all lockouts
  resetLockout();
  setAdminUnlocked(true);

  if (newAdminPin && newAdminPin.length === 4) {
    await setAdminPin(newAdminPin);
  }

  if (newCashierPin && newCashierPin.length === 4) {
    const cashiers = await db.cashiers.toArray();
    const cashierHash = await hashPin(newCashierPin);
    if (cashiers.length > 0) {
      for (const c of cashiers) {
        await db.cashiers.update(c.id, {
          pin_hash: cashierHash,
          sync_status: 'PENDING'
        } as any);
      }
    } else {
      await db.cashiers.put({
        id: 'default-cashier',
        name: 'Head Cashier',
        pin_hash: cashierHash,
        role: 'CASHIER',
        sync_status: 'PENDING'
      } as any);
    }
  }

  return { success: true, message: 'PINs and lockouts successfully reset.' };
}
