let token = null;
let updateInterval = null;

// DOM elements
const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const toggleBtn = document.getElementById('toggleBtn');
const toggleIcon = document.getElementById('toggleIcon');
const logoutBtn = document.getElementById('logoutBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const sessionPoints = document.getElementById('sessionPoints');
const terminalLogs = document.getElementById('terminalLogs');
const appVersion = document.getElementById('appVersion');
const logoImg = document.getElementById('logoImg');

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const v = await window.electronAPI.getAppVersion();
    if (appVersion) appVersion.textContent = v ? `v${v}` : '';
  } catch {
    if (appVersion) appVersion.textContent = '';
  }

  // Load logo with absolute path
  try {
    const logoPath = await window.electronAPI.getLogoPath();
    if (logoImg && logoPath) {
      logoImg.src = logoPath;
    }
  } catch (e) {
    console.error('Failed to load logo:', e);
  }

  const storedToken = await window.electronAPI.getStoreValue('token');
  if (storedToken) {
    token = storedToken;
    showDashboard();
    startStatusUpdates();
  } else {
    showLogin();
  }
});

// Sign in
loginBtn.addEventListener('click', () => {
  window.electronAPI.openLoginWindow();
});

// Auth success listener from main process
window.electronAPI.onAuthSuccess((newToken) => {
  token = newToken;
  showDashboard();
  startStatusUpdates();
});

// Sign out
logoutBtn.addEventListener('click', async () => {
  window.electronAPI.logout();
  token = null;
  showLogin();
  stopStatusUpdates();
});

// Toggle mining (Play/Pause)
if (toggleBtn) {
  toggleBtn.addEventListener('click', async () => {
    toggleBtn.disabled = true;
    const status = await window.electronAPI.getStatus();
    if (status && status.isActive) {
      window.electronAPI.stopMining();
    } else {
      window.electronAPI.startMining(token);
    }
    setTimeout(() => {
      toggleBtn.disabled = false;
      updateUI();
    }, 500);
  });
}

function showLogin() {
  loginSection.classList.remove('hidden');
  dashboardSection.classList.add('hidden');
}

function showDashboard() {
  loginSection.classList.add('hidden');
  dashboardSection.classList.remove('hidden');
  updateUI();
}

function startStatusUpdates() {
  if (updateInterval) clearInterval(updateInterval);
  updateUI();
  updateInterval = setInterval(updateUI, 2000);
}

function stopStatusUpdates() {
  if (updateInterval) clearInterval(updateInterval);
}

async function updateUI() {
  const status = await window.electronAPI.getStatus();
  if (!status) return;

  if (status.isActive) {
    statusDot.className = 'dot active';
    statusText.textContent = 'ACTIVE';
    toggleIcon.textContent = '⏸';
  } else {
    statusDot.className = 'dot';
    statusText.textContent = 'INACTIVE';
    toggleIcon.textContent = '▶';
  }

  sessionPoints.textContent = Math.floor(status.points || 0);
  
  if (status.logs) {
    renderLogs(status.logs);
  }
}

function renderLogs(logs) {
  terminalLogs.innerHTML = '';
  logs.forEach(log => {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    const time = new Date(log.time).toLocaleTimeString();
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${log.msg}`;
    terminalLogs.appendChild(entry);
  });
  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

// Listen for updates from main process
window.electronAPI.onLogUpdate((logs) => {
  renderLogs(logs);
});

window.electronAPI.onStatusUpdate((status) => {
  if (status.points !== undefined) {
    sessionPoints.textContent = Math.floor(status.points);
  }
});
