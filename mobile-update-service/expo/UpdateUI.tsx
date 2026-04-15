/**
 * React Native/Expo Update UI Components
 * Cross-platform update banners and modals
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UpdateState } from './AppUpdateService';

interface UpdateBannerProps {
  state: UpdateState;
  onDownload: () => void;
  onDismiss: () => void;
}

/**
 * Non-blocking update banner (top of screen)
 */
export const UpdateBanner: React.FC<UpdateBannerProps> = ({
  state,
  onDownload,
  onDismiss,
}) => {
  if (!state.updateAvailable || state.updateDownloaded) return null;

  return (
    <Animated.View style={styles.banner}>
      <View style={styles.bannerContent}>
        <Ionicons name="rocket-outline" size={24} color="white" />
        <View style={styles.bannerText}>
          <Text style={styles.bannerTitle}>
            Nouvelle version disponible
          </Text>
          {state.version && (
            <Text style={styles.bannerSubtitle}>Version {state.version}</Text>
          )}
        </View>
      </View>
      
      <View style={styles.bannerActions}>
        <TouchableOpacity
          style={styles.downloadButton}
          onPress={onDownload}
        >
          <Text style={styles.downloadButtonText}>Télécharger</Text>
        </TouchableOpacity>
        
        {!state.forceUpdate && (
          <TouchableOpacity onPress={onDismiss}>
            <Ionicons name="close" size={24} color="white" />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
};

interface UpdateModalProps {
  state: UpdateState;
  onInstall: () => void;
  onDismiss: () => void;
  progress?: number;
}

/**
 * Update ready notification (bottom card)
 */
export const UpdateReadyCard: React.FC<UpdateModalProps> = ({
  state,
  onInstall,
  onDismiss,
}) => {
  if (!state.updateDownloaded) return null;

  return (
    <View style={styles.cardContainer}>
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="checkmark-circle" size={28} color="#4CAF50" />
          <Text style={styles.cardTitle}>Mise à jour prête</Text>
        </View>
        
        <Text style={styles.cardBody}>
          La version {state.version} est téléchargée et prête à être installée.
        </Text>
        
        {state.changelog ? (
          <View style={styles.changelog}>
            <Text style={styles.changelogText}>{state.changelog}</Text>
          </View>
        ) : null}
        
        <View style={styles.cardActions}>
          {!state.forceUpdate && (
            <TouchableOpacity style={styles.laterButton} onPress={onDismiss}>
              <Text style={styles.laterButtonText}>Plus tard</Text>
            </TouchableOpacity>
          )}
          
          <TouchableOpacity style={styles.installButton} onPress={onInstall}>
            <Text style={styles.installButtonText}>
              Redémarrer et installer
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

/**
 * Force update modal (blocking)
 */
export const ForceUpdateModal: React.FC<{
  state: UpdateState;
  progress?: number;
  onUpdate: () => void;
}> = ({ state, progress = 0, onUpdate }) => {
  if (!state.forceUpdate) return null;

  const isReady = state.updateDownloaded || progress >= 100;

  return (
    <Modal transparent animationType="fade" visible={state.forceUpdate}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <Ionicons name="download" size={48} color="#667EEA" />
          
          <Text style={styles.modalTitle}>Mise à jour obligatoire</Text>
          
          <Text style={styles.modalBody}>
            Une mise à jour importante est requise pour continuer à utiliser Revolution Network.
          </Text>
          
          {state.changelog ? (
            <View style={styles.changelog}>
              <Text style={styles.changelogTitle}>Nouveautés :</Text>
              <Text style={styles.changelogText}>{state.changelog}</Text>
            </View>
          ) : null}
          
          {progress > 0 && progress < 100 ? (
            <View style={styles.progressContainer}>
              <Text style={styles.progressText}>
                Téléchargement... {progress.toFixed(0)}%
              </Text>
              <View style={styles.progressBar}>
                <View
                  style={[styles.progressFill, { width: `${progress}%` }]}
                />
              </View>
            </View>
          ) : null}
          
          <TouchableOpacity
            style={[styles.updateButton, !isReady && styles.updateButtonDisabled]}
            onPress={onUpdate}
            disabled={!isReady}
          >
            <Text style={styles.updateButtonText}>
              {isReady ? 'Mettre à jour maintenant' : 'Installation...'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

/**
 * Combined update handler component
 */
export const UpdateHandler: React.FC<{
  state: UpdateState;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
  progress?: number;
}> = ({ state, onDownload, onInstall, onDismiss, progress }) => {
  return (
    <>
      <UpdateBanner
        state={state}
        onDownload={onDownload}
        onDismiss={onDismiss}
      />
      
      <UpdateReadyCard
        state={state}
        onInstall={onInstall}
        onDismiss={onDismiss}
      />
      
      <ForceUpdateModal
        state={state}
        progress={progress}
        onUpdate={onInstall}
      />
    </>
  );
};

const styles = StyleSheet.create({
  // Banner styles
  banner: {
    backgroundColor: '#667EEA',
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  bannerText: {
    marginLeft: 12,
  },
  bannerTitle: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  bannerSubtitle: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
  },
  bannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  downloadButton: {
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  downloadButtonText: {
    color: '#667EEA',
    fontWeight: '600',
    fontSize: 13,
  },

  // Card styles
  cardContainer: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  card: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },
  cardBody: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    marginBottom: 16,
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  laterButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  laterButtonText: {
    color: '#666',
    fontSize: 14,
  },
  installButton: {
    backgroundColor: '#667EEA',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  installButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },

  // Changelog styles
  changelog: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  changelogTitle: {
    fontWeight: '600',
    fontSize: 13,
    marginBottom: 4,
  },
  changelogText: {
    fontSize: 13,
    color: '#666',
  },

  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 30,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 16,
    marginBottom: 12,
    textAlign: 'center',
  },
  modalBody: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  progressContainer: {
    width: '100%',
    marginVertical: 16,
  },
  progressText: {
    fontSize: 13,
    color: '#666',
    marginBottom: 8,
    textAlign: 'center',
  },
  progressBar: {
    height: 8,
    backgroundColor: '#e0e0e0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#667EEA',
    borderRadius: 4,
  },
  updateButton: {
    backgroundColor: '#667EEA',
    paddingVertical: 14,
    paddingHorizontal: 30,
    borderRadius: 10,
    width: '100%',
    marginTop: 20,
  },
  updateButtonDisabled: {
    backgroundColor: '#999',
  },
  updateButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
  },
});
