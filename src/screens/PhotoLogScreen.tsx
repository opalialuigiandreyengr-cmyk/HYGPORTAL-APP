import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Calendar,
  Camera,
  ChevronLeft,
  Clock,
  ExternalLink,
  Eye,
  MapPin,
  Plus,
  Trash2,
  X,
} from 'lucide-react-native';
import { fontWeights, radius, spacing } from '../theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  deletePhotoProof,
  loadPhotoProofs,
  type PhotoProofItem,
} from '../services/photoProof';

type Props = {
  onBack: () => void;
  onTakeNew: () => void;
  employeeId?: string | null;
  employeeName?: string | null;
  userEmail?: string | null;
};

export function PhotoLogScreen({ onBack, onTakeNew, employeeId, employeeName, userEmail }: Props) {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<PhotoProofItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoProofItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<PhotoProofItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const items = await loadPhotoProofs({ employeeId, employeeName, userEmail });
      setLogs(items);
    } catch (err) {
      console.error('Error loading photo logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchLogs();
  }, [employeeId, employeeName, userEmail]);

  const handleDelete = (item: PhotoProofItem) => {
    setItemToDelete(item);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;
    setIsDeleting(true);
    try {
      await deletePhotoProof(itemToDelete);
      setLogs((prev) => prev.filter((p) => p.id !== itemToDelete.id));
      if (selectedPhoto?.id === itemToDelete.id) {
        setSelectedPhoto(null);
      }
      setItemToDelete(null);
    } catch (err: any) {
      console.error('Failed to delete photo proof:', err);
      Alert.alert('Delete Failed', `Could not delete photo proof: ${err?.message || err}`);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: Platform.OS === 'web' ? 14 : Math.max(insets.top + (Platform.OS === 'android' ? 8 : 0), 14),
          },
        ]}
      >
        <Pressable style={styles.headerIconButton} onPress={onBack} hitSlop={12}>
          <ChevronLeft size={28} color="#0f172a" strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle}>Photo Log</Text>
        <Pressable style={styles.takeNewButton} onPress={onTakeNew} hitSlop={8}>
          <Camera size={18} color="#ffffff" strokeWidth={2.4} />
          <Text style={styles.takeNewText}>New</Text>
        </Pressable>
      </View>

      {/* Content */}
      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#f5af00" />
          <Text style={styles.loadingText}>Loading photo logs...</Text>
        </View>
      ) : logs.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <Camera size={36} color="#94a3b8" strokeWidth={2} />
          </View>
          <Text style={styles.emptyTitle}>No Photo Proofs Logged</Text>
          <Text style={styles.emptySubtitle}>
            Capture real-time events or store surroundings with live timestamp, date, and geolocation
            stamping.
          </Text>
          <Pressable style={styles.emptyActionButton} onPress={onTakeNew}>
            <Plus size={20} color="#0f172a" strokeWidth={2.5} />
            <Text style={styles.emptyActionText}>Take Photo Proof</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={logs}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingBottom: Math.max(insets.bottom + 24, 40),
            },
          ]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <View style={styles.logCard}>
              {/* Image with overlay */}
              <Pressable
                style={styles.imageWrapper}
                onPress={() => setSelectedPhoto(item)}
              >
                {item.photoUri ? (
                  <Image source={{ uri: item.photoUri }} style={styles.logImage} resizeMode="cover" />
                ) : (
                  <View style={styles.imagePlaceholder}>
                    <Camera size={34} color="#94a3b8" strokeWidth={1.8} />
                    <Text style={styles.imagePlaceholderText}>
                      {item.driveWebViewLink ? 'Stored in Google Drive' : 'Syncing photo...'}
                    </Text>
                  </View>
                )}
                <View style={styles.imageOverlayGradient}>
                  <View style={styles.overlayTimeRow}>
                    <Text style={styles.overlayTimeText}>
                      {item.timeDigits}
                      <Text style={styles.overlayTimePeriod}> {item.timePeriod}</Text>
                    </Text>
                    <View style={styles.overlayDivider} />
                    <View>
                      <Text style={styles.overlayDateText}>{item.dateFormatted}</Text>
                      <Text style={styles.overlayDayText}>{item.dayFormatted}</Text>
                    </View>
                  </View>
                  <Text style={styles.overlayLocationText} numberOfLines={2}>
                    {item.locationText}
                  </Text>
                </View>
                <View style={styles.expandBadge}>
                  <Eye size={16} color="#ffffff" strokeWidth={2.4} />
                </View>
              </Pressable>

              {/* Card Meta Details & Actions */}
              <View style={styles.cardDetails}>
                <View style={styles.metaRow}>
                  <MapPin size={15} color="#64748b" strokeWidth={2.2} />
                  <Text style={styles.metaLocationText} numberOfLines={4}>
                    {item.locationText}
                  </Text>
                </View>

                <View style={styles.cardBottomRow}>
                  <View style={styles.metaInfoGroup}>
                    <View style={styles.metaChip}>
                      <Clock size={13} color="#0284c7" strokeWidth={2.2} />
                      <Text style={styles.metaChipText}>
                        {item.timeDigits} {item.timePeriod}
                      </Text>
                    </View>
                    <View style={styles.metaChip}>
                      <Calendar size={13} color="#059669" strokeWidth={2.2} />
                      <Text style={styles.metaChipText}>{item.dateFormatted}</Text>
                    </View>
                  </View>

                  <Pressable
                    style={styles.deleteButton}
                    onPress={() => handleDelete(item)}
                    hitSlop={10}
                  >
                    <Trash2 size={18} color="#ef4444" strokeWidth={2.2} />
                  </Pressable>
                </View>
              </View>
            </View>
          )}
        />
      )}

      {/* Full Photo Modal Viewer */}
      <Modal
        visible={Boolean(selectedPhoto)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
      >
        <View style={styles.viewerModalOverlay}>
          <View
            style={[
              styles.viewerTopBar,
              {
                top: Platform.OS === 'web' ? 20 : Math.max(insets.top + (Platform.OS === 'android' ? 10 : 0), 20),
              },
            ]}
          >
            {selectedPhoto && (
              <Pressable
                style={styles.viewerTrashBtn}
                onPress={() => setItemToDelete(selectedPhoto)}
                hitSlop={12}
              >
                <Trash2 size={20} color="#ffffff" strokeWidth={2.2} />
              </Pressable>
            )}
            <Pressable
              style={styles.viewerCloseButton}
              onPress={() => setSelectedPhoto(null)}
              hitSlop={12}
            >
              <X size={24} color="#ffffff" strokeWidth={2.5} />
            </Pressable>
          </View>

          {selectedPhoto && (
            <View style={styles.viewerContent}>
              {selectedPhoto.photoUri ? (
                <Image
                  source={{ uri: selectedPhoto.photoUri }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={[styles.viewerImage, styles.viewerPlaceholder]}>
                  <Camera size={52} color="#94a3b8" strokeWidth={1.8} />
                  <Text style={styles.viewerPlaceholderText}>Full image stored in Google Drive</Text>
                  {selectedPhoto.driveWebViewLink ? (
                    <Pressable
                      style={styles.driveLinkBtn}
                      onPress={() => Linking.openURL(selectedPhoto.driveWebViewLink!)}
                    >
                      <ExternalLink size={16} color="#ffffff" strokeWidth={2.2} />
                      <Text style={styles.driveLinkText}>Open in Google Drive</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
              <View style={styles.viewerWatermark}>
                <View style={styles.overlayTimeRow}>
                  <Text style={styles.viewerTimeText}>
                    {selectedPhoto.timeDigits}
                    <Text style={styles.overlayTimePeriod}> {selectedPhoto.timePeriod}</Text>
                  </Text>
                  <View style={styles.overlayDivider} />
                  <View>
                    <Text style={styles.viewerDateText}>{selectedPhoto.dateFormatted}</Text>
                    <Text style={styles.viewerDayText}>{selectedPhoto.dayFormatted}</Text>
                  </View>
                </View>
                <Text style={styles.viewerLocationText}>{selectedPhoto.locationText}</Text>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={Boolean(itemToDelete)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!isDeleting) setItemToDelete(null);
        }}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconCircle}>
              <Trash2 size={28} color="#ef4444" strokeWidth={2.2} />
            </View>
            <Text style={styles.confirmTitle}>Delete Photo Proof?</Text>
            <Text style={styles.confirmMessage}>
              Are you sure you want to permanently delete this photo proof recorded at{' '}
              <Text style={{ fontWeight: fontWeights.bold, color: '#0f172a' }}>
                {itemToDelete?.timeDigits} {itemToDelete?.timePeriod}
              </Text>
              {itemToDelete?.dateFormatted ? ` on ${itemToDelete.dateFormatted}` : ''}?
              {'\n\n'}
              This will remove the photo record from your device and the cloud log.
            </Text>

            <View style={styles.confirmActionsRow}>
              <Pressable
                style={[styles.confirmCancelBtn, isDeleting ? { opacity: 0.6 } : null]}
                onPress={() => setItemToDelete(null)}
                disabled={isDeleting}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmDeleteBtn, isDeleting ? { opacity: 0.7 } : null]}
                onPress={confirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Trash2 size={16} color="#ffffff" strokeWidth={2.2} />
                    <Text style={styles.confirmDeleteText}>Delete</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: Platform.OS === 'ios' ? 44 : 14,
    paddingBottom: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    zIndex: 10,
  },
  headerIconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  headerTitle: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  takeNewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.md,
    backgroundColor: '#0f172a',
  },
  takeNewText: {
    fontSize: 13,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  loadingText: {
    fontSize: 14,
    color: '#64748b',
    fontWeight: fontWeights.medium,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  emptyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#f5af00',
  },
  emptyActionText: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: 40,
    gap: spacing.md,
  },
  logCard: {
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  imageWrapper: {
    width: '100%',
    height: 240,
    position: 'relative',
    backgroundColor: '#0f172a',
  },
  imagePlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
    padding: 20,
    gap: 8,
  },
  imagePlaceholderText: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: fontWeights.medium,
    textAlign: 'center',
  },
  viewerPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  viewerPlaceholderText: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: fontWeights.medium,
  },
  driveLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: '#0284c7',
  },
  driveLinkText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
  logImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlayGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 14,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  overlayTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  overlayTimeText: {
    fontSize: 24,
    fontWeight: '300',
    color: '#ffffff',
  },
  overlayTimePeriod: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: '#facc15',
  },
  overlayDivider: {
    width: 2,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
  },
  overlayDateText: {
    fontSize: 13,
    fontWeight: fontWeights.semibold,
    color: '#ffffff',
  },
  overlayDayText: {
    fontSize: 11,
    fontWeight: fontWeights.medium,
    color: '#ffffff',
  },
  overlayLocationText: {
    fontSize: 12,
    fontWeight: fontWeights.medium,
    color: '#f1f5f9',
    marginTop: 2,
  },
  expandBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardDetails: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  metaLocationText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
    color: '#334155',
    fontWeight: fontWeights.medium,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  metaInfoGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#f8fafc',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  metaChipText: {
    fontSize: 11,
    fontWeight: fontWeights.semibold,
    color: '#475569',
  },
  deleteButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerTopBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 48 : 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: 20,
  },
  viewerTrashBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(239, 68, 68, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerCloseButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  confirmIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  confirmTitle: {
    fontSize: 19,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
    marginBottom: 8,
    textAlign: 'center',
  },
  confirmMessage: {
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 24,
  },
  confirmActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  confirmCancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
    color: '#475569',
  },
  confirmDeleteBtn: {
    flex: 1,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: '#ef4444',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  confirmDeleteText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
  viewerContent: {
    width: '100%',
    height: '80%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  viewerImage: {
    width: '100%',
    height: '100%',
  },
  viewerWatermark: {
    position: 'absolute',
    bottom: 24,
    left: 24,
    right: 24,
  },
  viewerTimeText: {
    fontSize: 36,
    fontWeight: '300',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  viewerDateText: {
    fontSize: 16,
    fontWeight: fontWeights.semibold,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  viewerDayText: {
    fontSize: 14,
    fontWeight: fontWeights.medium,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.8)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  viewerLocationText: {
    fontSize: 15,
    fontWeight: fontWeights.medium,
    color: '#ffffff',
    marginTop: 4,
    textShadowColor: 'rgba(0, 0, 0, 0.9)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
});
