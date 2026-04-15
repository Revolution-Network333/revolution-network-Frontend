/**
 * Expo/React Native App Update Service
 * Cross-platform update checking for iOS and Android
 * 
 * For Expo apps using EAS Update or native modules
 */

import { Platform, Linking, Alert } from 'react-native';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

// Update state interface
export interface UpdateState {
  checking: boolean;
  updateAvailable: boolean;
  updateDownloaded: boolean;
  forceUpdate: boolean;
  version: string | null;
  currentVersion: string;
  changelog: string;
  daysUntilForceUpdate: number | null;
  downloadUrl: string | null;
  error: string | null;
}

// API response interface
interface VersionApiResponse {
  version: string;
  minVersion: string;
  forceUpdate: boolean;
  forceUpdateDate: string | null;
  changelog: string;
  downloadUrlDesktop: string;
  downloadUrlAndroid: string;
  downloadUrlIOS: string;
  checksum: string | null;
  signature: string | null;
  daysUntilForceUpdate: number | null;
  timestamp: string;
}

class AppUpdateService {
  private API_URL = 'https://revolution-backend-sal2.onrender.com/api/app/version';
  private CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
  
  private state: UpdateState = {
    checking: false,
    updateAvailable: false,
    updateDownloaded: false,
    forceUpdate: false,
    version: null,
    currentVersion: Constants.expoConfig?.version || '1.0.0',
    changelog: '',
    daysUntilForceUpdate: null,
    downloadUrl: null,
    error: null
  };
  
  private listeners: ((state: UpdateState) => void)[] = [];
  private checkInterval: NodeJS.Timeout | null = null;

  /**
   * Subscribe to state changes
   */
  onStateChange(listener: (state: UpdateState) => void) {
    this.listeners.push(listener);
    listener(this.state); // Emit initial state
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  /**
   * Emit state change to all listeners
   */
  private emitStateChange() {
    this.listeners.forEach(listener => listener(this.state));
  }

  /**
   * Set state and notify listeners
   */
  private setState(partialState: Partial<UpdateState>) {
    this.state = { ...this.state, ...partialState };
    this.emitStateChange();
  }

  /**
   * Check for updates from API
   */
  async checkForUpdates(): Promise<void> {
    try {
      this.setState({ checking: true, error: null });

      const response = await fetch(this.API_URL, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data: VersionApiResponse = await response.json();

      // Compare versions
      const currentVersion = this.state.currentVersion;
      const latestVersion = data.version;
      const minVersion = data.minVersion;

      const needsUpdate = this.compareVersions(currentVersion, latestVersion) < 0;
      const isForceUpdate = data.forceUpdate || this.compareVersions(currentVersion, minVersion) < 0;

      if (needsUpdate) {
        const downloadUrl = Platform.select({
          ios: data.downloadUrlIOS,
          android: data.downloadUrlAndroid,
          default: data.downloadUrlDesktop
        });

        this.setState({
          checking: false,
          updateAvailable: true,
          forceUpdate: isForceUpdate,
          version: latestVersion,
          changelog: data.changelog,
          daysUntilForceUpdate: data.daysUntilForceUpdate,
          downloadUrl
        });

        if (isForceUpdate) {
          this.showForceUpdateModal();
        } else {
          this.showUpdateBanner();
        }
      } else {
        this.setState({ checking: false, updateAvailable: false });
      }
    } catch (error) {
      console.error('Update check failed:', error);
      this.setState({ 
        checking: false, 
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Compare two semantic versions
   * Returns: -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  private compareVersions(v1: string, v2: string): number {
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

  /**
   * Show update banner (non-blocking)
   */
  private showUpdateBanner(): void {
    // This would integrate with your UI component
    // For now, just log - UI should listen to state changes
    console.log('Update available:', this.state.version);
  }

  /**
   * Show force update modal (blocking)
   */
  private showForceUpdateModal(): void {
    const { version, changelog, downloadUrl } = this.state;

    Alert.alert(
      'Mise à jour obligatoire',
      `La version ${version} est requise pour continuer.\n\n${changelog || 'Améliorations et corrections de bugs'}`,
      [
        {
          text: 'Mettre à jour',
          onPress: () => this.openStore(),
        }
      ],
      { cancelable: false }
    );
  }

  /**
   * Open app store for update
   */
  openStore(): void {
    const { downloadUrl } = this.state;
    
    if (downloadUrl) {
      Linking.openURL(downloadUrl).catch(() => {
        // Fallback to generic store URL
        const fallbackUrl = Platform.select({
          ios: 'https://apps.apple.com',
          android: 'https://play.google.com/store',
          default: downloadUrl
        });
        Linking.openURL(fallbackUrl);
      });
    }
  }

  /**
   * Dismiss update notification
   */
  dismissUpdate(): void {
    this.setState({ updateAvailable: false });
  }

  /**
   * Mark update as downloaded (for platforms that support OTA)
   */
  markUpdateDownloaded(): void {
    this.setState({ updateDownloaded: true });
  }

  /**
   * Start periodic update checks
   */
  startPeriodicChecks(): void {
    // Check immediately
    this.checkForUpdates();

    // Then every 6 hours
    this.checkInterval = setInterval(() => {
      this.checkForUpdates();
    }, this.CHECK_INTERVAL_MS);
  }

  /**
   * Stop periodic checks
   */
  stopPeriodicChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Get current state
   */
  getState(): UpdateState {
    return { ...this.state };
  }

  /**
   * Check if running in Expo Go (development)
   */
  isExpoGo(): boolean {
    return Constants.appOwnership === 'expo';
  }

  /**
   * For EAS Update: Check for OTA updates
   * (Expo's over-the-air update system)
   */
  async checkEASUpdate(): Promise<boolean> {
    if (this.isExpoGo()) {
      return false; // EAS updates don't work in Expo Go
    }

    try {
      const update = await Updates.checkForUpdateAsync();
      
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        this.setState({ 
          updateAvailable: true, 
          updateDownloaded: true,
          version: 'EAS Update'
        });
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('EAS update check failed:', error);
      return false;
    }
  }

  /**
   * Apply EAS update (reload app)
   */
  async applyEASUpdate(): Promise<void> {
    try {
      await Updates.reloadAsync();
    } catch (error) {
      console.error('Failed to apply EAS update:', error);
    }
  }

  /**
   * Get iOS specific App Store version
   * Uses iTunes Lookup API
   */
  async getIOSStoreVersion(bundleId: string): Promise<string | null> {
    try {
      const response = await fetch(
        `https://itunes.apple.com/lookup?bundleId=${bundleId}`,
        { method: 'GET' }
      );

      const data = await response.json();
      
      if (data.resultCount > 0) {
        return data.results[0].version;
      }
      
      return null;
    } catch (error) {
      console.error('Failed to get iOS store version:', error);
      return null;
    }
  }
}

// Export singleton instance
export const appUpdateService = new AppUpdateService();
export default AppUpdateService;
