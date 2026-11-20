const { app, BrowserWindow, ipcMain, session, utilityProcess, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const LOCAL_PORT = 31415;
const LOCAL_HOST = '127.0.0.1';
const EXPECTED_BUILD_TOKEN = 'MUCHACHOS_POS_LOCAL_SERVER_V1';

let mainWindow = null;
let serverProcess = null;
let activeServerUrl = `http://${LOCAL_HOST}:${LOCAL_PORT}`;

// Single-window instance manager for distinct roles: POS, Admin, and KDS
const appWindows = {
  pos: null,
  admin: null,
  kds: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE INSTANCE LOCK
// ─────────────────────────────────────────────────────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STANDALONE LOCAL SERVER HEALTH & PROCESS LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────────

function checkServerHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://${LOCAL_HOST}:${LOCAL_PORT}/api/health`, { timeout: 1200 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && json.buildToken === EXPECTED_BUILD_TOKEN) {
            resolve({ status: 'MATCH', json });
          } else {
            resolve({ status: 'FOREIGN', json });
          }
        } catch {
          resolve({ status: 'FOREIGN', raw: data });
        }
      });
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        resolve({ status: 'FREE' });
      } else {
        resolve({ status: 'ERROR', error: err.message });
      }
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ status: 'TIMEOUT' });
    });
  });
}

function getStandaloneServerPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app-server', 'server.js');
  }
  return path.join(__dirname, '..', '.next', 'standalone', 'server.js');
}

async function ensureLocalServerRunning() {
  // 1. Check if port 31415 is already listening
  const initialHealth = await checkServerHealth();
  if (initialHealth.status === 'MATCH') {
    console.log(`[Electron] Connected to existing Muchachos POS server on ${LOCAL_HOST}:${LOCAL_PORT}`);
    return { success: true, url: `http://${LOCAL_HOST}:${LOCAL_PORT}` };
  }

  if (initialHealth.status === 'FOREIGN' || initialHealth.status === 'TIMEOUT') {
    // Port taken by an unrecognized service! Do NOT switch ports!
    dialog.showErrorBox(
      'Port 31415 Conflict',
      `Port ${LOCAL_PORT} is occupied by another application or unrecognized server.\n\n` +
      `Because Muchachos POS local database (Dexie/IndexedDB) is strictly bound to http://${LOCAL_HOST}:${LOCAL_PORT}, ` +
      'the application cannot switch to another port without losing access to local records.\n\n' +
      `Please close the application occupying port ${LOCAL_PORT} and restart Muchachos POS.`
    );
    app.quit();
    return { success: false };
  }

  // 2. Port is FREE: verify server bundle exists
  const serverPath = getStandaloneServerPath();
  if (!fs.existsSync(serverPath)) {
    if (!app.isPackaged) {
      console.log('[Electron] Standalone server not found at', serverPath, '- falling back to dev server http://localhost:3000');
      return { success: true, url: 'http://localhost:3000' };
    }
    dialog.showErrorBox(
      'Server Bundle Missing',
      `Could not locate embedded server bundle at:\n${serverPath}\n\nPlease reinstall Muchachos POS.`
    );
    app.quit();
    return { success: false };
  }

  // 3. Spawn standalone server with utilityProcess.fork() (Electron's embedded Node runtime)
  console.log('[Electron] Spawning embedded standalone server from:', serverPath);
  try {
    serverProcess = utilityProcess.fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(LOCAL_PORT),
        HOSTNAME: '127.0.0.1',
        LOCAL_SERVER: '1',
        NODE_ENV: 'production',
      },
      stdio: 'pipe'
    });

    if (serverProcess.stdout) {
      serverProcess.stdout.on('data', (d) => console.log(`[StandaloneServer] ${d.toString().trim()}`));
    }
    if (serverProcess.stderr) {
      serverProcess.stderr.on('data', (d) => console.error(`[StandaloneServer ERR] ${d.toString().trim()}`));
    }
    serverProcess.on('exit', (code) => {
      console.log(`[StandaloneServer] Process exited with code ${code}`);
    });
  } catch (spawnErr) {
    dialog.showErrorBox(
      'Failed to Spawn POS Server',
      `Error starting embedded server process:\n${spawnErr.message}`
    );
    app.quit();
    return { success: false };
  }

  // 4. Poll health endpoint until server responds with EXPECTED_BUILD_TOKEN (up to 15s)
  const maxAttempts = 35;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 400));
    const health = await checkServerHealth();
    if (health.status === 'MATCH') {
      console.log(`[Electron] Standalone POS server is healthy and ready on ${LOCAL_HOST}:${LOCAL_PORT}`);
      return { success: true, url: `http://${LOCAL_HOST}:${LOCAL_PORT}` };
    }
  }

  dialog.showErrorBox(
    'Server Startup Timeout',
    'The standalone POS server failed to start within 14 seconds.\nPlease restart your computer or inspect background processes.'
  );
  app.quit();
  return { success: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER WINDOW INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

function setupWindowOpenHandlers(win) {
  win.webContents.setWindowOpenHandler((details) => {
    const url = details.url || '';
    if (url.includes('/kds')) {
      openOrFocusAppWindow('kds');
      return { action: 'deny' };
    }
    if (url.includes('/admin')) {
      openOrFocusAppWindow('admin');
      return { action: 'deny' };
    }
    if (url.includes('/pos')) {
      openOrFocusAppWindow('pos');
      return { action: 'deny' };
    }
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const { shell } = require('electron');
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });
}

function openOrFocusAppWindow(route) {
  const raw = (route || 'pos').replace(/^\//, '').toLowerCase();
  const targetKey = raw.includes('admin') ? 'admin' : (raw.includes('kds') ? 'kds' : 'pos');
  const targetPath = targetKey === 'pos' ? '' : targetKey;
  const targetUrl = `${activeServerUrl}/${targetPath}`;

  const existingWin = appWindows[targetKey];
  if (existingWin && !existingWin.isDestroyed()) {
    if (existingWin.isMinimized()) existingWin.restore();
    existingWin.show();
    existingWin.focus();
    return { success: true, action: 'focused' };
  }

  const isKds = targetKey === 'kds';
  const isAdmin = targetKey === 'admin';
  const title = isKds 
    ? 'Muchachos POS - Kitchen Display (KDS)' 
    : isAdmin 
      ? 'Muchachos POS - Owner Admin Portal' 
      : 'Muchachos POS - Cashier Register';

  const newWin = new BrowserWindow({
    width: isKds ? 1366 : 1280,
    height: isKds ? 768 : 800,
    minWidth: 960,
    minHeight: 540,
    title,
    backgroundColor: '#0F172A',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../public/icons/icon-512x512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      devTools: !app.isPackaged,
    },
  });

  const baseUserAgent = newWin.webContents.getUserAgent() || '';
  if (!baseUserAgent.includes('MuchachosPOS-Desktop')) {
    newWin.webContents.setUserAgent(`${baseUserAgent} MuchachosPOS-Desktop`);
  }

  if (app.isPackaged) {
    newWin.webContents.on('devtools-opened', () => newWin.webContents.closeDevTools());
    newWin.webContents.on('before-input-event', (event, input) => {
      if (
        input.key === 'F12' || 
        ((input.control || input.meta) && input.shift && (input.key.toLowerCase() === 'i' || input.key.toLowerCase() === 'j'))
      ) {
        event.preventDefault();
      }
    });
  }

  setupWindowOpenHandlers(newWin);

  newWin.on('closed', () => {
    appWindows[targetKey] = null;
    if (targetKey === 'pos' && mainWindow === newWin) {
      mainWindow = null;
    }
  });

  appWindows[targetKey] = newWin;
  if (targetKey === 'pos') {
    mainWindow = newWin;
  }

  newWin.loadURL(targetUrl);
  return { success: true, action: 'created' };
}

function createWindow(startUrl) {
  activeServerUrl = startUrl;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 540,
    title: 'Muchachos POS',
    backgroundColor: '#0F172A',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      devTools: !app.isPackaged,
    },
    icon: path.join(__dirname, '../public/icons/icon-512x512.png'),
  });

  appWindows.pos = mainWindow;

  // Stamp desktop identifier
  const baseUserAgent = mainWindow.webContents.getUserAgent() || '';
  if (!baseUserAgent.includes('MuchachosPOS-Desktop')) {
    mainWindow.webContents.setUserAgent(`${baseUserAgent} MuchachosPOS-Desktop`);
  }

  // Disable DevTools in production builds
  if (app.isPackaged) {
    mainWindow.webContents.on('devtools-opened', () => {
      mainWindow.webContents.closeDevTools();
    });
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (
        input.key === 'F12' || 
        ((input.control || input.meta) && input.shift && (input.key.toLowerCase() === 'i' || input.key.toLowerCase() === 'j'))
      ) {
        event.preventDefault();
      }
    });
  }

  setupWindowOpenHandlers(mainWindow);

  mainWindow.loadURL(startUrl);

  let failCount = 0;

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    failCount++;
    console.log(`[Electron] Page failed to load: ${errorDescription} (${validatedURL}). Attempt ${failCount}`);

    if (failCount < 5) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(activeServerUrl);
        }
      }, 2000);
    } else {
      const fallbackHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <title>Muchachos POS - Connection Setup</title>
            <style>
              body { background: #0F172A; color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
              .card { background: #1E293B; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 480px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); text-align: center; }
              h1 { color: #E11D2A; font-size: 24px; margin-bottom: 8px; font-weight: 900; letter-spacing: 0.5px; }
              p { color: #94A3B8; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
              input { width: 100%; padding: 12px 14px; border-radius: 8px; border: 1px solid #475569; background: #0F172A; color: #fff; font-size: 14px; box-sizing: border-box; margin-bottom: 16px; outline: none; }
              input:focus { border-color: #E11D2A; }
              button { width: 100%; padding: 12px; border-radius: 8px; border: none; font-weight: 700; cursor: pointer; font-size: 14px; transition: background 0.2s; }
              .btn-primary { background: #E11D2A; color: #fff; margin-bottom: 10px; }
              .btn-primary:hover { background: #b91522; }
              .btn-secondary { background: #334155; color: #F8FAFC; }
              .btn-secondary:hover { background: #475569; }
            </style>
          </head>
          <body>
            <div class="card">
              <h1>Muchachos POS</h1>
              <p>Unable to connect to the POS server.<br/>Please verify the local server or input the cloud deployment URL.</p>
              <form id="urlForm">
                <input type="text" id="urlInput" value="${activeServerUrl}" />
                <button type="submit" class="btn-primary">Connect & Save</button>
                <button type="button" class="btn-secondary" onclick="window.location.reload()">Retry Connection</button>
              </form>
            </div>
            <script>
              document.getElementById('urlForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const url = document.getElementById('urlInput').value.trim();
                if (url) {
                  if (window.electronAPI && window.electronAPI.setServerUrl) {
                    await window.electronAPI.setServerUrl(url);
                  }
                  window.location.href = url;
                }
              });
            </script>
          </body>
        </html>
      `;
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fallbackHtml));
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    failCount = 0;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// APP READY & QUIT HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    const defaultUa = session.defaultSession.getUserAgent() || '';
    if (!defaultUa.includes('MuchachosPOS-Desktop')) {
      const customUa = `${defaultUa} MuchachosPOS-Desktop`;
      session.defaultSession.setUserAgent(customUa);
      app.userAgentFallback = customUa;
    }
  } catch (e) {
    console.warn('[Electron] Failed to set default user agent:', e);
  }

  const serverResult = await ensureLocalServerRunning();
  if (!serverResult.success) return;

  createWindow(serverResult.url);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverResult.url);
  });
});

app.on('before-quit', () => {
  if (serverProcess) {
    console.log('[Electron] Shutting down embedded standalone server process...');
    try {
      serverProcess.kill();
    } catch (e) {
      console.warn('[Electron] Error killing serverProcess:', e);
    }
    serverProcess = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// IPC HANDLERS: Silent Printing & Cash Drawer
// ─────────────────────────────────────────────────────────────────────────────

// 1. Get list of all installed system printers
ipcMain.handle('get-printers', async () => {
  if (!mainWindow) return [];
  try {
    return await mainWindow.webContents.getPrintersAsync();
  } catch (err) {
    console.error('[Electron] Error fetching printers:', err);
    return [];
  }
});

// 2. Silent printing of thermal receipt / KOT HTML without browser print dialog
ipcMain.handle('print-silent', async (event, { html, deviceName }) => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const printers = await mainWindow.webContents.getPrintersAsync();
        const target = deviceName ? printers.find(p => p.name === deviceName) : printers.find(p => p.isDefault);
        if (target && /pdf|onenote|xps|fax/i.test(target.name)) {
          console.log('[Electron] Skipped silent print: virtual printer detected (' + target.name + ')');
          return { success: false, failureReason: 'Virtual PDF printer detected. Silent printing skipped.' };
        }
      } catch (checkErr) {
        console.warn('[Electron] Could not check printers:', checkErr);
      }
    }

    const printWindow = new BrowserWindow({
      show: false,
      width: 320,
      height: 600,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    return new Promise((resolve) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          deviceName: deviceName || '',
          margins: { marginType: 'none' },
        },
        (success, failureReason) => {
          printWindow.close();
          if (!success) {
            console.warn('[Electron] Print failed:', failureReason);
          }
          resolve({ success, failureReason });
        }
      );
    });
  } catch (error) {
    console.error('[Electron] Silent print error:', error);
    return { success: false, failureReason: error.message };
  }
});

// 3. Cash Drawer Kick Pulse (RJ11 DK port on ESC/POS printers)
ipcMain.handle('kick-cash-drawer', async (event, { deviceName } = {}) => {
  try {
    console.log('[Electron] Triggering cash drawer kick pulse...');
    const drawerKickHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            @page { size: auto; margin: 0; }
            body { margin: 0; padding: 0; font-size: 0; }
          </style>
        </head>
        <body>
          <span style="display:none">&#x1B;&#x70;&#x00;&#x19;&#xFA;</span>
        </body>
      </html>
    `;

    const kickWindow = new BrowserWindow({
      show: false,
      width: 100,
      height: 100,
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });

    await kickWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(drawerKickHtml)}`);

    return new Promise((resolve) => {
      kickWindow.webContents.print(
        {
          silent: true,
          deviceName: deviceName || '',
          margins: { marginType: 'none' },
        },
        (success, failureReason) => {
          kickWindow.close();
          resolve({ success, failureReason });
        }
      );
    });
  } catch (err) {
    console.error('[Electron] Cash drawer kick failed:', err);
    return { success: false, failureReason: err.message };
  }
});

// Window controls (works across all app windows)
ipcMain.on('window-minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win && !win.isDestroyed()) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (win && !win.isDestroyed()) win.close();
});

// Window Navigation (Single managed instance for POS, Admin, KDS)
ipcMain.handle('open-app-window', (event, route) => {
  return openOrFocusAppWindow(route);
});

// Server configuration IPC
ipcMain.handle('get-server-url', () => {
  return activeServerUrl;
});

ipcMain.handle('set-server-url', async (event, newUrl) => {
  try {
    const configPath = path.join(app.getPath('userData'), 'pos-server-config.json');
    fs.writeFileSync(configPath, JSON.stringify({ serverUrl: newUrl.trim() }, null, 2));
    activeServerUrl = newUrl.trim();
    console.log('[Electron] Server URL updated to:', activeServerUrl);
    return { success: true };
  } catch (err) {
    console.error('[Electron] Error writing pos-server-config.json:', err);
    return { success: false, error: err.message };
  }
});

// Terminal Identity Provisioning via Windows DPAPI (safeStorage)
ipcMain.handle('save-terminal-credentials', async (event, { email, password }) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'Hardware encryption (safeStorage/DPAPI) not available on this system.' };
    }
    const credPath = path.join(app.getPath('userData'), 'terminal-identity.enc');
    const jsonStr = JSON.stringify({ email: email.trim(), password: password.trim() });
    const encrypted = safeStorage.encryptString(jsonStr);
    fs.writeFileSync(credPath, encrypted);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-terminal-credentials', async () => {
  try {
    const credPath = path.join(app.getPath('userData'), 'terminal-identity.enc');
    if (!fs.existsSync(credPath)) return null;
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = fs.readFileSync(credPath);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted);
  } catch (err) {
    console.warn('[Electron] Could not decrypt terminal credentials:', err);
    return null;
  }
});

// Protected Lockout Counter (Main process storage - immune to renderer clearing)
const lockoutFilePath = path.join(app.getPath('userData'), 'terminal-lockout.json');

function getLockoutState() {
  try {
    if (fs.existsSync(lockoutFilePath)) {
      return JSON.parse(fs.readFileSync(lockoutFilePath, 'utf8'));
    }
  } catch {}
  return { failures: 0, lockoutUntil: 0 };
}

function saveLockoutState(state) {
  try {
    fs.writeFileSync(lockoutFilePath, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('[Electron] Could not write terminal-lockout.json:', err);
  }
}

ipcMain.handle('lockout-get-status', () => {
  const state = getLockoutState();
  const now = Date.now();
  if (state.lockoutUntil && now < state.lockoutUntil) {
    return {
      isLockedOut: true,
      remainingSeconds: Math.ceil((state.lockoutUntil - now) / 1000),
      failures: state.failures,
    };
  }
  return { isLockedOut: false, remainingSeconds: 0, failures: state.failures || 0 };
});

ipcMain.handle('lockout-record-failure', () => {
  const state = getLockoutState();
  const now = Date.now();
  if (state.lockoutUntil && now >= state.lockoutUntil) {
    state.failures = 0;
    state.lockoutUntil = 0;
  }
  state.failures = (state.failures || 0) + 1;
  const maxAttempts = 5;
  if (state.failures >= maxAttempts) {
    state.lockoutUntil = now + (5 * 60 * 1000); // 5 minutes
    saveLockoutState(state);
    return {
      lockedOut: true,
      remainingSeconds: 300,
      attemptsRemaining: 0,
    };
  }
  saveLockoutState(state);
  return {
    lockedOut: false,
    remainingSeconds: 0,
    attemptsRemaining: maxAttempts - state.failures,
  };
});

ipcMain.handle('lockout-reset', () => {
  saveLockoutState({ failures: 0, lockoutUntil: 0 });
  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// MASTER PIN DPAPI ENCRYPTION (safeStorage)
// ─────────────────────────────────────────────────────────────────────────────

ipcMain.handle('save-master-pin-record', async (event, record) => {
  try {
    const jsonStr = JSON.stringify(record);
    if (safeStorage.isEncryptionAvailable()) {
      const pinPath = path.join(app.getPath('userData'), 'master-pin.enc');
      fs.writeFileSync(pinPath, safeStorage.encryptString(jsonStr));
    } else {
      const pinPath = path.join(app.getPath('userData'), 'master-pin.json');
      fs.writeFileSync(pinPath, jsonStr, { mode: 0o600 });
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('get-master-pin-record', async () => {
  try {
    const encPath = path.join(app.getPath('userData'), 'master-pin.enc');
    if (fs.existsSync(encPath) && safeStorage.isEncryptionAvailable()) {
      const encrypted = fs.readFileSync(encPath);
      return JSON.parse(safeStorage.decryptString(encrypted));
    }
    const plainPath = path.join(app.getPath('userData'), 'master-pin.json');
    if (fs.existsSync(plainPath)) {
      return JSON.parse(fs.readFileSync(plainPath, 'utf8'));
    }
    return null;
  } catch (err) {
    console.warn('[Electron] Could not retrieve master PIN record:', err);
    return null;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURABLE BACKUP SYSTEM (30 Retention, Custom Folder, Native Picker)
// ─────────────────────────────────────────────────────────────────────────────

function getBackupConfigPath() {
  return path.join(app.getPath('userData'), 'backup-config.json');
}

function resolveBackupDirectory() {
  try {
    const configPath = getBackupConfigPath();
    if (fs.existsSync(configPath)) {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (parsed.backupDirectory && fs.existsSync(parsed.backupDirectory)) {
        return parsed.backupDirectory;
      }
    }
  } catch {}

  // Default: %USERPROFILE%/Documents/MuchachosPOS_Backups/
  const defaultDir = path.join(app.getPath('documents'), 'MuchachosPOS_Backups');
  if (!fs.existsSync(defaultDir)) {
    try {
      fs.mkdirSync(defaultDir, { recursive: true });
    } catch {}
  }
  return defaultDir;
}

ipcMain.handle('get-backup-directory', () => {
  return resolveBackupDirectory();
});

ipcMain.handle('select-backup-directory', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Muchachos POS Backup Folder',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const selected = result.filePaths[0];
      fs.writeFileSync(getBackupConfigPath(), JSON.stringify({ backupDirectory: selected }, null, 2));
      return { success: true, directory: selected };
    }
    return { success: false, canceled: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('save-backup', async (event, { fileName, content }) => {
  try {
    const backupDir = resolveBackupDirectory();
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    let finalName = fileName;
    if (!finalName) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const datePart = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timePart = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
      finalName = `muchachos-backup-${datePart}_${timePart}.json`;
    }

    const filePath = path.join(backupDir, finalName);
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`[Electron Backup] Saved backup to: ${filePath}`);

    // Retention: keep last 30 backups, delete older ones
    try {
      const existing = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('muchachos-backup-') && f.endsWith('.json'))
        .sort(); // ascending by timestamp in filename

      while (existing.length > 30) {
        const oldest = existing.shift();
        try {
          fs.unlinkSync(path.join(backupDir, oldest));
          console.log(`[Electron Backup] Pruned old backup beyond 30-day retention: ${oldest}`);
        } catch {}
      }
    } catch (pruneErr) {
      console.warn('[Electron Backup] Prune warning:', pruneErr);
    }

    // Auto-mirror to attached USB drive if designated folder exists
    let usbPath = null;
    if (process.platform === 'win32') {
      const candidateDrives = ['D:', 'E:', 'F:', 'G:', 'H:', 'I:'];
      for (const drive of candidateDrives) {
        try {
          const designatedUsbDir = path.join(`${drive}\\`, 'MuchachosPOS_Backups');
          if (fs.existsSync(designatedUsbDir)) {
            const dest = path.join(designatedUsbDir, finalName);
            fs.writeFileSync(dest, content, 'utf-8');
            usbPath = dest;
            console.log(`[Electron Backup] Mirrored backup to external USB drive: ${dest}`);
            break;
          }
        } catch {}
      }
    }

    return { success: true, filePath, usbPath, fileName: finalName };
  } catch (err) {
    console.error('[Electron Backup] Error writing backup:', err);
    return { success: false, error: err.message };
  }
});

// Backward-compatible alias
ipcMain.handle('save-daily-backup', async (event, jsonContent) => {
  return ipcMain.emit('save-backup', event, { content: jsonContent });
});

ipcMain.handle('list-backups', async () => {
  try {
    const backupDir = resolveBackupDirectory();
    if (!fs.existsSync(backupDir)) return [];
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('muchachos-backup-') && f.endsWith('.json'))
      .sort()
      .reverse();

    return files.map(file => {
      const fullPath = path.join(backupDir, file);
      const stat = fs.statSync(fullPath);
      return {
        fileName: file,
        filePath: fullPath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString()
      };
    });
  } catch {
    return [];
  }
});

ipcMain.handle('pick-backup-file', async () => {
  try {
    const backupDir = resolveBackupDirectory();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Pick Muchachos Backup File',
      defaultPath: backupDir,
      filters: [{ name: 'JSON Backup', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (!result.canceled && result.filePaths.length > 0) {
      const filePath = result.filePaths[0];
      const content = fs.readFileSync(filePath, 'utf8');
      return { success: true, filePath, fileName: path.basename(filePath), content };
    }
    return { success: false, canceled: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('load-backup-file', async (event, filePath) => {
  try {
    if (!filePath || typeof filePath !== 'string') {
      return { success: false, error: 'No file path provided' };
    }
    // Security: only allow files inside the backup directory
    const backupDir = resolveBackupDirectory();
    const resolvedPath = path.resolve(filePath);
    const resolvedBackupDir = path.resolve(backupDir);
    if (!resolvedPath.startsWith(resolvedBackupDir)) {
      return { success: false, error: 'Access denied: file outside backup directory' };
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    return { success: true, filePath: resolvedPath, fileName: path.basename(resolvedPath), content };
  } catch (err) {
    return { success: false, error: err.message };
  }
});




