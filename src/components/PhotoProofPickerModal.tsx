import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Check, Image as ImageIcon, Images, WifiOff, X } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  loadPhotoProofs,
  uploadGalleryPhotoProof,
  type PhotoProofItem,
} from '../services/photoProof';
import { getDirectProofImageUrl } from './EsarfDetailsView';
import { platformAlert } from '../utils/platformAlert';
import { colors, fontWeights, radius } from '../theme';

export type SelectedProofAttachment = {
  uri: string;
  source: 'photo_proof' | 'gallery' | 'camera';
  name?: string;
  timestamp?: string;
  locationText?: string;
  driveWebViewLink?: string | null;
  photoProofId?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  selectedProofs: SelectedProofAttachment[];
  onSelectProofs: (proofs: SelectedProofAttachment[]) => void;
  userInfo?: {
    resolvedEmpId?: string | null;
    resolvedName?: string | null;
    resolvedEmail?: string | null;
    resolvedStore?: string | null;
    resolvedAuthId?: string | null;
  };
  title?: string;
  subtitle?: string;
  maxSlots?: number;
};

export function PhotoProofPickerModal({
  visible,
  onClose,
  selectedProofs,
  onSelectProofs,
  userInfo,
  title = 'Attach up to 3 Photo Proofs',
  subtitle,
  maxSlots = 3,
}: Props) {
  const insets = useSafeAreaInsets();
  const [photoProofsList, setPhotoProofsList] = useState<PhotoProofItem[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);
  const [galleryStatus, setGalleryStatus] = useState('');

  const attachedCount = selectedProofs.length;
  const remainingSlots = Math.max(0, maxSlots - attachedCount);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setIsLoadingList(true);

    loadPhotoProofs({
      employeeId: userInfo?.resolvedEmpId || undefined,
      employeeName: userInfo?.resolvedName || undefined,
      userEmail: userInfo?.resolvedEmail || undefined,
      authUserId: userInfo?.resolvedAuthId || undefined,
    })
      .then((items) => {
        if (active) {
          setPhotoProofsList(items);
        }
      })
      .catch((err) => {
        console.warn('[PhotoProofPicker] Failed to load photo proofs:', err);
      })
      .finally(() => {
        if (active) setIsLoadingList(false);
      });

    return () => {
      active = false;
    };
  }, [visible, userInfo?.resolvedEmpId, userInfo?.resolvedName, userInfo?.resolvedEmail, userInfo?.resolvedAuthId]);

  const pickFromGallery = async () => {
    try {
      if (remainingSlots <= 0) {
        platformAlert('Limit Reached', `You have already attached ${maxSlots} photos. Remove one to upload another.`);
        return;
      }

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        platformAlert('Permission Needed', 'Please allow access to your photo library to upload a picture proof.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        allowsEditing: false,
        base64: true,
        allowsMultipleSelection: true,
        selectionLimit: remainingSlots,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      setIsUploadingGallery(true);
      const assetsToUpload = result.assets.slice(0, remainingSlots);
      const newAttachments: SelectedProofAttachment[] = [];
      let anySyncFailed = false;

      for (let i = 0; i < assetsToUpload.length; i++) {
        const asset = assetsToUpload[i];
        setGalleryStatus(
          assetsToUpload.length > 1
            ? `Uploading photo proof ${i + 1} of ${assetsToUpload.length}...`
            : 'Uploading photo proof to Google Drive & database...',
        );

        const { item: savedItem, cloudSyncSucceeded } = await uploadGalleryPhotoProof({
          uri: asset.uri,
          base64: asset.base64,
          width: asset.width,
          height: asset.height,
          employeeId: userInfo?.resolvedEmpId || null,
          employeeName: userInfo?.resolvedName || 'Employee',
          userEmail: userInfo?.resolvedEmail || null,
          storeName: userInfo?.resolvedStore || null,
        });

        if (!cloudSyncSucceeded) {
          anySyncFailed = true;
        }

        newAttachments.push({
          uri: savedItem.photoUri,
          source: 'gallery',
          name: asset.fileName || `Gallery Photo ${attachedCount + i + 1}`,
          driveWebViewLink: savedItem.driveWebViewLink || null,
          photoProofId: savedItem.id,
        });

        setPhotoProofsList((prev) => [savedItem, ...prev.filter((p) => p.id !== savedItem.id)]);
      }

      const updated = [...selectedProofs, ...newAttachments].slice(0, maxSlots);
      onSelectProofs(updated);

      if (anySyncFailed) {
        platformAlert(
          'Saved Locally',
          'Photo proof was saved on this device. Cloud sync to Google Drive will finalize when you submit or connect online.',
        );
      }
    } catch (err) {
      console.warn('[PhotoProofPicker] Error picking image:', err);
      platformAlert('Upload Error', 'Failed to pick image from gallery. Please try again.');
    } finally {
      setIsUploadingGallery(false);
      setGalleryStatus('');
    }
  };

  const togglePhotoProofItem = (item: PhotoProofItem) => {
    const isSelected = selectedProofs.some(
      (p) => (p.photoProofId && p.photoProofId === item.id) || p.uri === item.photoUri,
    );

    if (isSelected) {
      // Deselect
      const next = selectedProofs.filter(
        (p) => !((p.photoProofId && p.photoProofId === item.id) || p.uri === item.photoUri),
      );
      onSelectProofs(next);
    } else {
      // Select
      if (selectedProofs.length >= maxSlots) {
        platformAlert('Limit Reached', `You can select up to ${maxSlots} photo proofs.`);
        return;
      }
      const isGallery = item.source === 'gallery' || (!item.timeDigits && !item.locationText);
      const newItem: SelectedProofAttachment = {
        uri: item.photoUri,
        source: isGallery ? 'gallery' : (item.source || 'photo_proof'),
        name: isGallery
          ? (item.dateFormatted ? `Gallery Photo • ${item.dateFormatted}` : 'Gallery Photo')
          : (item.timeDigits ? `${item.dateFormatted} • ${item.timeDigits} ${item.timePeriod}` : 'Photo Proof Log'),
        timestamp: isGallery ? undefined : item.timestamp,
        locationText: isGallery ? undefined : item.locationText,
        driveWebViewLink: item.driveWebViewLink || null,
        photoProofId: item.id,
      };
      onSelectProofs([...selectedProofs, newItem]);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.modalTitle}>{title}</Text>
              <Text style={styles.modalSubtitle}>
                {subtitle || (attachedCount > 0 ? `${attachedCount}/${maxSlots} attached • 1 required` : `Select up to ${maxSlots} photo proof(s)`)}
              </Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <X size={20} color="#0f172a" strokeWidth={2.4} />
            </Pressable>
          </View>

          {isUploadingGallery ? (
            <View style={styles.uploadLoadingContainer}>
              <ActivityIndicator size="large" color="#2563eb" />
              <Text style={styles.uploadLoadingTitle}>Uploading Photo Proof</Text>
              <Text style={styles.uploadLoadingDesc}>
                {galleryStatus || 'Uploading to Google Drive & saving...'}
              </Text>
            </View>
          ) : (
            <>
              <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
                {/* Upload from Gallery button */}
                <Text style={styles.sectionHeading}>Upload Pictures From Gallery</Text>
                <Pressable
                  style={({ pressed }) => [
                    styles.quickCard,
                    pressed && styles.quickCardPressed,
                    remainingSlots === 0 && { opacity: 0.5 },
                  ]}
                  onPress={pickFromGallery}
                >
                  <View style={[styles.quickIconWrap, { backgroundColor: '#eff6ff' }]}>
                    <ImageIcon size={22} color="#2563eb" strokeWidth={2.2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.quickTitle}>
                      Upload from Gallery {remainingSlots > 0 ? `(${remainingSlots} remaining)` : `(Max ${maxSlots} reached)`}
                    </Text>
                    <Text style={styles.quickDesc}>
                      {remainingSlots > 0 ? `Select up to ${remainingSlots} photo(s) from device gallery` : `${maxSlots} of ${maxSlots} photos selected`}
                    </Text>
                  </View>
                </Pressable>

                {/* Divider */}
                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>OR CHOOSE FROM PHOTO PROOFS LOG</Text>
                  <View style={styles.dividerLine} />
                </View>

                {/* Photo proofs list */}
                {isLoadingList ? (
                  <View style={styles.loadingWrap}>
                    <ActivityIndicator size="small" color="#2563eb" style={{ marginBottom: 8 }} />
                    <Text style={styles.loadingText}>Loading your photo proofs...</Text>
                  </View>
                ) : photoProofsList.length === 0 ? (
                  <View style={styles.emptyWrap}>
                    <Images size={38} color="#94a3b8" strokeWidth={1.6} />
                    <Text style={styles.emptyTitle}>No Photo Proofs Found</Text>
                    <Text style={styles.emptyText}>
                      You haven't captured any photo proofs in your Photo Log yet. Use the Gallery option above.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.itemsList}>
                    {photoProofsList.map((item) => {
                      const isSelected = selectedProofs.some(
                        (p) => (p.photoProofId && p.photoProofId === item.id) || p.uri === item.photoUri,
                      );
                      return (
                        <Pressable
                          key={item.id}
                          style={({ pressed }) => [
                            styles.itemCard,
                            isSelected && styles.itemCardSelected,
                            pressed && styles.itemCardPressed,
                          ]}
                          onPress={() => togglePhotoProofItem(item)}
                        >
                          {Platform.OS === 'web' ? (
                            React.createElement('img', {
                              src: getDirectProofImageUrl(item.photoUri),
                              referrerPolicy: 'no-referrer',
                              style: { width: 48, height: 48, borderRadius: 8, objectFit: 'cover' },
                            })
                          ) : (
                            <Image
                              source={{ uri: getDirectProofImageUrl(item.photoUri) }}
                              style={styles.itemThumb}
                              resizeMode="cover"
                            />
                          )}
                          <View style={styles.itemInfo}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <Text style={styles.itemTime}>
                                {item.source === 'gallery' || (!item.timeDigits && !item.locationText)
                                  ? (item.dateFormatted ? `Gallery Photo • ${item.dateFormatted}` : 'Gallery Photo')
                                  : `${item.dateFormatted} • ${item.timeDigits} ${item.timePeriod}`}
                              </Text>
                              {!item.syncedToCloud && !item.driveFileId ? (
                                <View style={styles.offlineBadge}>
                                  <WifiOff size={9} color="#92400e" strokeWidth={2.4} />
                                  <Text style={styles.offlineBadgeText}>OFFLINE</Text>
                                </View>
                              ) : null}
                            </View>
                            {item.source !== 'gallery' && item.locationText ? (
                              <Text style={styles.itemLocation} numberOfLines={2}>
                                {item.locationText}
                              </Text>
                            ) : null}
                          </View>
                          <View style={[styles.itemSelectBtn, isSelected && styles.itemSelectBtnSelected]}>
                            <Check size={16} color={isSelected ? '#ffffff' : '#2563eb'} strokeWidth={isSelected ? 3 : 2.4} />
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </ScrollView>

              <View style={[styles.bottomBar, { paddingBottom: Math.max(16, insets.bottom + 10) }]}>
                <Pressable style={styles.doneBtn} onPress={onClose}>
                  <Check size={16} color="#ffffff" strokeWidth={2.4} />
                  <Text style={styles.doneBtnText}>
                    {attachedCount > 0 ? `Done (${attachedCount}/${maxSlots} Selected)` : 'Done'}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    flexDirection: 'column',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  modalSubtitle: {
    fontSize: 12.5,
    color: '#64748b',
    marginTop: 2,
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 24,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  quickCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: '#f8fafc',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  quickCardPressed: {
    opacity: 0.8,
  },
  quickIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTitle: {
    fontSize: 13.5,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  quickDesc: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 18,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#e2e8f0',
  },
  dividerText: {
    fontSize: 10.5,
    fontWeight: fontWeights.bold,
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  loadingWrap: {
    paddingVertical: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
  },
  emptyWrap: {
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
    marginTop: 8,
  },
  emptyText: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    maxWidth: 260,
    marginTop: 4,
  },
  itemsList: {
    gap: 8,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  itemCardSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#eff6ff',
  },
  itemCardPressed: {
    opacity: 0.85,
  },
  itemThumb: {
    width: 48,
    height: 48,
    borderRadius: 8,
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
  },
  itemTime: {
    fontSize: 12.5,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  itemLocation: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
  },
  offlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#fef3c7',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  offlineBadgeText: {
    fontSize: 9,
    fontWeight: fontWeights.bold,
    color: '#92400e',
  },
  itemSelectBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  itemSelectBtnSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  bottomBar: {
    paddingHorizontal: 18,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    backgroundColor: '#ffffff',
  },
  doneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    backgroundColor: '#2563eb',
    borderRadius: radius.md,
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
  uploadLoadingContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uploadLoadingTitle: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
    marginTop: 12,
  },
  uploadLoadingDesc: {
    fontSize: 12.5,
    color: '#64748b',
    marginTop: 4,
  },
});
