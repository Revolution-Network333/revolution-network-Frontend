/**
 * Auto Updater Module for Electron
 * Handles automatic updates with silent download and user-friendly install
 */

const { ipcMain, dialog, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const updateConfig = require('../config/update');
const https = require('https');

// Update state
let updateState = {
  checking: false,
  available: false,
  downloaded: false,
  error: null,
  progress: 0,
  version: null,
  forceUpdate: false,
  changelog: ''
};

// Main window reference
let mainWindow = null;
let updateWindow = null;

/**
 * Initialize auto updater
 * @param {BrowserWindow} win - Main application window
 */
function initAutoUpdater(win) {
  mainWindow = win;
  
  // Configure auto updater
  autoUpdater.autoDownload = updateConfig.autoDownload;
  autoUpdater.autoInstallOnAppQuit = updateConfig.autoInstall;
  autoUpdater.allowDowngrade = updateConfig.security.allowDowngrade;
  
  // Set update provider based on config
  if (updateConfig.provider === 'github') {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: updateConfig.github.owner,
      repo: updateConfig.github.repo,
      private: updateConfig.github.private,
      releaseType: updateConfig.github.releaseType
    });
  }
  
  // Event: Checking for update
  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
    updateState.checking = true;
    sendUpdateStatus('checking');
  });
  
  // Event: Update available
  autoUpdater.on('update-available', (info) => {
    console.log('Update available:', info.version);
    updateState.available = true;
    updateState.version = info.version;
    updateState.checking = false;
    
    // Check if this is a forced update from API
    checkForceUpdate().then((forceData) => {
      updateState.forceUpdate = forceData.forceUpdate;
      updateState.changelog = forceData.changelog || info.releaseNotes || '';
      
      if (updateState.forceUpdate) {
        // Force update - show blocking modal
        showForceUpdateModal();
      } else {
        // Normal update - show notification
        sendUpdateStatus('available', {
          version: info.version,
          changelog: updateState.changelog
        });
      }
    });
  });
  
  // Event: Update not available
  autoUpdater.on('update-not-available', (info) => {
    console.log('Update not available');
    updateState.checking = false;
    updateState.available = false;
    sendUpdateStatus('not-available');
  });
  
  // Event: Download progress
  autoUpdater.on('download-progress', (progressObj) => {
    updateState.progress = Math.round(progressObj.percent);
    console.log(`Download progress: ${updateState.progress}%`);
    sendUpdateStatus('downloading', {
      progress: updateState.progress,
      speed: progressObj.bytesPerSecond,
      transferred: progressObj.transferred,
      total: progressObj.total
    });
  });
  
  // Event: Update downloaded
  autoUpdater.on('update-downloaded', (info) => {
    console.log('Update downloaded');
    updateState.downloaded = true;
    updateState.progress = 100;
    
    if (updateState.forceUpdate) {
      // Force update - install immediately
      autoUpdater.quitAndInstall(true, true);
    } else {
      // Normal update - notify user
      sendUpdateStatus('ready', {
        version: updateState.version,
        changelog: updateState.changelog
      });
      
      // Show notification
      if (updateConfig.ui.showNotification) {
        showUpdateReadyNotification();
      }
    }
  });
  
  // Event: Error
  autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
    updateState.error = err.message;
    updateState.checking = false;
    sendUpdateStatus('error', { message: err.message });
  });
  
  // Setup IPC handlers
  setupIpcHandlers();
  
  // Start periodic check
  startPeriodicCheck();
  
  // Check immediately on startup (with delay to not slow down startup)
  setTimeout(() => {
    checkForUpdates();
  }, 5000);
}

/**
 * Check if force update is required from API
 */
async function checkForceUpdate() {
  return new Promise((resolve) => {
    const options = {
      hostname: 'revolution-backend-sal2.onrender.com',
      path: '/api/app/version',
      method: 'GET',
      timeout: 5000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve({
            forceUpdate: result.forceUpdate || false,
            changelog: result.changelog || '',
            minVersion: result.minVersion,
            latestVersion: result.version
          });
        } catch (e) {
          resolve({ forceUpdate: false, changelog: '' });
        }
      });
    });
    
    req.on('error', () => {
      resolve({ forceUpdate: false, changelog: '' });
    });
    
    req.on('timeout', () => {
      req.destroy();
      resolve({ forceUpdate: false, changelog: '' });
    });
    
    req.end();
  });
}

/**
 * Send update status to renderer process
 */
function sendUpdateStatus(status, data = {}) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', {
      status,
      ...data,
      state: updateState
    });
  }
}

/**
 * Show force update modal (blocking)
 */
function showForceUpdateModal() {
  if (updateWindow && !updateWindow.isDestroyed()) {
    return;
  }
  
  updateWindow = new BrowserWindow({
    width: 500,
    height: 400,
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    closable: false, // Cannot close without updating
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: __dirname + '/update-preload.js'
    }
  });
  
  updateWindow.loadURL(`data:text/html,${encodeURIComponent(getForceUpdateHTML())}`);
  
  updateWindow.on('closed', () => {
    updateWindow = null;
  });
  
  // Block main window interactions
  if (mainWindow) {
    mainWindow.setEnabled(false);
  }
}

/**
 * Get force update HTML
 */
function getForceUpdateHTML() {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          margin: 0;
          padding: 30px;
          background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
          color: white;
          text-align: center;
        }
        .icon { font-size: 60px; margin-bottom: 20px; }
        h1 { margin: 0 0 15px 0; font-size: 24px; }
        p { color: #a0a0a0; margin-bottom: 25px; line-height: 1.5; }
        .changelog {
          background: rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 15px;
          margin: 20px 0;
          text-align: left;
          max-height: 100px;
          overflow-y: auto;
        }
        .progress-bar {
          width: 100%;
          height: 8px;
          background: rgba(255,255,255,0.2);
          border-radius: 4px;
          margin: 20px 0;
          overflow: hidden;
        }
        .progress-fill {
          height: 100%;
          background: #4CAF50;
          border-radius: 4px;
          transition: width 0.3s;
        }
        button {
          background: #4CAF50;
          color: white;
          border: none;
          padding: 12px 30px;
          border-radius: 6px;
          font-size: 16px;
          cursor: pointer;
          margin-top: 10px;
        }
        button:hover { background: #45a049; }
        button:disabled { background: #666; cursor: not-allowed; }
      </style>
    </head>
    <body>
      <div class="icon">🚀</div>
      <h1>Mise à jour obligatoire</h1>
      <p>Une mise à jour importante est requise pour continuer à utiliser Revolution Network.</p>
      <div class="changelog" id="changelog">
        <strong>Nouveautés :</strong><br>
        ${updateState.changelog || 'Améliorations de performance et corrections de bugs'}
      </div>
      <div class="progress-bar" id="progress-bar" style="display:none;">
        <div class="progress-fill" id="progress-fill" style="width: 0%"></div>
      </div>
      <div id="status">Téléchargement en cours...</div>
      <button id="update-btn" disabled>Installation...</button>
      
      <script>
        const { ipcRenderer } = require('electron');
        
        ipcRenderer.on('update-progress', (event, data) => {
          document.getElementById('progress-bar').style.display = 'block';
          document.getElementById('progress-fill').style.width = data.progress + '%';
          document.getElementById('status').textContent = 
            data.progress < 100 ? \`Téléchargement... \${data.progress}%\` : 'Prêt à installer';
          
          if (data.progress >= 100) {
            document.getElementById('update-btn').disabled = false;
            document.getElementById('update-btn').textContent = 'Redémarrer maintenant';
          }
        });
        
        document.getElementById('update-btn').addEventListener('click', () => {
          ipcRenderer.send('force-update-install');
        });
      </script>
    </body>
    </html>
  `;
}

/**
 * Show update ready notification
 */
function showUpdateReadyNotification() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  
  mainWindow.webContents.executeJavaScript(`
    if (window.showUpdateNotification) {
      window.showUpdateNotification({
        version: '${updateState.version}',
        changelog: '${updateState.changelog.replace(/'/g, "\\'")}'
      });
    }
  `);
}

/**
 * Setup IPC handlers for renderer communication
 */
function setupIpcHandlers() {
  // Check for updates manually
  ipcMain.handle('check-for-updates', async () => {
    await checkForUpdates();
    return updateState;
  });
  
  // Download update
  ipcMain.handle('download-update', async () => {
    await autoUpdater.downloadUpdate();
    return updateState;
  });
  
  // Install update
  ipcMain.handle('install-update', async () => {
    autoUpdater.quitAndInstall(true, true);
  });
  
  // Force update install
  ipcMain.on('force-update-install', () => {
    autoUpdater.quitAndInstall(true, true);
  });
  
  // Get current version
  ipcMain.handle('get-app-version', () => {
    return require('../package.json').version;
  });
  
  // Dismiss update (only for non-force updates)
  ipcMain.handle('dismiss-update', () => {
    if (!updateState.forceUpdate) {
      updateState.available = false;
      sendUpdateStatus('dismissed');
    }
  });
}

/**
 * Check for updates
 */
async function checkForUpdates() {
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('Error checking for updates:', err);
    updateState.error = err.message;
  }
}

/**
 * Start periodic update checks
 */
function startPeriodicCheck() {
  const intervalMs = updateConfig.checkIntervalHours * 60 * 60 * 1000;
  
  setInterval(() => {
    console.log('Running periodic update check...');
    checkForUpdates();
  }, intervalMs);
}

/**
 * Get current update state
 */
function getUpdateState() {
  return { ...updateState };
}

module.exports = {
  initAutoUpdater,
  checkForUpdates,
  getUpdateState
};
