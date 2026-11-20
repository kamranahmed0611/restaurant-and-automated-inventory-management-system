/**
 * Device mode detector:
 * LAPTOP (Writer) vs CLOUD/PHONE (View-Only Mirror)
 * 
 * ARCHITECTURE MANDATE:
 * - The LAPTOP app (Electron + local Next standalone server + Dexie) is the ONLY source of truth and ONLY writer.
 * - All laptop screens read ONLY from local Dexie.
 * - The phone/cloud app (Vercel) is VIEW ONLY and reads from Supabase mirror.
 */

export function isLaptopWriter(): boolean {
  if (typeof window === 'undefined') return false;
  
  // 1. Electron environment
  if (Boolean((window as any).electronAPI)) return true;

  // 2. Local loopback standalone Next.js server (http://127.0.0.1:31415 or localhost:3000)
  const host = window.location.hostname;
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
    return true;
  }

  return false;
}
