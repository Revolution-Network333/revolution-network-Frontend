const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/app/version
 * Returns current app version info for all platforms
 * No authentication required - called on app startup
 */
router.get('/version', async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    // Get version config from system_config or use defaults
    let versionConfig = {
      version: '1.0.0',
      minVersion: '1.0.0',
      forceUpdate: false,
      forceUpdateDate: null,
      changelog: '',
      downloadUrlDesktop: 'https://github.com/Revolution-Network333/Revolution-Network/releases/latest',
      downloadUrlAndroid: 'https://play.google.com/store/apps/details?id=com.revolution.network',
      downloadUrlIOS: 'https://apps.apple.com/app/revolution-network/idXXXXXXXXXX',
      checksum: null,
      signature: null
    };
    
    try {
      const configRes = await db.query(
        "SELECT key, value FROM system_config WHERE key LIKE 'app_%'"
      );
      
      configRes.rows.forEach(row => {
        switch(row.key) {
          case 'app_version':
            versionConfig.version = row.value;
            break;
          case 'app_min_version':
            versionConfig.minVersion = row.value;
            break;
          case 'app_force_update':
            versionConfig.forceUpdate = row.value === 'true';
            break;
          case 'app_force_update_date':
            versionConfig.forceUpdateDate = row.value;
            break;
          case 'app_changelog':
            versionConfig.changelog = row.value;
            break;
          case 'app_download_desktop':
            versionConfig.downloadUrlDesktop = row.value;
            break;
          case 'app_download_android':
            versionConfig.downloadUrlAndroid = row.value;
            break;
          case 'app_download_ios':
            versionConfig.downloadUrlIOS = row.value;
            break;
          case 'app_checksum':
            versionConfig.checksum = row.value;
            break;
          case 'app_signature':
            versionConfig.signature = row.value;
            break;
        }
      });
    } catch (configErr) {
      console.log('Using default version config');
    }
    
    // Calculate days until force update
    let daysUntilForceUpdate = null;
    if (versionConfig.forceUpdateDate) {
      const forceDate = new Date(versionConfig.forceUpdateDate);
      const now = new Date();
      const diffTime = forceDate - now;
      daysUntilForceUpdate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
    
    res.json({
      ...versionConfig,
      daysUntilForceUpdate,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching app version:', error);
    // Return safe defaults on error
    res.json({
      version: '1.0.0',
      minVersion: '1.0.0',
      forceUpdate: false,
      forceUpdateDate: null,
      changelog: '',
      downloadUrlDesktop: 'https://github.com/Revolution-Network333/Revolution-Network/releases/latest',
      downloadUrlAndroid: 'https://play.google.com/store/apps/details?id=com.revolution.network',
      downloadUrlIOS: 'https://apps.apple.com/app/revolution-network/idXXXXXXXXXX',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/app/version
 * Admin endpoint to update version config
 */
router.post('/version', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    const db = req.app.locals.db;
    const {
      version,
      minVersion,
      forceUpdate,
      forceUpdateDate,
      changelog,
      downloadUrlDesktop,
      downloadUrlAndroid,
      downloadUrlIOS,
      checksum,
      signature
    } = req.body;
    
    // Upsert version config
    const configs = [
      ['app_version', version],
      ['app_min_version', minVersion],
      ['app_force_update', String(forceUpdate)],
      ['app_force_update_date', forceUpdateDate],
      ['app_changelog', changelog],
      ['app_download_desktop', downloadUrlDesktop],
      ['app_download_android', downloadUrlAndroid],
      ['app_download_ios', downloadUrlIOS],
      ['app_checksum', checksum],
      ['app_signature', signature]
    ];
    
    for (const [key, value] of configs) {
      if (value !== undefined) {
        await db.query(
          `INSERT INTO system_config (key, value, updated_at) 
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
          [key, value]
        );
      }
    }
    
    res.json({ success: true, message: 'Version config updated' });
    
  } catch (error) {
    console.error('Error updating app version:', error);
    res.status(500).json({ error: 'Failed to update version config' });
  }
});

/**
 * GET /api/app/check-update
 * Check if update is needed for specific platform and version
 */
router.get('/check-update', async (req, res) => {
  try {
    const { platform, version: currentVersion } = req.query;
    
    if (!platform || !currentVersion) {
      return res.status(400).json({ error: 'Platform and version required' });
    }
    
    const db = req.app.locals.db;
    
    // Get current app version from config
    const versionRes = await db.query(
      "SELECT value FROM system_config WHERE key = 'app_version'"
    );
    const latestVersion = versionRes.rows[0]?.value || '1.0.0';
    
    // Get min version
    const minVersionRes = await db.query(
      "SELECT value FROM system_config WHERE key = 'app_min_version'"
    );
    const minVersion = minVersionRes.rows[0]?.value || '1.0.0';
    
    // Get force update status
    const forceUpdateRes = await db.query(
      "SELECT value FROM system_config WHERE key = 'app_force_update'"
    );
    const forceUpdate = forceUpdateRes.rows[0]?.value === 'true';
    
    // Compare versions (semver)
    const needsUpdate = compareVersions(currentVersion, latestVersion) < 0;
    const isForceUpdate = forceUpdate || compareVersions(currentVersion, minVersion) < 0;
    
    res.json({
      platform,
      currentVersion,
      latestVersion,
      needsUpdate,
      isForceUpdate,
      canContinue: !isForceUpdate
    });
    
  } catch (error) {
    console.error('Error checking update:', error);
    res.status(500).json({ error: 'Failed to check update' });
  }
});

/**
 * Compare two semantic versions
 * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;
    
    if (part1 < part2) return -1;
    if (part1 > part2) return 1;
  }
  
  return 0;
}

module.exports = router;
