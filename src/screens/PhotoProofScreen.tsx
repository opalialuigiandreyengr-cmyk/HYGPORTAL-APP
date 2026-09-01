import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ChevronLeft, Info, RefreshCw, SwitchCamera, X, Check, Eye, Pencil, MapPin } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { CameraView } from 'expo-camera';
import { fontWeights, radius, spacing } from '../theme';
import {
  formatProofTimestamp,
  getCurrentLocationInfo,
  reverseGeocodeCoordinates,
  savePhotoProof,
  type PhotoProofItem,
} from '../services/photoProof';

type Props = {
  onBack: () => void;
  onOpenPhotoLog: () => void;
  employeeName?: string | null;
  userStoreName?: string | null;
};

export function PhotoProofScreen({
  onBack,
  onOpenPhotoLog,
  employeeName = 'Employee',
  userStoreName,
}: Props) {
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [capturedPhotoUri, setCapturedPhotoUri] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showSavedModal, setShowSavedModal] = useState(false);
  const [showEditAddressModal, setShowEditAddressModal] = useState(false);
  const [tempAddress, setTempAddress] = useState('');
  const [lastSavedItem, setLastSavedItem] = useState<PhotoProofItem | null>(null);
  const [locationText, setLocationText] = useState('Acquiring current address...');
  const [coordinates, setCoordinates] = useState<{ lat?: number; lon?: number }>({});

  // Real-time clock
  const [currentTimestamp, setCurrentTimestamp] = useState(formatProofTimestamp());

  // Web camera video element ref & Native Camera ref
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraRef = useRef<any>(null);
  const [isWebCameraReady, setIsWebCameraReady] = useState(false);

  // Shutter flash animation
  const flashAnim = useRef(new Animated.Value(0)).current;

  // 1. Live Clock update every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimestamp(formatProofTimestamp());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 2. Fetch and Watch Location
  const refreshLocation = useCallback(async () => {
    setIsRefreshingLocation(true);
    try {
      const info = await getCurrentLocationInfo(userStoreName);
      setLocationText(info.locationText);
      setTempAddress(info.locationText);
      setCoordinates({ lat: info.latitude, lon: info.longitude });
    } catch (err) {
      console.warn('Location detection failed:', err);
    } finally {
      setIsRefreshingLocation(false);
    }
  }, [userStoreName]);

  useEffect(() => {
    void refreshLocation();

    let sub: Location.LocationSubscription | null = null;
    let watchId: number | null = null;

    if (Platform.OS !== 'web') {
      void (async () => {
        try {
          const { status } = await Location.getForegroundPermissionsAsync();
          if (status === 'granted') {
            sub = await Location.watchPositionAsync(
              {
                accuracy: Location.Accuracy.High,
                timeInterval: 8000,
                distanceInterval: 10,
              },
              async (loc) => {
                const { latitude, longitude } = loc.coords;
                const fullAddr = await reverseGeocodeCoordinates(latitude, longitude);
                if (fullAddr) {
                  setLocationText(fullAddr);
                  setCoordinates({ lat: latitude, lon: longitude });
                }
              },
            );
          }
        } catch {
          // ignore
        }
      })();
    } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        async (pos) => {
          const { latitude, longitude } = pos.coords;
          const fullAddr = await reverseGeocodeCoordinates(latitude, longitude);
          if (fullAddr) {
            setLocationText(fullAddr);
            setCoordinates({ lat: latitude, lon: longitude });
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 10000 },
      );
    }

    return () => {
      if (sub) {
        sub.remove();
      }
      if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [refreshLocation]);

  // 3. Web Live Camera Stream initialization
  const startWebCamera = useCallback(async (facing: 'environment' | 'user') => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !navigator.mediaDevices) {
      return;
    }
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facing,
          width: { ideal: 1280 },
          height: { ideal: 1920 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
        setIsWebCameraReady(true);
      }
    } catch (err) {
      console.warn('Camera live feed error on web, falling back to image capture:', err);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      void startWebCamera(facingMode);
    }
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, [facingMode, startWebCamera]);

  const toggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
  };

  const triggerFlash = () => {
    flashAnim.setValue(1);
    Animated.timing(flashAnim, {
      toValue: 0,
      duration: 350,
      useNativeDriver: true,
    }).start();
  };

  const handleCapture = async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    triggerFlash();

    try {
      let finalPhotoUri = '';

      if (Platform.OS === 'web' && videoRef.current && isWebCameraReady) {
        // Capture frame directly from HTML5 video feed
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 720;
        canvas.height = video.videoHeight || 1280;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          finalPhotoUri = canvas.toDataURL('image/jpeg', 0.88);
        }
      } else if (nativeCameraRef.current) {
        // Capture directly from live embedded CameraView on native mobile
        const photo = await nativeCameraRef.current.takePictureAsync({
          quality: 0.88,
          base64: true,
        });
        if (photo?.uri) {
          finalPhotoUri = photo.uri;
        }
      } else {
        // Fallback to ImagePicker launchCameraAsync if CameraView not bound
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          allowsEditing: false,
          quality: 0.85,
          base64: true,
        });

        if (!result.canceled && result.assets[0]) {
          finalPhotoUri = result.assets[0].uri;
        }
      }

      if (!finalPhotoUri) {
        setIsCapturing(false);
        return;
      }

      setCapturedPhotoUri(finalPhotoUri);

      // Create new photo proof log item
      const newItem: PhotoProofItem = {
        id: `proof_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        photoUri: finalPhotoUri,
        timestamp: new Date().toISOString(),
        timeDigits: currentTimestamp.timeDigits,
        timePeriod: currentTimestamp.timePeriod,
        dateFormatted: currentTimestamp.dateFormatted,
        dayFormatted: currentTimestamp.dayFormatted,
        locationText: locationText || 'Tacloban City, 6500',
        latitude: coordinates.lat,
        longitude: coordinates.lon,
        employeeName: employeeName || 'Employee',
        storeName: userStoreName,
      };

      await savePhotoProof(newItem);
      setLastSavedItem(newItem);
      setShowSavedModal(true);
    } catch (err) {
      console.error('Failed to capture and save photo proof:', err);
      Alert.alert('Capture Failed', 'Unable to capture photo. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleRetake = () => {
    setCapturedPhotoUri(null);
    setShowSavedModal(false);
    if (Platform.OS === 'web') {
      void startWebCamera(facingMode);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      {/* Top Header */}
      <View style={styles.header}>
        <Pressable style={styles.headerIconButton} onPress={onBack} hitSlop={12}>
          <ChevronLeft size={28} color="#0f172a" strokeWidth={2.4} />
        </Pressable>
        <Text style={styles.headerTitle}>Photo Proof</Text>
        <Pressable
          style={styles.headerIconButton}
          onPress={() => setShowInfoModal(true)}
          hitSlop={12}
        >
          <Info size={24} color="#0284c7" strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* Camera / Viewfinder Surface */}
      <View style={styles.viewfinderContainer}>
        {Platform.OS === 'web' ? (
          capturedPhotoUri ? (
            <Image source={{ uri: capturedPhotoUri }} style={styles.viewfinderMedia} resizeMode="cover" />
          ) : (
            <div
              style={{
                width: '100%',
                height: '100%',
                backgroundColor: '#0f172a',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <video
                ref={(el) => {
                  videoRef.current = el;
                  if (el && streamRef.current && !el.srcObject) {
                    el.srcObject = streamRef.current;
                    el.play().catch(() => {});
                  }
                }}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            </div>
          )
        ) : capturedPhotoUri ? (
          <Image source={{ uri: capturedPhotoUri }} style={styles.viewfinderMedia} resizeMode="cover" />
        ) : (
          <CameraView
            ref={nativeCameraRef}
            facing={facingMode === 'user' ? 'front' : 'back'}
            style={styles.viewfinderMedia}
          />
        )}

        {/* Viewfinder Top Controls */}
        <View style={styles.viewfinderTopBar}>
          <Pressable style={styles.glassButton} onPress={() => void refreshLocation()} disabled={isRefreshingLocation}>
            <RefreshCw size={18} color="#ffffff" strokeWidth={2.2} />
          </Pressable>
          <Pressable style={styles.glassButton} onPress={toggleFacingMode}>
            <SwitchCamera size={20} color="#ffffff" strokeWidth={2.2} />
          </Pressable>
        </View>

        {/* Live Watermark Overlay (Bottom Left) */}
        <View style={styles.watermarkContainer}>
          <View style={styles.watermarkTimeRow}>
            <Text style={styles.watermarkTime}>
              {currentTimestamp.timeDigits}
              <Text style={styles.watermarkPeriod}> {currentTimestamp.timePeriod}</Text>
            </Text>
            <View style={styles.watermarkDivider} />
            <View style={styles.watermarkDateCol}>
              <Text style={styles.watermarkDate}>{currentTimestamp.dateFormatted}</Text>
              <Text style={styles.watermarkDay}>{currentTimestamp.dayFormatted}</Text>
            </View>
          </View>
          <Pressable
            style={styles.watermarkLocationRow}
            onPress={() => {
              setTempAddress(locationText);
              setShowEditAddressModal(true);
            }}
          >
            <Text style={styles.watermarkLocation} numberOfLines={4}>
              {locationText}
            </Text>
            <View style={styles.editLocationBadge}>
              <Pencil size={12} color="#ffffff" strokeWidth={2.5} />
            </View>
          </Pressable>
        </View>

        {/* Shutter Flash Animation Layer */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.flashOverlay,
            {
              opacity: flashAnim,
            },
          ]}
        />
      </View>

      {/* Bottom Shutter Bar */}
      <View style={styles.bottomBar}>
        {capturedPhotoUri ? (
          <View style={styles.capturedControlsRow}>
            <Pressable style={styles.retakeButton} onPress={handleRetake}>
              <RefreshCw size={20} color="#0f172a" strokeWidth={2.4} />
              <Text style={styles.retakeText}>Retake</Text>
            </Pressable>
            <Pressable style={styles.viewLogsButton} onPress={onOpenPhotoLog}>
              <Eye size={20} color="#ffffff" strokeWidth={2.4} />
              <Text style={styles.viewLogsText}>View Logs</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            style={({ pressed }) => [
              styles.shutterButtonOuter,
              pressed ? styles.shutterButtonPressed : null,
            ]}
            onPress={handleCapture}
            disabled={isCapturing}
          >
            <View style={styles.shutterButtonInner} />
          </Pressable>
        )}
      </View>

      {/* Verify GPS Location Modal */}
      <Modal
        visible={showEditAddressModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditAddressModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.editModalCard}>
            <View style={styles.infoModalHeader}>
              <View style={styles.editModalHeaderLeft}>
                <MapPin size={20} color="#0284c7" strokeWidth={2.4} />
                <Text style={styles.infoModalTitle}>Verified GPS Location</Text>
              </View>
              <Pressable onPress={() => setShowEditAddressModal(false)} hitSlop={10}>
                <X size={22} color="#64748b" strokeWidth={2.4} />
              </Pressable>
            </View>

            <Text style={styles.editModalSub}>
              Verified real-time satellite GPS address recorded for this photo proof:
            </Text>

            <View style={styles.readOnlyAddressBox}>
              <MapPin size={18} color="#0284c7" strokeWidth={2.2} style={{ marginTop: 2 }} />
              <Text style={styles.readOnlyAddressText}>{locationText}</Text>
            </View>

            <View style={styles.editModalActions}>
              <Pressable
                style={({ pressed }) => [
                  styles.fullWidthRedetectBtn,
                  pressed ? styles.fullWidthRedetectPressed : null,
                  isRefreshingLocation ? styles.fullWidthRedetectDisabled : null,
                ]}
                onPress={() => void refreshLocation()}
                disabled={isRefreshingLocation}
              >
                <RefreshCw size={16} color="#ffffff" strokeWidth={2.4} />
                <Text style={styles.fullWidthRedetectText}>
                  {isRefreshingLocation ? 'Acquiring GPS Signal...' : 'Re-detect GPS Location'}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Info Modal */}
      <Modal
        visible={showInfoModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfoModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.infoModalCard}>
            <View style={styles.infoModalHeader}>
              <Text style={styles.infoModalTitle}>About Photo Proof</Text>
              <Pressable onPress={() => setShowInfoModal(false)} hitSlop={10}>
                <X size={22} color="#64748b" strokeWidth={2.4} />
              </Pressable>
            </View>
            <Text style={styles.infoModalBody}>
              Photo Proof allows you to capture live, real-time photographic verification of your
              surroundings or store events.
              {'\n\n'}
              Each capture automatically records your verified timestamp, date, and geolocation
              address, stamped directly onto your permanent Photo Log.
            </Text>
            <Pressable
              style={styles.infoModalButton}
              onPress={() => setShowInfoModal(false)}
            >
              <Text style={styles.infoModalButtonText}>Got It</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Saved Success Modal */}
      <Modal
        visible={showSavedModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSavedModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.savedModalCard}>
            <View style={styles.savedCheckCircle}>
              <Check size={28} color="#16a34a" strokeWidth={3} />
            </View>
            <Text style={styles.savedTitle}>Photo Proof Saved!</Text>
            <Text style={styles.savedSubtitle}>
              Logged at {lastSavedItem?.timeDigits} {lastSavedItem?.timePeriod} •{' '}
              {lastSavedItem?.locationText}
            </Text>
            <View style={styles.savedActionsRow}>
              <Pressable
                style={styles.savedSecondaryBtn}
                onPress={handleRetake}
              >
                <Text style={styles.savedSecondaryText}>Take Another</Text>
              </Pressable>
              <Pressable
                style={styles.savedPrimaryBtn}
                onPress={() => {
                  setShowSavedModal(false);
                  onOpenPhotoLog();
                }}
              >
                <Text style={styles.savedPrimaryText}>View Photo Log</Text>
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
    backgroundColor: '#ffffff',
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
  nativeCameraPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#0f172a',
  },
  viewfinderTopBar: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    gap: spacing.sm,
    zIndex: 5,
  },
  glassButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
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
  editLocationBadge: {
    marginTop: 4,
    padding: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    zIndex: 20,
  },
  editModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  editModalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editModalSub: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    marginBottom: spacing.md,
  },
  readOnlyAddressBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs + 4,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: '#f8fafc',
    minHeight: 75,
    marginBottom: spacing.md,
  },
  readOnlyAddressText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.semibold,
    color: '#0f172a',
  },
  editModalActions: {
    width: '100%',
  },
  fullWidthRedetectBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: '#0f172a',
  },
  fullWidthRedetectPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  fullWidthRedetectDisabled: {
    opacity: 0.6,
  },
  fullWidthRedetectText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
  bottomBar: {
    height: 110,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Platform.OS === 'ios' ? 20 : 10,
  },
  shutterButtonOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 6,
  },
  shutterButtonPressed: {
    transform: [{ scale: 0.92 }],
  },
  shutterButtonInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  retakeText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  viewLogsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#0f172a',
  },
  viewLogsText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  infoModalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    padding: spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  infoModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  infoModalTitle: {
    fontSize: 18,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
  },
  infoModalBody: {
    fontSize: 14,
    lineHeight: 21,
    color: '#475569',
    marginBottom: spacing.lg,
  },
  infoModalButton: {
    backgroundColor: '#0f172a',
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  infoModalButtonText: {
    fontSize: 15,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
  savedModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  savedCheckCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#dcfce7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  savedTitle: {
    fontSize: 20,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
    marginBottom: 6,
  },
  savedSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  savedActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  },
  savedSecondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
  },
  savedSecondaryText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#0f172a',
  },
  savedPrimaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    backgroundColor: '#0f172a',
    alignItems: 'center',
  },
  savedPrimaryText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
});
