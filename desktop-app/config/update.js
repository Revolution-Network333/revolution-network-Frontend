/**
 * Desktop App Update Configuration
 * electron-updater settings
 */

module.exports = {
  // Check for updates every 6 hours
  checkIntervalHours: 6,
  
  // Automatically download updates in background
  autoDownload: true,
  
  // Don't force install - let user restart when ready
  autoInstall: false,
  
  // Update provider (github, s3, or generic)
  provider: 'github',
  
  // GitHub settings (if provider is 'github')
  github: {
    owner: 'Revolution-Network333',
    repo: 'Revolution-Network',
    private: false,
    releaseType: 'release'
  },
  
  // S3 settings (if provider is 's3')
  s3: {
    bucket: 'your-update-bucket',
    region: 'us-east-1',
    path: 'updates/'
  },
  
  // Generic server settings (if provider is 'generic')
  generic: {
    url: 'https://your-update-server.com/updates',
    channel: 'latest'
  },
  
  // Security settings
  security: {
    // Verify checksum of downloaded files
    verifyChecksum: true,
    
    // Verify signature (requires code signing certificate)
    verifySignature: true,
    
    // Anti-downgrade protection
    allowDowngrade: false,
    
    // Timeout for download (60 seconds)
    downloadTimeout: 60000
  },
  
  // UI settings
  ui: {
    // Show notification when update is ready
    showNotification: true,
    
    // Allow user to dismiss update prompt (non-force updates)
    allowDismiss: true,
    
    // Progress bar style
    progressBar: true
  }
};
