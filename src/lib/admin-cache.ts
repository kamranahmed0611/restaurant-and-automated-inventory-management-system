/**
 * High-Performance Client Cache & SWR (Stale-While-Revalidate) Engine
 * Designed for Muchachos Admin (Desktop & Phone PWA).
 * 
 * Prevents redundant Supabase queries, eliminates blank loading flickers,
 * and enables instantaneous (0ms) tab switching and date navigation.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const memoryStore = new Map<string, CacheEntry<any>>();

// Standard TTLs
export const CACHE_TTL = {
  LIVE_TODAY: 5 * 60 * 1000,       // 5 minutes for current day / active shift (realtime updates automatically invalidate)
  HISTORIC_DATE: 120 * 60 * 1000,  // 2 hours for closed past dates (they never change)
  SETTINGS: 30 * 60 * 1000,       // 30 minutes for system settings
  STATIC_CATALOG: 15 * 60 * 1000   // 15 minutes for menu / inventory lists
};

export const adminCache = {
  /**
   * Retrieves cached data if present.
   * If maxAgeMs is provided, returns null if data is older than maxAgeMs.
   */
  get<T>(key: string, maxAgeMs?: number): T | null {
    // 1. Try In-Memory Map (0ms)
    let entry = memoryStore.get(key) as CacheEntry<T> | undefined;

    // 2. Fallback to SessionStorage if page reloaded
    if (!entry && typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem(`muc_cache_${key}`);
        if (stored) {
          entry = JSON.parse(stored);
          if (entry) {
            memoryStore.set(key, entry);
          }
        }
      } catch {
        // sessionStorage restricted or quota exceeded
      }
    }

    if (!entry) return null;

    if (maxAgeMs !== undefined) {
      const age = Date.now() - entry.timestamp;
      if (age > maxAgeMs) {
        return null;
      }
    }

    return entry.data;
  },

  /**
   * Checks if an entry exists and is within its freshness window.
   */
  isFresh(key: string, freshDurationMs: number): boolean {
    const entry = memoryStore.get(key);
    if (!entry) return false;
    return (Date.now() - entry.timestamp) <= freshDurationMs;
  },

  /**
   * Stores data in memory and sessionStorage.
   */
  set<T>(key: string, data: T): void {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now()
    };
    memoryStore.set(key, entry);

    if (typeof window !== 'undefined') {
      try {
        // Only cache smaller snapshots in sessionStorage to prevent quota overflow
        const serialized = JSON.stringify(entry);
        if (serialized.length < 500000) {
          sessionStorage.setItem(`muc_cache_${key}`, serialized);
        }
      } catch {
        // Silently skip sessionStorage on quota limits
      }
    }
  },

  /**
   * Delete a specific key from cache.
   */
  delete(key: string): void {
    memoryStore.delete(key);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(`muc_cache_${key}`);
      } catch {}
    }
  },

  /**
   * Invalidate specific keys or all keys matching a prefix (e.g. 'overview_', 'reports_')
   */
  invalidate(prefix?: string): void {
    if (!prefix) {
      memoryStore.clear();
      if (typeof window !== 'undefined') {
        try {
          const keysToRemove: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (k && k.startsWith('muc_cache_')) {
              keysToRemove.push(k);
            }
          }
          keysToRemove.forEach(k => sessionStorage.removeItem(k));
        } catch {}
      }
      return;
    }

    // Invalidate keys matching prefix using Array.from for compatibility
    const allKeys = Array.from(memoryStore.keys());
    for (let i = 0; i < allKeys.length; i++) {
      const key = allKeys[i];
      if (key.startsWith(prefix)) {
        memoryStore.delete(key);
      }
    }

    if (typeof window !== 'undefined') {
      try {
        const fullPrefix = `muc_cache_${prefix}`;
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith(fullPrefix)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));
      } catch {}
    }
  }
};
