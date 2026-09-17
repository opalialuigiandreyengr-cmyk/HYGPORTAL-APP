import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Calendar,
  Camera,
  Check,
  ChevronLeft,
  Clock,
  Download,
  ExternalLink,
  Eye,
  MapPin,
  Plus,
  Share2,
  Trash2,
  X,
} from 'lucide-react-native';
import Svg, {
  Image as SvgImage,
  Text as SvgText,
  TSpan,
  Line as SvgLine,
  Rect as SvgRect,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';
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

function wrapLocationText(text: string, maxCharsPerLine = 38): string[] {
  const words = (text || '').split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (test.length > maxCharsPerLine && cur) {
      lines.push(cur.trim());
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur.trim());
  return lines.slice(0, 4);
}

function isPhotoWatermarked(item?: PhotoProofItem | null): boolean {
  if (!item) return false;
  // Strictly applies to web/PWA where photos are captured onto the canvas with burned-in text.
  // On native Android/iOS, camera captures raw photos and relies on the native overlays and SVG compositor.
  return Platform.OS === 'web';
}

async function createWatermarkedImageWeb(
  photoUri: string,
  data: PhotoProofItem
): Promise<string> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !photoUri) {
      return resolve(photoUri);
    }
    const img = new (window as any).Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const w = img.naturalWidth || img.width || 1080;
        const h = img.naturalHeight || img.height || 1920;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(photoUri);

        ctx.drawImage(img, 0, 0, w, h);

        const scale = Math.max(1, w / 400);
        const padX = Math.round(20 * scale);
        const btmY = h - Math.round(24 * scale);

        const gradH = Math.round(h * 0.35);
        const grad = ctx.createLinearGradient(0, h - gradH, 0, h);
        grad.addColorStop(0, 'rgba(0,0,0,0)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0.25)');
        grad.addColorStop(1, 'rgba(0,0,0,0.75)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, h - gradH, w, gradH);

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = Math.round(4 * scale);
        ctx.shadowOffsetX = 1 * scale;
        ctx.shadowOffsetY = 1 * scale;

        const locFontSize = Math.round(15 * scale);
        const locLineHeight = Math.round(19 * scale);
        ctx.font = `500 ${locFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = '#ffffff';

        const lines = wrapLocationText(data.locationText || '', Math.floor((w - padX * 2) / (locFontSize * 0.55)));
        let curY = btmY;
        for (let i = lines.length - 1; i >= 0; i--) {
          ctx.fillText(lines[i], padX, curY);
          curY -= locLineHeight;
        }

        curY -= Math.round(8 * scale);
        const timeFontSize = Math.round(42 * scale);
        const periodFontSize = Math.round(22 * scale);
        const dateFontSize = Math.round(16 * scale);
        const dayFontSize = Math.round(14 * scale);

        ctx.font = `300 ${timeFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = '#ffffff';
        const timeDigits = data.timeDigits || '';
        ctx.fillText(timeDigits, padX, curY);
        const timeWidth = ctx.measureText(timeDigits).width;

        ctx.font = `bold ${periodFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = '#facc15';
        const periodX = padX + timeWidth + Math.round(4 * scale);
        ctx.fillText(data.timePeriod || '', periodX, curY);
        const periodWidth = ctx.measureText(data.timePeriod || '').width;

        const divX = periodX + periodWidth + Math.round(10 * scale);
        const divTop = curY - Math.round(34 * scale);
        const divBottom = curY + Math.round(4 * scale);
        ctx.restore();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = Math.max(2, Math.round(2 * scale));
        ctx.beginPath();
        ctx.moveTo(divX, divTop);
        ctx.lineTo(divX, divBottom);
        ctx.stroke();

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
        ctx.shadowBlur = Math.round(3 * scale);
        ctx.shadowOffsetX = 1 * scale;
        ctx.shadowOffsetY = 1 * scale;

        const dateX = divX + Math.round(10 * scale);
        ctx.font = `600 ${dateFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(data.dateFormatted || '', dateX, curY - Math.round(16 * scale));

        ctx.font = `500 ${dayFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
        ctx.fillText(data.dayFormatted || '', dateX, curY + Math.round(2 * scale));
        ctx.restore();

        resolve(canvas.toDataURL('image/jpeg', 0.92));
      } catch (err) {
        console.warn('createWatermarkedImageWeb error:', err);
        resolve(photoUri);
      }
    };
    img.onerror = () => resolve(photoUri);
    img.src = photoUri;
  });
}

export function PhotoLogScreen({ onBack, onTakeNew, employeeId, employeeName, userEmail }: Props) {
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<PhotoProofItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoProofItem | null>(null);
  const [itemToDelete, setItemToDelete] = useState<PhotoProofItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [viewfinderSize, setViewfinderSize] = useState({ width: 0, height: 0 });
  const svgWatermarkRef = useRef<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  const [toastMessage, setToastMessage] = useState<{
    title: string;
    subtitle: string;
    type?: 'success' | 'share' | 'info';
  } | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedbackToast = (
    title: string,
    subtitle: string,
    type: 'success' | 'share' | 'info' = 'success'
  ) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToastMessage({ title, subtitle, type });
    Animated.spring(toastAnim, {
      toValue: 1,
      useNativeDriver: Platform.OS !== 'web',
      tension: 85,
      friction: 8,
    }).start();

    toastTimerRef.current = setTimeout(() => {
      Animated.timing(toastAnim, {
        toValue: 0,
        duration: 260,
        useNativeDriver: Platform.OS !== 'web',
      }).start(() => {
        setToastMessage(null);
      });
    }, 2400);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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

  const handleSaveToPhone = async () => {
    if (!selectedPhoto || isSaving) return;
    setIsSaving(true);
    try {
      if (Platform.OS === 'web') {
        if (!selectedPhoto.photoUri) {
          if (selectedPhoto.driveWebViewLink) {
            await Linking.openURL(selectedPhoto.driveWebViewLink);
          } else {
            Alert.alert('Notice', 'Photo image is still syncing to Google Drive.');
          }
          return;
        }

        const safeDate = (selectedPhoto.dateFormatted || 'proof').replace(/[^a-zA-Z0-9]/g, '_');
        const safeTime = (selectedPhoto.timeDigits || '').replace(':', '');
        const filename = `photo_proof_${safeDate}_${safeTime}.jpg`;

        try {
          // If the photo already has the watermark burned in (all web captures do), download directly without re-burning
          const alreadyWatermarked = isPhotoWatermarked(selectedPhoto);
          const downloadUri = alreadyWatermarked
            ? selectedPhoto.photoUri
            : await createWatermarkedImageWeb(selectedPhoto.photoUri, selectedPhoto);
          const response = await fetch(downloadUri);
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
          }, 1500);
          showFeedbackToast('Saved to Downloads!', 'Photo proof with full details downloaded.', 'success');
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 2400);
        } catch {
          // Fallback
          const a = document.createElement('a');
          a.href = selectedPhoto.photoUri;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => {
            document.body.removeChild(a);
          }, 1000);
          showFeedbackToast('Download Started', 'Photo proof download initiated.', 'success');
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 2400);
        }
        return;
      }

      if (Platform.OS === 'android') {
        // Native Android: first attempt to snapshot watermarked SVG with details
        let base64Data = '';
        if (svgWatermarkRef.current && typeof svgWatermarkRef.current.toDataURL === 'function') {
          try {
            base64Data = await new Promise<string>((resolve) => {
              svgWatermarkRef.current.toDataURL((data: string) => {
                resolve(data || '');
              });
            });
          } catch (svgErr) {
            console.warn('SVG watermark snapshot failed:', svgErr);
          }
        }

        // Fallback to raw photo bytes if SVG snapshot was not available
        if (!base64Data) {
          if (selectedPhoto.photoUri?.startsWith('data:image')) {
            base64Data = selectedPhoto.photoUri.includes(',')
              ? selectedPhoto.photoUri.split(',')[1]
              : selectedPhoto.photoUri;
          } else if (
            selectedPhoto.photoUri?.startsWith('http://') ||
            selectedPhoto.photoUri?.startsWith('https://')
          ) {
            const tempPath = `${FileSystem.cacheDirectory}temp_save_${Date.now()}.jpg`;
            const dlRes = await FileSystem.downloadAsync(selectedPhoto.photoUri, tempPath);
            base64Data = await FileSystem.readAsStringAsync(dlRes.uri, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await FileSystem.deleteAsync(tempPath, { idempotent: true });
          } else if (selectedPhoto.photoUri) {
            base64Data = await FileSystem.readAsStringAsync(selectedPhoto.photoUri, {
              encoding: FileSystem.EncodingType.Base64,
            });
          }
        }

        if (!base64Data) {
          if (selectedPhoto.driveWebViewLink) {
            await Linking.openURL(selectedPhoto.driveWebViewLink);
            return;
          }
          Alert.alert('Notice', 'No photo image data available to save.');
          return;
        }

        const safeDate = (selectedPhoto.dateFormatted || 'proof').replace(/[^a-zA-Z0-9]/g, '_');
        const safeTime = (selectedPhoto.timeDigits || '').replace(':', '');
        const fileName = `photo_proof_${safeDate}_${safeTime}_${Date.now()}`;

        const STORAGE_KEY = '@hyg_photo_save_dir_uri';
        let dirUri = await AsyncStorage.getItem(STORAGE_KEY);
        let createdUri: string | null = null;

        if (dirUri) {
          try {
            createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
              dirUri,
              fileName,
              'image/jpeg'
            );
          } catch {
            dirUri = null;
            await AsyncStorage.removeItem(STORAGE_KEY);
          }
        }

        if (!createdUri) {
          const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
          if (!permissions.granted) {
            return; // User cancelled
          }
          dirUri = permissions.directoryUri;
          await AsyncStorage.setItem(STORAGE_KEY, dirUri);
          createdUri = await FileSystem.StorageAccessFramework.createFileAsync(
            dirUri,
            fileName,
            'image/jpeg'
          );
        }

        await FileSystem.writeAsStringAsync(createdUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });

        showFeedbackToast('Saved to Phone!', 'Photo proof with verified details saved.', 'success');
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2400);
        return;
      }

      // iOS Native
      let fileUri = selectedPhoto.photoUri;
      if (fileUri && fileUri.startsWith('data:image')) {
        const filename = `photo_proof_${Date.now()}.jpg`;
        const targetPath = `${FileSystem.cacheDirectory}${filename}`;
        const base64Data = fileUri.includes(',') ? fileUri.split(',')[1] : fileUri;
        await FileSystem.writeAsStringAsync(targetPath, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
        fileUri = targetPath;
      } else if (fileUri && (fileUri.startsWith('http://') || fileUri.startsWith('https://'))) {
        const filename = `photo_proof_${Date.now()}.jpg`;
        const targetPath = `${FileSystem.cacheDirectory}${filename}`;
        const dlRes = await FileSystem.downloadAsync(fileUri, targetPath);
        fileUri = dlRes.uri;
      }

      if (!fileUri) {
        if (selectedPhoto.driveWebViewLink) {
          await Linking.openURL(selectedPhoto.driveWebViewLink);
          return;
        }
        Alert.alert('Error', 'No photo file available to save.');
        return;
      }

      // On iOS Native, Sharing dialog provides the official "Save Image" action to write directly to Camera Roll
      showFeedbackToast('Ready to Save', 'Select "Save Image" to store in Photos.', 'success');
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2400);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'image/jpeg',
          dialogTitle: 'Save to Photos',
          UTI: 'public.jpeg',
        });
      } else {
        Alert.alert('Saved', 'Photo proof is saved in your device cache.');
      }
    } catch (err: any) {
      console.error('Failed to save photo:', err);
      Alert.alert('Save Error', `Could not save photo: ${err?.message || err}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSharePhoto = async () => {
    if (!selectedPhoto || isSharing) return;
    setIsSharing(true);
    showFeedbackToast('Preparing to Share', 'Generating photo with verified details...', 'share');
    try {
      const shareMessage = `Photo Proof Record\nDate & Time: ${selectedPhoto.dateFormatted}, ${selectedPhoto.timeDigits} ${selectedPhoto.timePeriod}\nLocation: ${selectedPhoto.locationText}${selectedPhoto.driveWebViewLink ? `\nLink: ${selectedPhoto.driveWebViewLink}` : ''}`;

      if (Platform.OS === 'web') {
        if (typeof navigator !== 'undefined' && (navigator as any).share) {
          try {
            await (navigator as any).share({
              title: 'Photo Proof',
              text: shareMessage,
              url: selectedPhoto.driveWebViewLink || undefined,
            });
            setShareSuccess(true);
            setTimeout(() => setShareSuccess(false), 2400);
            showFeedbackToast('Photo Shared', 'Share menu action completed.', 'share');
            return;
          } catch (shareErr: any) {
            if (shareErr?.name === 'AbortError') return;
          }
        }
        if (selectedPhoto.driveWebViewLink) {
          await Linking.openURL(selectedPhoto.driveWebViewLink);
          setShareSuccess(true);
          setTimeout(() => setShareSuccess(false), 2400);
          showFeedbackToast('Drive Link Opened', 'Opening Google Drive preview to share.', 'share');
        } else {
          Alert.alert('Photo Proof Info', shareMessage);
        }
      } else {
        // Native mobile
        let fileUri = selectedPhoto.photoUri;
        if (Platform.OS === 'android' && svgWatermarkRef.current && typeof svgWatermarkRef.current.toDataURL === 'function') {
          try {
            const base64Watermarked = await new Promise<string>((resolve) => {
              svgWatermarkRef.current.toDataURL((data: string) => {
                resolve(data || '');
              });
            });
            if (base64Watermarked) {
              const filename = `photo_proof_share_${Date.now()}.jpg`;
              const targetPath = `${FileSystem.cacheDirectory}${filename}`;
              await FileSystem.writeAsStringAsync(targetPath, base64Watermarked, {
                encoding: FileSystem.EncodingType.Base64,
              });
              fileUri = targetPath;
            }
          } catch (svgErr) {
            console.warn('SVG snapshot for share failed:', svgErr);
          }
        }

        if (!fileUri || fileUri === selectedPhoto.photoUri) {
          if (fileUri && fileUri.startsWith('data:image')) {
            const filename = `photo_proof_${Date.now()}.jpg`;
            const targetPath = `${FileSystem.cacheDirectory}${filename}`;
            const base64Data = fileUri.includes(',') ? fileUri.split(',')[1] : fileUri;
            await FileSystem.writeAsStringAsync(targetPath, base64Data, {
              encoding: FileSystem.EncodingType.Base64,
            });
            fileUri = targetPath;
          } else if (fileUri && (fileUri.startsWith('http://') || fileUri.startsWith('https://'))) {
            const filename = `photo_proof_share_${Date.now()}.jpg`;
            const targetPath = `${FileSystem.cacheDirectory}${filename}`;
            const dlRes = await FileSystem.downloadAsync(fileUri, targetPath);
            fileUri = dlRes.uri;
          }
        }

        if (fileUri && (await Sharing.isAvailableAsync())) {
          setShareSuccess(true);
          setTimeout(() => setShareSuccess(false), 2400);
          showFeedbackToast('Opening Share Sheet', 'Select an app or contact to share.', 'share');
          await Sharing.shareAsync(fileUri, {
            mimeType: 'image/jpeg',
            dialogTitle: 'Share Photo Proof',
            UTI: 'public.jpeg',
          });
        } else {
          setShareSuccess(true);
          setTimeout(() => setShareSuccess(false), 2400);
          await Share.share({
            title: 'Photo Proof',
            message: shareMessage,
            url: selectedPhoto.driveWebViewLink || undefined,
          });
        }
      }
    } catch (err: any) {
      console.error('Failed to share photo:', err);
      Alert.alert('Share Error', `Could not share photo: ${err?.message || err}`);
    } finally {
      setIsSharing(false);
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
                {/* Details overlay only shown if the photo does not already have a burned watermark */}
                {!isPhotoWatermarked(item) && (
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
                )}
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

      {/* Full Photo Modal Viewer - Exactly matches Photo Proof preview */}
      <Modal
        visible={Boolean(selectedPhoto)}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setSelectedPhoto(null)}
        statusBarTranslucent
      >
        <StatusBar style="dark" />
        <View style={styles.viewerScreenContainer}>
          {/* Header matching PhotoProofScreen */}
          <View
            style={[
              styles.viewerHeader,
              {
                paddingTop: Platform.OS === 'web' ? 14 : Math.max(insets.top + (Platform.OS === 'android' ? 8 : 0), 14),
              },
            ]}
          >
            <Pressable
              style={styles.headerIconButton}
              onPress={() => setSelectedPhoto(null)}
              hitSlop={12}
              accessibilityLabel="Back to Photo Log"
            >
              <ChevronLeft size={28} color="#0f172a" strokeWidth={2.4} />
            </Pressable>
            <Text style={styles.headerTitle}>Photo Proof</Text>
            {selectedPhoto ? (
              <Pressable
                style={styles.headerIconButton}
                onPress={() => setItemToDelete(selectedPhoto)}
                hitSlop={12}
                accessibilityLabel="Delete Photo Proof"
              >
                <Trash2 size={22} color="#ef4444" strokeWidth={2.2} />
              </Pressable>
            ) : (
              <View style={styles.headerIconButton} />
            )}
          </View>

          {/* Viewfinder Media Area matching PhotoProofScreen */}
          {selectedPhoto && (
            <View
              style={styles.viewfinderContainer}
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (width > 0 && height > 0) {
                  setViewfinderSize({ width: Math.round(width), height: Math.round(height) });
                }
              }}
            >
              {selectedPhoto.photoUri ? (
                <Image
                  source={{ uri: selectedPhoto.photoUri }}
                  style={styles.viewfinderMedia}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.viewfinderMedia, styles.viewerPlaceholder]}>
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

              {/* Native Svg Compositor for saving watermarked image on mobile */}
              {Platform.OS !== 'web' && selectedPhoto.photoUri && viewfinderSize.width > 0 && (
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      opacity: 0.01,
                      zIndex: -1,
                      pointerEvents: 'none',
                    },
                  ]}
                >
                  <Svg
                    ref={svgWatermarkRef}
                    width={viewfinderSize.width}
                    height={viewfinderSize.height}
                    viewBox={`0 0 ${viewfinderSize.width} ${viewfinderSize.height}`}
                  >
                    <SvgImage
                      href={{ uri: selectedPhoto.photoUri }}
                      x="0"
                      y="0"
                      width={viewfinderSize.width}
                      height={viewfinderSize.height}
                      preserveAspectRatio="xMidYMid slice"
                    />
                    <Defs>
                      <LinearGradient id="proofVignette" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor="#000000" stopOpacity="0" />
                        <Stop offset="0.5" stopColor="#000000" stopOpacity="0.25" />
                        <Stop offset="1" stopColor="#000000" stopOpacity="0.75" />
                      </LinearGradient>
                    </Defs>
                    <SvgRect
                      x="0"
                      y={viewfinderSize.height * 0.55}
                      width={viewfinderSize.width}
                      height={viewfinderSize.height * 0.45}
                      fill="url(#proofVignette)"
                    />

                    {/* Time & Period */}
                    <SvgText
                      x={20}
                      y={viewfinderSize.height - 24 - (Math.min(4, Math.ceil((selectedPhoto.locationText || '').length / 38)) * 19 + 18)}
                      fill="#ffffff"
                      fontSize={42}
                      fontWeight="300"
                    >
                      {selectedPhoto.timeDigits}
                      <TSpan fill="#facc15" fontSize={22} fontWeight="bold"> {selectedPhoto.timePeriod}</TSpan>
                    </SvgText>

                    {/* Divider */}
                    <SvgLine
                      x1={20 + (selectedPhoto.timeDigits.length * 24 + 48)}
                      y1={viewfinderSize.height - 24 - (Math.min(4, Math.ceil((selectedPhoto.locationText || '').length / 38)) * 19 + 18) - 34}
                      x2={20 + (selectedPhoto.timeDigits.length * 24 + 48)}
                      y2={viewfinderSize.height - 24 - (Math.min(4, Math.ceil((selectedPhoto.locationText || '').length / 38)) * 19 + 18) + 4}
                      stroke="rgba(255, 255, 255, 0.65)"
                      strokeWidth={2}
                    />

                    {/* Date & Day */}
                    <SvgText
                      x={20 + (selectedPhoto.timeDigits.length * 24 + 58)}
                      y={viewfinderSize.height - 24 - (Math.min(4, Math.ceil((selectedPhoto.locationText || '').length / 38)) * 19 + 18) - 16}
                      fill="#ffffff"
                      fontSize={16}
                      fontWeight="600"
                    >
                      {selectedPhoto.dateFormatted}
                    </SvgText>
                    <SvgText
                      x={20 + (selectedPhoto.timeDigits.length * 24 + 58)}
                      y={viewfinderSize.height - 24 - (Math.min(4, Math.ceil((selectedPhoto.locationText || '').length / 38)) * 19 + 18) + 2}
                      fill="#ffffff"
                      fontSize={14}
                      fontWeight="500"
                    >
                      {selectedPhoto.dayFormatted}
                    </SvgText>

                    {/* Location lines */}
                    {wrapLocationText(selectedPhoto.locationText || '', Math.floor(viewfinderSize.width / 9.5)).map((line, idx, arr) => (
                      <SvgText
                        key={idx}
                        x={20}
                        y={viewfinderSize.height - 24 - ((arr.length - 1 - idx) * 19)}
                        fill="#ffffff"
                        fontSize={15}
                        fontWeight="500"
                      >
                        {line}
                      </SvgText>
                    ))}
                  </Svg>
                </View>
              )}

              {/* Watermark Overlay (Bottom Left) - Only shown if the photo does not already have a burned watermark */}
              {!isPhotoWatermarked(selectedPhoto) && (
                <View style={styles.watermarkContainer} pointerEvents="box-none">
                  <View style={styles.watermarkTimeRow} pointerEvents="none">
                    <Text style={styles.watermarkTime}>
                      {selectedPhoto.timeDigits}
                      <Text style={styles.watermarkPeriod}> {selectedPhoto.timePeriod}</Text>
                    </Text>
                    <View style={styles.watermarkDivider} />
                    <View style={styles.watermarkDateCol}>
                      <Text style={styles.watermarkDate}>{selectedPhoto.dateFormatted}</Text>
                      <Text style={styles.watermarkDay}>{selectedPhoto.dayFormatted}</Text>
                    </View>
                  </View>
                  <View style={styles.watermarkLocationRow}>
                    <Text style={styles.watermarkLocation} numberOfLines={4}>
                      {selectedPhoto.locationText}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          )}

          {/* Bottom Controls Bar matching PhotoProofScreen preview */}
          <View
            style={[
              styles.viewerBottomBar,
              {
                paddingBottom: Platform.OS === 'web' ? 16 : Math.max(insets.bottom, 16),
              },
            ]}
          >
            {/* Floating Success Feedback Toast */}
            {toastMessage && (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.saveToastContainer,
                  {
                    opacity: toastAnim,
                    transform: [
                      {
                        translateY: toastAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [20, 0],
                        }),
                      },
                      {
                        scale: toastAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0.94, 1],
                        }),
                      },
                    ],
                  },
                ]}
              >
                <View style={styles.saveToastCard}>
                  <View
                    style={[
                      styles.saveToastIconCircle,
                      toastMessage.type === 'share' ? styles.shareToastIconCircle : null,
                    ]}
                  >
                    {toastMessage.type === 'share' ? (
                      <Share2 size={18} color="#2563eb" strokeWidth={2.6} />
                    ) : (
                      <Check size={18} color="#16a34a" strokeWidth={2.8} />
                    )}
                  </View>
                  <View style={styles.saveToastTextCol}>
                    <Text style={styles.saveToastTitle}>{toastMessage.title}</Text>
                    <Text style={styles.saveToastSubtitle}>{toastMessage.subtitle}</Text>
                  </View>
                </View>
              </Animated.View>
            )}

            <View style={styles.capturedControlsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.retakeButton,
                  saveSuccess ? styles.actionButtonSuccessSave : null,
                  pressed ? styles.actionButtonPressed : null,
                  (isSaving || isSharing) ? styles.actionButtonDisabled : null,
                ]}
                onPress={handleSaveToPhone}
                disabled={isSaving || isSharing}
                hitSlop={8}
                accessibilityLabel="Save to Phone"
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="#0f172a" />
                ) : saveSuccess ? (
                  <Check size={20} color="#16a34a" strokeWidth={2.8} />
                ) : (
                  <Download size={20} color="#0f172a" strokeWidth={2.4} />
                )}
                <Text
                  style={[
                    styles.retakeText,
                    saveSuccess ? styles.saveSuccessText : null,
                  ]}
                >
                  {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save to Phone'}
                </Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.viewLogsButton,
                  shareSuccess ? styles.actionButtonSuccessShare : null,
                  pressed ? styles.actionButtonPressed : null,
                  (isSaving || isSharing) ? styles.actionButtonDisabled : null,
                ]}
                onPress={handleSharePhoto}
                disabled={isSaving || isSharing}
                hitSlop={8}
                accessibilityLabel="Share Photo"
              >
                {isSharing ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : shareSuccess ? (
                  <Check size={20} color="#ffffff" strokeWidth={2.8} />
                ) : (
                  <Share2 size={20} color="#ffffff" strokeWidth={2.4} />
                )}
                <Text style={styles.viewLogsText}>
                  {isSharing ? 'Preparing...' : shareSuccess ? 'Shared!' : 'Share'}
                </Text>
              </Pressable>
            </View>
          </View>
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
              This will permanently remove the photo record from your device, database log, and Google Drive storage.
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
  viewerScreenContainer: {
    flex: 1,
    backgroundColor: '#ffffff',
    ...(Platform.OS === 'web'
      ? ({
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 99999,
        } as any)
      : {}),
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    zIndex: 10,
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
  viewfinderContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#0f172a',
    overflow: 'hidden',
  },
  viewfinderMedia: {
    width: '100%',
    height: '100%',
  },
  watermarkContainer: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    zIndex: 5,
  },
  watermarkTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  watermarkTime: {
    fontSize: 42,
    lineHeight: 48,
    fontWeight: '300',
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  watermarkPeriod: {
    fontSize: 22,
    lineHeight: 26,
    fontWeight: fontWeights.heavy,
    color: '#facc15',
  },
  watermarkDivider: {
    width: 2,
    height: 38,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    marginHorizontal: 4,
  },
  watermarkDateCol: {
    justifyContent: 'center',
  },
  watermarkDate: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.semibold,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  watermarkDay: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 3,
  },
  watermarkLocationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  watermarkLocation: {
    flex: 1,
    marginTop: 3,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: fontWeights.medium,
    color: '#ffffff',
    textShadowColor: 'rgba(0, 0, 0, 0.85)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 4,
  },
  viewerBottomBar: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: 16,
  },
  capturedControlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    width: '100%',
    justifyContent: 'center',
  },
  retakeButton: {
    flex: 1,
    maxWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#f1f5f9',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  retakeText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  viewLogsButton: {
    flex: 1,
    maxWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: '#0f172a',
  },
  viewLogsText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
  actionButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.94 }],
  },
  actionButtonDisabled: {
    opacity: 0.65,
  },
  actionButtonSuccessSave: {
    backgroundColor: '#ecfdf5',
    borderColor: '#86efac',
  },
  saveSuccessText: {
    color: '#15803d',
  },
  actionButtonSuccessShare: {
    backgroundColor: '#16a34a',
    borderColor: '#16a34a',
  },
  saveToastContainer: {
    position: 'absolute',
    bottom: 86,
    left: 20,
    right: 20,
    alignItems: 'center',
    zIndex: 99,
  },
  saveToastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#ffffff',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    maxWidth: 420,
    width: '100%',
  },
  saveToastIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareToastIconCircle: {
    backgroundColor: '#dbeafe',
  },
  saveToastTextCol: {
    flex: 1,
    justifyContent: 'center',
  },
  saveToastTitle: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  saveToastSubtitle: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: fontWeights.medium,
    marginTop: 1,
  },
});
