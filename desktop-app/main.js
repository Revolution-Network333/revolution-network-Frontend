const { app, BrowserWindow, ipcMain, shell, Tray, Menu, Notification } = require('electron');
const path = require('path');
const Store = require('electron-store');
const crypto = require('crypto');

const store = new Store();
let mainWindow;
let tray;
let API_URL = 'https://revolution-backend-sal2.onrender.com';

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
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    resizable: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/icon.ico'),
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
  const loginWin = new BrowserWindow({
    width: 600,
    height: 800,
    autoHideMenuBar: true,
    parent: mainWindow,
    modal: true,
  });

  loginWin.loadURL('https://revolution-network.fr/');

  const checkToken = setInterval(async () => {
    try {
      if (loginWin.isDestroyed()) {
        clearInterval(checkToken);
        return;
      }
      const tokenData = await loginWin.webContents.executeJavaScript(`
        (function() {
          const token = localStorage.getItem('token');
          if (!token) return null;
          let user = null;
          try {
            const u = localStorage.getItem('user');
            if (u) user = JSON.parse(u);
          } catch(e) {}
          return {
            token: token,
            refreshToken: localStorage.getItem('refreshToken'),
            user: user
          };
        })()
      `);

      if (tokenData && tokenData.token) {
        clearInterval(checkToken);
        // Clean old session before saving new one
        await stopMiningSession();
        store.clear(); 
        
        store.set('token', tokenData.token);
        store.set('refreshToken', tokenData.refreshToken);
        if (tokenData.user) {
          store.set('user', tokenData.user);
        }
        
        if (mainWindow) {
          mainWindow.webContents.send('auth-success', tokenData.token);
        }
        
        loginWin.close();
        addLog('Successfully signed in from website!');
      }
    } catch (e) {}
  }, 1000);
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets/icon.ico'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show App', click: () => mainWindow.show() },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('Revolution Network Node');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => mainWindow.show());
}

app.whenReady().then(async () => {
  await resolveApiUrl();
  createWindow();
  createTray();
  if (isActive) mine();
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
ipcMain.on('set-store-value', (event, key, value) => store.set(key, value));
ipcMain.on('remove-store-value', (event, key) => store.delete(key));
ipcMain.on('open-external', (event, url) => shell.openExternal(url));
