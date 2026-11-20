/**
 * Multi-Window Management Helper for Muchachos POS
 * 
 * Ensures strictly ONE managed window per role:
 * - POS Register ('pos')
 * - Owner Admin Portal ('admin')
 * - Kitchen Display Screen ('kds')
 * 
 * When a view was already opened, switches / focuses to that window instead
 * of converting the current tab or opening endless duplicate windows.
 */

export function openAppRoute(route: 'pos' | 'admin' | 'kds') {
  if (typeof window === 'undefined') return;

  const electronAPI = (window as any).electronAPI;
  if (electronAPI && typeof electronAPI.openAppWindow === 'function') {
    electronAPI.openAppWindow(route);
    return;
  }

  // Web Browser Fallback: use unique named browser tabs so subsequent clicks reuse the existing tab
  const targetMap: Record<string, string> = {
    pos: 'MuchachosPOS_Register',
    admin: 'MuchachosPOS_Admin',
    kds: 'MuchachosPOS_KDS'
  };

  const path = route === 'pos' ? '/pos' : `/${route}`;
  const targetName = targetMap[route] || '_blank';
  window.open(path, targetName);
}
