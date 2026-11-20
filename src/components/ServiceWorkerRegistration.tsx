'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for PWA offline support.
 * Only registers in production or when explicitly enabled.
 * In development, skips registration to avoid caching issues with HMR.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // In development mode, unregister any service worker to prevent caching HMR code
    if (process.env.NODE_ENV !== 'production') {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (const registration of registrations) {
            registration.unregister();
            console.log('[PWA-Dev] Unregistered active Service Worker for clean development');
          }
        });
      }
      if ('caches' in window) {
        caches.keys().then((keys) => {
          for (const key of keys) {
            caches.delete(key);
          }
        });
      }
      return;
    }

    if (!('serviceWorker' in navigator)) {
      console.log('[PWA] Service workers not supported');
      return;
    }

    // Register service worker in production
    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', {
          scope: '/',
        });
        console.log('[PWA] Service Worker registered:', registration.scope);

        // Check for updates periodically (every 60 minutes)
        setInterval(() => {
          registration.update();
          console.log('[PWA] Checking for SW updates...');
        }, 60 * 60 * 1000);

        // Listen for new SW waiting
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (
                newWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                // New version available — auto-activate
                console.log('[PWA] New version available, activating...');
                newWorker.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
      } catch (error) {
        console.error('[PWA] Service Worker registration failed:', error);
      }
    };

    registerSW();

    // Reload when new SW takes control
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        console.log('[PWA] New Service Worker active, refreshing...');
        window.location.reload();
      }
    });
  }, []);

  return null; // This component renders nothing
}
