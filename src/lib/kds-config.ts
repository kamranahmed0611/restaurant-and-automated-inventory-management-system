"use client";

import { posBus } from "./broadcast-bus";

const KDS_STORAGE_KEY = "muchachos_kds_enabled";

/**
 * Returns whether the Kitchen Display Screen (/kds) is actively enabled.
 * Defaults to false (Inactive) since kitchen orders are handled via printed tokens
 * unless a dedicated kitchen tablet/monitor is toggled ON by the owner.
 */
export function getKdsDisplayEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const val = localStorage.getItem(KDS_STORAGE_KEY);
    return val === "true";
  } catch {
    return false;
  }
}

/**
 * Toggles the Kitchen Display Screen (/kds) ON or OFF.
 * Broadcasts change across all browser tabs in real-time.
 * NOTE: This only affects the visual display on /kds and does NOT alter
 * the order pipeline, kitchen token printing, or inventory tracking.
 */
export function setKdsDisplayEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(KDS_STORAGE_KEY, enabled ? "true" : "false");
    posBus.publish("KDS_TOGGLED", {
      kdsEnabled: enabled,
    });
  } catch (err) {
    console.error("Failed to persist KDS display setting:", err);
  }
}

export const syncKdsDisplayFromCloud = () => Promise.resolve(getKdsDisplayEnabled());
