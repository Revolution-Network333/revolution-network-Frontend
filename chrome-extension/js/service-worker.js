let API_URL = 'https://revolution-backend-sal2.onrender.com';
const ALARM_NAME = 'rn_mining';

async function resolveApiUrl() {
  try {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), 800);
    const r = await fetch('http://localhost:3000/health', { signal: ctrl.signal });
    clearTimeout(id);
    if (r.ok) {
      API_URL = 'http://localhost:3000';
      await chrome.storage.local.set({ api_url: API_URL });
      return;
    }
  } catch {}
  const stored = await chrome.storage.local.get(['api_url']);
  if (stored.api_url) API_URL = stored.api_url;
}

let sessionId = null;
let isActive = false;
let sessionPoints = 0;
let miningRunning = false;
let logs = [];
let vpnEnabled = false;

async function getStoredTokens() {
  const s = await chrome.storage.local.get(['token','refreshToken','sessionPoints']);
  if (s.sessionPoints !== undefined) sessionPoints = s.sessionPoints;
  return { token: s.token || null, refreshToken: s.refreshToken || null };
}

async function setStoredToken(token) {
  await chrome.storage.local.set({ token });
}

async function clearStoredTokens() {
  await chrome.storage.local.set({ isActive: false, sessionId: null, token: null, refreshToken: null, sessionPoints: 0 });
  sessionPoints = 0;
}

async function tryRefreshToken() {
  try {
    const { refreshToken } = await getStoredTokens();
    if (!refreshToken) return null;
    const rf = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken })
    });
    if (!rf.ok) return null;
    const j = await rf.json().catch(()=>null);
    if (j && j.token) {
      await setStoredToken(j.token);
      return j.token;
    }
  } catch {}
  return null;
}

async function fetchWithAuth(url, init = {}, retry = true) {
  const headers = Object.assign({}, init.headers || {});
  let currentToken = headers.Authorization && headers.Authorization.startsWith('Bearer ')
    ? headers.Authorization.slice('Bearer '.length)
    : null;
  if (!currentToken) {
    const s = await getStoredTokens();
    currentToken = s.token;
  }
  if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
  const opts = Object.assign({}, init, { headers });
  let res = await fetch(url, opts);
  if ((res.status === 401 || res.status === 403) && retry) {
    const newToken = await tryRefreshToken();
    if (newToken) {
      const retryHeaders = Object.assign({}, headers, { 'Authorization': `Bearer ${newToken}` });
      res = await fetch(url, Object.assign({}, init, { headers: retryHeaders }));
    } else {
      await clearStoredTokens();
      isActive = false;
      sessionId = null;
      addLog('Session expirée — veuillez vous reconnecter sur le site.');
      try { chrome.notifications.create({ type: 'basic', iconUrl: 'assets/icon-128.png', title: 'Revolution Network', message: 'Session expirée — reconnectez‑vous sur le site.' }); } catch {}
    }
  }
  return res;
}

// Listen to messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getStatus') {
    sendResponse({
      isActive,
      sessionId,
      points: sessionPoints,
      logs: logs,
      vpnEnabled
    });
  } else if (request.action === 'start') {
    startMiningSession(request.token);
    sendResponse({ success: true });
  } else if (request.action === 'stop') {
    stopMiningSession(request.token);
    sendResponse({ success: true });
  } else if (request.action === 'vpnToggle') {
    toggleVpn(request.token).then(() => sendResponse({ success: true, vpnEnabled })).catch(() => sendResponse({ success: false }));
  }
  return true;
});

async function initFromStorage() {
  await resolveApiUrl();
  const s = await chrome.storage.local.get(['isActive','sessionId','token','sessionPoints']);
  isActive = !!s.isActive;
  sessionId = s.sessionId || null;
  sessionPoints = s.sessionPoints || 0;
  
  if (isActive) {
    ensureAlarm();
    if (!sessionId && s.token) {
      try { await startMiningSession(s.token); } catch {}
    } else if (sessionId && s.token && !miningRunning) {
      mine(s.token);
    }
  }
}

function ensureAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(() => { initFromStorage(); });
chrome.runtime.onStartup.addListener(() => { initFromStorage(); });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const s = await chrome.storage.local.get(['isActive','token','sessionId']);
  if (!s.isActive) return;
  
  // Sync global state if needed
  isActive = true;
  sessionId = s.sessionId;
  
  if (!sessionId && s.token) {
    try { await startMiningSession(s.token); } catch {}
  } else if (s.token && !miningRunning) {
    mine(s.token);
  }
});

function addLog(msg) {
    logs.push({ time: Date.now(), msg });
    if (logs.length > 50) logs.shift();
}

// Start a session
async function startMiningSession(token) {
  if (isActive && sessionId && miningRunning) return;
  
  try {
    addLog('Initializing session...');
    if (token) await setStoredToken(token);
    
    // Create a session via API
    const response = await fetchWithAuth(`${API_URL}/api/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, true);
    
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      const msg = (data && (data.error || data.message)) || 'Failed to create session';
      throw new Error(msg);
    }
    
    if (!data) throw new Error('Invalid server response');
    sessionId = data.sessionId;
    isActive = true;
    sessionPoints = 0;
    
    // Save to storage
    await chrome.storage.local.set({ 
      isActive: true, 
      sessionId,
      token,
      sessionPoints: 0
    });
    
    addLog(`Session active: ${data.name || sessionId}`);
    ensureAlarm();
    
    // Notification
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'assets/icon-128.png',
      title: 'Revolution Network',
      message: 'Mining started!',
    });
    
    // Start PoW mining
    if (!miningRunning) {
      mine(token);
    }
    
  } catch (error) {
    if (error && (error.message === 'invalid_token' || error.message === 'Unauthorized')) {
      addLog('Session expired — please sign in again on the website.');
      isActive = false;
      sessionId = null;
      await clearStoredTokens();
      try { chrome.notifications.create({ type: 'basic', iconUrl: 'assets/icon-128.png', title: 'Revolution Network', message: 'Session expired — open the website and sign in again.' }); } catch {}
    } else {
      addLog(`Error: ${error.message}`);
      isActive = false;
    }
  }
}

async function stopMiningSession(token) {
  addLog('Stopping mining...');
  isActive = false;
  
  if (sessionId && token) {
      try {
        await fetchWithAuth(`${API_URL}/api/session/end/${sessionId}`, {
            method: 'POST',
            headers: { }
        });
      } catch (e) {
          console.error(e);
      }
  }
  
  sessionId = null;
  await chrome.storage.local.set({ isActive: false, sessionId: null });
  addLog('Session ended.');
}

async function toggleVpn(token) {
  try {
    if (!vpnEnabled) {
      const res = await fetchWithAuth(`${API_URL}/api/shop/vpn/config`, { headers: {} });
      const cfg = await res.json();
      if (!res.ok) throw new Error(cfg.error || 'VPN not available');
      const pacData = `function FindProxyForURL(url, host) { return "PROXY ${cfg.host}:${cfg.port}"; }`;
      await chrome.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data: pacData } }, scope: 'regular' });
      vpnEnabled = true;
      addLog('VPN enabled');
    } else {
      await chrome.proxy.settings.clear({ scope: 'regular' });
      vpnEnabled = false;
      addLog('VPN disabled');
    }
  } catch (e) {
    addLog(`VPN error: ${e.message || e}`);
    throw e;
  }
}
// Boucle de minage PoW
async function mine(token) {
    if (miningRunning) return;
    miningRunning = true;
    
    const challenge = 'revolution_network_challenge_' + Date.now();
    let nonce = 0;
    
    addLog('Starting PoW process...');

    while (isActive) {
        // Simulation d'effort CPU pour ne pas bloquer complètement le thread
        // En vrai service worker, c'est mieux, mais attention à la batterie
        
        try {
            const attempt = `${challenge}:${nonce}`;
            const msgBuffer = new TextEncoder().encode(attempt);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

            if (hashHex.startsWith('0000')) {
                // Proof found!
                addLog(`Proof found: ${hashHex.substring(0, 8)}...`);
                await submitProof(token, challenge, nonce);
                
                // Nouveau challenge après succès
                nonce = 0; // ou continuer, peu importe
                // Pause pour ne pas spammer le serveur
                await new Promise(r => setTimeout(r, 1000));
            } else {
                nonce++;
                // Petite pause tous les N hashs pour rendre la main au système
                if (nonce % 1000 === 0) {
                    await new Promise(r => setTimeout(r, 10));
                }
            }
        } catch (e) {
            addLog(`Mining error: ${e.message}`);
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    miningRunning = false;
}

async function submitProof(token, challenge, nonce) {
    try {
        const res = await fetchWithAuth(`${API_URL}/api/rewards/proof-of-work`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ challenge, nonce, sessionId })
        }, true);
        const data = await res.json().catch(()=>null);
        if (res.ok && data && data.success) {
            sessionPoints += data.points_earned;
            await chrome.storage.local.set({ sessionPoints });
            addLog(`Accepted! +${data.points_earned} pts`);
        } else {
            const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
            addLog(`Rejected: ${msg}`);
        }
    } catch (e) {
        addLog('Network error while submitting');
    }
}
