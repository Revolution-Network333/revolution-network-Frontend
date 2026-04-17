const { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const crypto = require('crypto');
const { initAutoUpdater, checkForUpdates } = require('./js/auto-updater');

// Register custom protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('revolution-network', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('revolution-network');
}

app.name = 'Revolution Network Node';
const store = new Store();
let mainWindow;
let tray;
let API_URL = 'https://revolution-backend-sal2.onrender.com';
const getAppIconPath = () => {
  if (app.isPackaged) return path.join(process.resourcesPath, 'assets', 'icon.ico');
  return path.join(__dirname, '..', 'nexon.ico');
};

const getLogoPath = () => {
  if (app.isPackaged) return path.join(process.resourcesPath, 'assets', 'logo.jpg');
  return path.join(__dirname, 'assets', 'logo.jpg');
};

// Handle deep links
function handleDeepLink(url) {
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol === 'revolution-network:' && parsedUrl.hostname === 'auth') {
      const params = parsedUrl.searchParams;
      const token = params.get('token');
      const refreshToken = params.get('refreshToken');
      const userStr = params.get('user');

      if (token) {
        store.set('token', token);
        if (refreshToken) store.set('refreshToken', refreshToken);
        if (userStr) {
          try {
            store.set('user', JSON.parse(decodeURIComponent(userStr)));
          } catch (e) {}
        }
        
        if (mainWindow) {
          mainWindow.webContents.send('auth-success', token);
          mainWindow.show();
        }
        addLog('Successfully signed in via browser!');
      }
    }
  } catch (e) {
    console.error('Failed to handle deep link:', e);
  }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    // Handle the deep link from commandLine (Windows)
    const url = commandLine.pop();
    if (url.startsWith('revolution-network://')) {
      handleDeepLink(url);
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });
}

// State
let sessionId = store.get('sessionId') || null;
let isActive = store.get('isActive') || false;
let sessionPoints = store.get('sessionPoints') || 0;
let miningRunning = false;
let logs = [];

async function resolveApiUrl() {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 800);
    const r = await fetch('http://localhost:3000/health', { signal: ctrl.signal });
    clearTimeout(id);
    if (r.ok) {
      API_URL = 'http://localhost:3000';
    }
  } catch {}
}

function addLog(msg) {
  logs.push({ time: Date.now(), msg });
  if (logs.length > 50) logs.shift();
  if (mainWindow) mainWindow.webContents.send('log-update', logs);
}

async function tryRefreshToken() {
  try {
    const refreshToken = store.get('refreshToken');
    if (!refreshToken) return null;
    const rf = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    if (!rf.ok) return null;
    const j = await rf.json().catch(() => null);
    if (j && j.token) {
      store.set('token', j.token);
      return j.token;
    }
  } catch {}
  return null;
}

async function fetchWithAuth(url, init = {}, retry = true) {
  const headers = Object.assign({}, init.headers || {});
  let currentToken = store.get('token');
  if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  const opts = Object.assign({}, init, { headers });
  let res = await fetch(url, opts);
  if ((res.status === 401 || res.status === 403) && retry) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      const retryHeaders = Object.assign({}, headers, { 'Authorization': `Bearer ${newToken}` });
      res = await fetch(url, Object.assign({}, init, { headers: retryHeaders }));
    } else {
      stopMiningSession();
      addLog('Session expirée — veuillez vous reconnecter.');
      new Notification({ title: 'Revolution Network', body: 'Session expirée — reconnectez-vous.' }).show();
    }
  }
  return res;
}

async function startMiningSession(token) {
  if (isActive && sessionId && miningRunning) return;
  try {
    addLog('Initializing session...');
    if (token) store.set('token', token);
    const response = await fetchWithAuth(`${API_URL}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    let data = await response.json().catch(() => null);
    if (!response.ok) throw new Error((data && (data.error || data.message)) || 'Failed to create session');
    
    sessionId = data.sessionId;
    isActive = true;
    sessionPoints = 0;
    
    store.set('isActive', true);
    store.set('sessionId', sessionId);
    store.set('sessionPoints', 0);
    
    addLog(`Session active: ${data.name || sessionId}`);
    new Notification({ title: 'Revolution Network', body: 'Mining started!' }).show();
    if (!miningRunning) mine();
  } catch (error) {
    addLog(`Error: ${error.message}`);
    isActive = false;
    store.set('isActive', false);
  }
}

async function stopMiningSession() {
  addLog('Stopping mining...');
  isActive = false;
  miningRunning = false;
  const token = store.get('token');
  if (sessionId && token) {
    try {
      await fetchWithAuth(`${API_URL}/api/session/end/${sessionId}`, { method: 'POST' });
    } catch (e) { console.error(e); }
  }
  sessionId = null;
  sessionPoints = 0;
  store.set('isActive', false);
  store.set('sessionId', null);
  store.set('sessionPoints', 0);
  addLog('Session ended.');
}

async function mine() {
  if (miningRunning) return;
  miningRunning = true;
  const challenge = 'revolution_network_challenge_' + Date.now();
  let nonce = 0;
  addLog('Starting PoW process...');
  while (isActive) {
    try {
      const attempt = `${challenge}:${nonce}`;
      const hash = crypto.createHash('sha256').update(attempt).digest('hex');
      if (hash.startsWith('0000')) {
        addLog(`Proof found: ${hash.substring(0, 8)}...`);
        await submitProof(challenge, nonce);
        nonce = 0;
        await new Promise(r => setTimeout(r, 1000));
      } else {
        nonce++;
        if (nonce % 1000 === 0) await new Promise(r => setTimeout(r, 10));
      }
    } catch (e) {
      addLog(`Mining error: ${e.message}`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  miningRunning = false;
}

async function submitProof(challenge, nonce) {
  try {
    const res = await fetchWithAuth(`${API_URL}/api/rewards/proof-of-work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challenge, nonce, sessionId })
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.success) {
      sessionPoints += data.points_earned;
      store.set('sessionPoints', sessionPoints);
      addLog(`Accepted! +${data.points_earned} pts`);
      if (mainWindow) mainWindow.webContents.send('status-update', { points: sessionPoints });
    } else {
      addLog(`Rejected: ${(data && (data.error || data.message)) || 'Unknown error'}`);
    }
  } catch (e) { addLog('Network error while submitting'); }
}

function createWindow() {
  const isHidden = process.argv.includes('--hidden');
  const isDev = !app.isPackaged; // Force show in development
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    resizable: false,
    autoHideMenuBar: true,
    show: !isHidden || isDev, // Always show in development
    icon: getAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
    return false;
  });
}

function createLoginWindow() {
  shell.openExternal('https://revolution-network.fr/?desktop=true');
}

function createTray() {
  tray = new Tray(getAppIconPath());
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
    { label: 'Check updates', click: () => checkForUpdates() },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Revolution Network Node');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

function prepareForUpdateInstall() {
  app.isQuitting = true;

  // Destroy tray to release the process
  if (tray) {
    tray.destroy();
    tray = null;
  }

  // Force destroy all windows (not just close — close can be intercepted)
  const allWindows = BrowserWindow.getAllWindows();
  for (const win of allWindows) {
    try {
      win.removeAllListeners('close');
      win.destroy();
    } catch (e) {}
  }
  mainWindow = null;
}

function enableAutoStart() {
  // Only for Windows and non-dev environments for safety
  if (process.platform === 'win32') {
    const isDev = !app.isPackaged;
    if (!isDev) {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: app.getPath('exe'),
        args: ['--hidden']
      });
    }
  }
}

app.whenReady().then(async () => {
  await resolveApiUrl();
  createWindow();
  createTray();
  enableAutoStart();
  if (isActive) mine();
  addLog(`App version: v${app.getVersion()}`);
  
  // Initialize auto-updater after window is created
  initAutoUpdater(mainWindow, addLog, prepareForUpdateInstall);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {}
});

// IPC Handlers
ipcMain.on('open-login-window', () => createLoginWindow());

ipcMain.handle('get-status', () => ({
  isActive,
  sessionId,
  points: sessionPoints,
  logs
}));

ipcMain.on('start-mining', (event, token) => startMiningSession(token));
ipcMain.on('stop-mining', () => stopMiningSession());

ipcMain.on('logout', async () => {
  await stopMiningSession();
  store.clear();
  isActive = false;
  sessionId = null;
  sessionPoints = 0;
  addLog('Logged out and session cleared.');
});

ipcMain.handle('get-store-value', (event, key) => store.get(key));
ipcMain.handle('get-logo-path', () => getLogoPath());
ipcMain.on('set-store-value', (event, key, value) => store.set(key, value));
ipcMain.on('remove-store-value', (event, key) => store.delete(key));
ipcMain.on('open-external', (event, url) => shell.openExternal(url));
