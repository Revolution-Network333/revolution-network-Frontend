/**
 * Update UI Components for Desktop App
 * Handles update banners, modals, and notifications in the renderer process
 */

(function() {
  'use strict';
  
  // Update state
  let updateState = {
    available: false,
    downloaded: false,
    version: null,
    changelog: '',
    progress: 0,
    forceUpdate: false
  };
  
  // DOM Elements (created dynamically)
  let bannerEl = null;
  let modalEl = null;
  let notificationEl = null;
  
  /**
   * Initialize update UI
   */
  function initUpdateUI() {
    // Listen for update status from main process
    if (window.electronAPI && window.electronAPI.receive) {
      window.electronAPI.receive('update-status', handleUpdateStatus);
    }
    
    // Check for updates on load (after a delay)
    setTimeout(() => {
      checkForUpdates();
    }, 10000);
    
    // Add styles
    addUpdateStyles();
  }
  
  /**
   * Handle update status messages
   */
  function handleUpdateStatus(event) {
    const data = event || {};
    
    switch (data.status) {
      case 'checking':
        console.log('Checking for updates...');
        break;
        
      case 'available':
        updateState.available = true;
        updateState.version = data.version;
        updateState.changelog = data.changelog;
        showUpdateBanner();
        break;
        
      case 'downloading':
        updateState.progress = data.progress;
        updateProgressBar();
        break;
        
      case 'ready':
        updateState.downloaded = true;
        updateState.progress = 100;
        showUpdateNotification();
        break;
        
      case 'error':
        console.error('Update error:', data.message);
        hideUpdateBanner();
        break;
        
      case 'dismissed':
        hideUpdateBanner();
        break;
    }
  }
  
  /**
   * Check for updates
   */
  async function checkForUpdates() {
    if (window.electronAPI && window.electronAPI.checkForUpdates) {
      await window.electronAPI.checkForUpdates();
    }
  }
  
  /**
   * Show update banner (non-blocking)
   */
  function showUpdateBanner() {
    if (bannerEl) return;
    
    bannerEl = document.createElement('div');
    bannerEl.id = 'update-banner';
    bannerEl.innerHTML = `
      <div class="update-banner-content">
        <span class="update-icon">🚀</span>
        <span class="update-text">
          Nouvelle version disponible : <strong>v${updateState.version}</strong>
        </span>
        <button class="update-btn-primary" onclick="window.updateUI.downloadUpdate()">
          Télécharger
        </button>
        <button class="update-btn-secondary" onclick="window.updateUI.dismissUpdate()">
          Plus tard
        </button>
      </div>
    `;
    
    document.body.appendChild(bannerEl);
    
    // Animate in
    setTimeout(() => {
      bannerEl.classList.add('show');
    }, 100);
  }
  
  /**
   * Hide update banner
   */
  function hideUpdateBanner() {
    if (!bannerEl) return;
    
    bannerEl.classList.remove('show');
    setTimeout(() => {
      if (bannerEl && bannerEl.parentNode) {
        bannerEl.parentNode.removeChild(bannerEl);
      }
      bannerEl = null;
    }, 300);
  }
  
  /**
   * Show update notification (when ready to install)
   */
  function showUpdateNotification() {
    if (notificationEl) return;
    
    notificationEl = document.createElement('div');
    notificationEl.id = 'update-notification';
    notificationEl.innerHTML = `
      <div class="update-notification-content">
        <div class="update-notification-header">
          <span class="update-icon">✅</span>
          <span class="update-title">Mise à jour prête</span>
        </div>
        <div class="update-notification-body">
          La version <strong>v${updateState.version}</strong> est téléchargée et prête à être installée.
          ${updateState.changelog ? `<div class="update-changelog">${updateState.changelog}</div>` : ''}
        </div>
        <div class="update-notification-actions">
          <button class="update-btn-primary" onclick="window.updateUI.installUpdate()">
            Redémarrer et installer
          </button>
          <button class="update-btn-secondary" onclick="window.updateUI.dismissNotification()">
            Plus tard
          </button>
        </div>
      </div>
    `;
    
    document.body.appendChild(notificationEl);
    
    setTimeout(() => {
      notificationEl.classList.add('show');
    }, 100);
    
    // Auto-dismiss after 30 seconds if not force update
    if (!updateState.forceUpdate) {
      setTimeout(() => {
        dismissNotification();
      }, 30000);
    }
  }
  
  /**
   * Hide update notification
   */
  function dismissNotification() {
    if (!notificationEl) return;
    
    notificationEl.classList.remove('show');
    setTimeout(() => {
      if (notificationEl && notificationEl.parentNode) {
        notificationEl.parentNode.removeChild(notificationEl);
      }
      notificationEl = null;
    }, 300);
  }
  
  /**
   * Update progress bar during download
   */
  function updateProgressBar() {
    const progressEl = document.getElementById('update-progress');
    if (progressEl) {
      progressEl.style.width = updateState.progress + '%';
      progressEl.textContent = updateState.progress + '%';
    }
  }
  
  /**
   * Download update
   */
  async function downloadUpdate() {
    try {
      if (window.electronAPI && window.electronAPI.downloadUpdate) {
        await window.electronAPI.downloadUpdate();
      }
      
      // Change banner to show progress
      if (bannerEl) {
        bannerEl.innerHTML = `
          <div class="update-banner-content">
            <span class="update-icon">⬇️</span>
            <span class="update-text">Téléchargement de la mise à jour...</span>
            <div class="update-progress-bar">
              <div class="update-progress-fill" id="update-progress" style="width: 0%"></div>
            </div>
          </div>
        `;
      }
    } catch (err) {
      console.error('Error downloading update:', err);
      alert('Erreur lors du téléchargement de la mise à jour');
    }
  }
  
  /**
   * Install update
   */
  async function installUpdate() {
    try {
      if (window.electronAPI && window.electronAPI.installUpdate) {
        await window.electronAPI.installUpdate();
      }
    } catch (err) {
      console.error('Error installing update:', err);
      alert('Erreur lors de l\'installation de la mise à jour');
    }
  }
  
  /**
   * Dismiss update (for non-force updates)
   */
  async function dismissUpdate() {
    hideUpdateBanner();
    
    if (window.electronAPI && window.electronAPI.dismissUpdate) {
      await window.electronAPI.dismissUpdate();
    }
  }
  
  /**
   * Add update styles to document
   */
  function addUpdateStyles() {
    const styles = document.createElement('style');
    styles.textContent = `
      /* Update Banner */
      #update-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 20px;
        z-index: 10000;
        transform: translateY(-100%);
        transition: transform 0.3s ease;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
      }
      
      #update-banner.show {
        transform: translateY(0);
      }
      
      .update-banner-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 15px;
        max-width: 1200px;
        margin: 0 auto;
      }
      
      .update-icon {
        font-size: 20px;
      }
      
      .update-text {
        font-size: 14px;
      }
      
      .update-btn-primary,
      .update-btn-secondary {
        padding: 6px 16px;
        border-radius: 4px;
        border: none;
        font-size: 13px;
        cursor: pointer;
        transition: opacity 0.2s;
      }
      
      .update-btn-primary {
        background: white;
        color: #667eea;
        font-weight: 600;
      }
      
      .update-btn-secondary {
        background: rgba(255,255,255,0.2);
        color: white;
      }
      
      .update-btn-primary:hover,
      .update-btn-secondary:hover {
        opacity: 0.9;
      }
      
      .update-progress-bar {
        width: 150px;
        height: 6px;
        background: rgba(255,255,255,0.3);
        border-radius: 3px;
        overflow: hidden;
      }
      
      .update-progress-fill {
        height: 100%;
        background: white;
        border-radius: 3px;
        transition: width 0.3s;
      }
      
      /* Update Notification */
      #update-notification {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 350px;
        background: white;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        z-index: 10001;
        transform: translateX(400px);
        transition: transform 0.3s ease;
        overflow: hidden;
      }
      
      #update-notification.show {
        transform: translateX(0);
      }
      
      .update-notification-content {
        padding: 20px;
      }
      
      .update-notification-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
      }
      
      .update-title {
        font-weight: 600;
        font-size: 16px;
        color: #333;
      }
      
      .update-notification-body {
        font-size: 14px;
        color: #666;
        line-height: 1.5;
        margin-bottom: 15px;
      }
      
      .update-changelog {
        margin-top: 10px;
        padding: 10px;
        background: #f5f5f5;
        border-radius: 6px;
        font-size: 13px;
        max-height: 80px;
        overflow-y: auto;
      }
      
      .update-notification-actions {
        display: flex;
        gap: 10px;
      }
      
      .update-notification-actions .update-btn-primary {
        background: #667eea;
        color: white;
        flex: 1;
      }
      
      .update-notification-actions .update-btn-secondary {
        background: #f0f0f0;
        color: #666;
      }
    `;
    
    document.head.appendChild(styles);
  }
  
  // Expose API globally
  window.updateUI = {
    initUpdateUI,
    downloadUpdate,
    installUpdate,
    dismissUpdate,
    dismissNotification,
    showUpdateNotification,
    getState: () => ({ ...updateState })
  };
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUpdateUI);
  } else {
    initUpdateUI();
  }
})();
