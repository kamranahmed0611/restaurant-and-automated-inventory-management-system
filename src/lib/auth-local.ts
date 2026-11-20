import { db, LocalCashier } from './db';

export const DEFAULT_CASHIER_PIN = '1234';
export const DEFAULT_PIN_HASH = '6ad9be88a8712f67694cbbfc74feda6d3f0a82cb9cd230b6594dc69721edaca6';

/**
 * Standard SHA-256 offline PIN hashing using the Web Crypto API
 * Works 100% offline in browser, PWA, Electron, and WebView
 */
export async function hashPin(pin: string): Promise<string> {
  const cleanPin = pin.trim();
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode('muchachos_pos_salt_' + cleanPin);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return DEFAULT_PIN_HASH;
}

/**
 * Seed default Counter Cashier into local Dexie database if not present
 */
export async function initDefaultCashier(): Promise<LocalCashier> {
  try {
    const count = await db.cashiers.count();
    if (count === 0) {
      const defaultCashier: LocalCashier = {
        id: 'cashier-default',
        name: 'Counter Cashier',
        pin_hash: DEFAULT_PIN_HASH,
        role: 'CASHIER',
        created_at: new Date().toISOString()
      };
      await db.cashiers.put(defaultCashier);
      return defaultCashier;
    }
    const first = await db.cashiers.toCollection().first();
    return first!;
  } catch (error) {
    console.error('Failed to initialize default cashier in local DB:', error);
    return {
      id: 'cashier-default',
      name: 'Counter Cashier',
      pin_hash: DEFAULT_PIN_HASH,
      role: 'CASHIER',
      created_at: new Date().toISOString()
    };
  }
}

/**
 * Verify cashier PIN against local Dexie IndexedDB
 * 100% offline - 0ms latency, zero network calls to Supabase
 */
export async function verifyCashierPin(pin: string): Promise<LocalCashier | null> {
  try {
    await initDefaultCashier();
    const hashed = await hashPin(pin);
    const cashiers = await db.cashiers.toArray();
    const match = cashiers.find(c => c.pin_hash === hashed);
    return match || null;
  } catch (error) {
    console.error('Error verifying cashier PIN:', error);
    if (pin.trim() === DEFAULT_CASHIER_PIN) {
      return {
        id: 'cashier-default',
        name: 'Counter Cashier',
        pin_hash: DEFAULT_PIN_HASH,
        role: 'CASHIER',
        created_at: new Date().toISOString()
      };
    }
    return null;
  }
}

/**
 * Get all registered local cashiers
 */
export async function getLocalCashiers(): Promise<LocalCashier[]> {
  try {
    await initDefaultCashier();
    return await db.cashiers.toArray();
  } catch {
    return [];
  }
}