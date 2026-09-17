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
import { ChevronLeft, Info, RefreshCw, SwitchCamera, X, Check, Eye, Pencil, MapPin, Images, Zap, ZapOff } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, FlipType, SaveFormat } from 'expo-image-manipulator';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  employeeId?: string | null;
  employeeName?: string | null;
  userEmail?: string | null;
  userStoreName?: string | null;
};

function drawWatermarkOnCanvas(
  ctx: any,
  w: number,
  h: number,
  data: {
    timeDigits: string;
    timePeriod: string;
    dateFormatted: string;
    dayFormatted: string;
    locationText: string;
  }
) {
  try {
    const scale = Math.max(1, w / 400);
    const padX = Math.round(20 * scale);
    const btmY = h - Math.round(24 * scale);

    // Subtle dark gradient at bottom for maximum readability against bright scenes
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

    // Location text wrapping
    const locFontSize = Math.round(15 * scale);
    const locLineHeight = Math.round(19 * scale);
    ctx.font = `500 ${locFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = '#ffffff';

    const maxLocWidth = w - padX * 2;
    const words = (data.locationText || '').split(' ');
    const lines: string[] = [];
    let curLine = '';
    for (const word of words) {
      const test = curLine ? `${curLine} ${word}` : word;
      if (ctx.measureText(test).width > maxLocWidth && curLine) {
        lines.push(curLine);
        curLine = word;
      } else {
        curLine = test;
      }
    }
    if (curLine) lines.push(curLine);
    const displayLines = lines.slice(0, 4);

    let curY = btmY;
    for (let i = displayLines.length - 1; i >= 0; i--) {
      ctx.fillText(displayLines[i], padX, curY);
      curY -= locLineHeight;
    }

    // Time & Period row above location
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

    // Divider
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

    // Date & Day
    const dateX = divX + Math.round(10 * scale);
    ctx.font = `600 ${dateFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(data.dateFormatted || '', dateX, curY - Math.round(16 * scale));

    ctx.font = `500 ${dayFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(data.dayFormatted || '', dateX, curY + Math.round(2 * scale));
    ctx.restore();
  } catch (err) {
    console.warn('[PhotoProof] Watermark canvas overlay failed:', err);
  }
}

export function PhotoProofScreen({
  onBack,
  onOpenPhotoLog,
  employeeId,
  employeeName = 'Employee',
  userEmail,
  userStoreName,
}: Props) {
  const insets = useSafeAreaInsets();
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  // Automatic mirroring: Front camera is automatically mirrored/flipped; Back camera is left as-is
  const isMirrored = facingMode === 'user';
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

  // Zoom level: 0 (1x normal), 0.12 (2x), 0.25 (3x)
  const [zoom, setZoom] = useState(0);

  // Camera Flash mode: 'off' | 'on' | 'auto' for night / low-light capture
  const [flashMode, setFlashMode] = useState<'off' | 'on' | 'auto'>('off');

  const toggleFlashMode = () => {
    setFlashMode((prev) => {
      if (prev === 'off') return 'on';
      if (prev === 'on') return 'auto';
      return 'off';
    });
  };

  const handleSetPreset = (targetZoom: number) => {
    setZoom(targetZoom);
  };

  // Camera permissions hook for native iOS/Android builds
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  useEffect(() => {
    if (Platform.OS !== 'web' && cameraPermission && !cameraPermission.granted && cameraPermission.canAskAgain) {
      void requestCameraPermission();
    }
  }, [cameraPermission, requestCameraPermission]);

  // Web camera video element ref & Native Camera ref
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraRef = useRef<any>(null);
  const [isWebCameraReady, setIsWebCameraReady] = useState(false);

  // Auto-dismiss timer for saved confirmation modal
  const savedModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTemporarySavedModal = () => {
    setShowSavedModal(true);
    if (savedModalTimerRef.current) {
      clearTimeout(savedModalTimerRef.current);
    }
    savedModalTimerRef.current = setTimeout(() => {
      setShowSavedModal(false);
    }, 1200);
  };

  useEffect(() => {
    return () => {
      if (savedModalTimerRef.current) {
        clearTimeout(savedModalTimerRef.current);
      }
    };
  }, []);

  // Full-screen native-style screen flash animation & subtle camera shutter click animation
  const screenFlashAnim = useRef(new Animated.Value(0)).current;
  const shutterAnim = useRef(new Animated.Value(0)).current;

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
        () => { },
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
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => { });
        setIsWebCameraReady(true);
      }
    } catch (err) {
      console.warn('Web camera stream failed:', err);
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
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Helper to detect if ambient webcam scene is low-light / dark (for Auto flash on web)
  const checkIsWebLowLight = (video: HTMLVideoElement): boolean => {
    try {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = 32;
      sampleCanvas.height = 32;
      const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;
      ctx.drawImage(video, 0, 0, 32, 32);
      const imgData = ctx.getImageData(0, 0, 32, 32).data;
      let totalLuminance = 0;
      const step = 16; // Sample every 4th pixel for high speed
      let count = 0;
      for (let i = 0; i < imgData.length; i += step) {
        totalLuminance += 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
        count++;
      }
      const avg = totalLuminance / (count || 1);
      // Low light threshold (scale 0-255, < 95 is dim/dark environment)
      return avg < 95;
    } catch {
      return false;
    }
  };

  const triggerShutter = () => {
    shutterAnim.setValue(0.45);
    Animated.timing(shutterAnim, {
      toValue: 0,
      duration: 120,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const handleCapture = async () => {
    if (isCapturing) return;
    setIsCapturing(true);

    // Determine whether flash should fire (matches native Android/iOS CameraView behavior)
    let shouldFlash = false;
    if (flashMode === 'on') {
      shouldFlash = true;
    } else if (flashMode === 'auto') {
      if (Platform.OS === 'web' && videoRef.current) {
        shouldFlash = checkIsWebLowLight(videoRef.current);
      } else {
        shouldFlash = true;
      }
    }

    // Trigger visual capture feedback
    if (shouldFlash) {
      // Screen Flash: Instantly illuminate full screen bright white
      screenFlashAnim.setValue(1);
    } else {
      triggerShutter();
    }

    let newItem: PhotoProofItem | null = null;
    let didEnableTorch = false;
    let activeTorchTrack: MediaStreamTrack | null = null;
    try {
      let finalPhotoUri: string | null = null;
      let capturedWidth: number | undefined;
      let capturedHeight: number | undefined;

      if (Platform.OS === 'web' && videoRef.current) {
        const video = videoRef.current;

        // If flash is triggered on web, strobe rear hardware torch (if supported) or hold screen flash
        if (shouldFlash) {
          if (streamRef.current && facingMode === 'environment') {
            const track = streamRef.current.getVideoTracks()[0];
            if (track) {
              try {
                const caps = (track.getCapabilities?.() || {}) as any;
                if (caps.torch) {
                  activeTorchTrack = track;
                  await track.applyConstraints({ advanced: [{ torch: true } as any] });
                  didEnableTorch = true;
                }
              } catch {
                // Torch not available
              }
            }
          }

          // Allow the screen flash or torch light to physically illuminate the scene and webcam sensor
          await new Promise((resolve) => setTimeout(resolve, 200));
        }

        // Capture frame directly from HTML5 video feed with zoom crop and mirror if applied
        const canvas = document.createElement('canvas');
        const vWidth = video.videoWidth || 720;
        const vHeight = video.videoHeight || 1280;
        canvas.width = vWidth;
        canvas.height = vHeight;
        capturedWidth = vWidth;
        capturedHeight = vHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.save();
          if (isMirrored) {
            // Flip canvas horizontally so captured photo matches mirrored preview
            ctx.translate(vWidth, 0);
            ctx.scale(-1, 1);
          }
          if (shouldFlash) {
            // Enhance low-light brightness and contrast for flash photography on web
            ctx.filter = 'brightness(1.26) contrast(1.10) saturate(1.04)';
          }
          if (zoom > 0) {
            const scale = 1 + zoom * 2.5;
            const sw = vWidth / scale;
            const sh = vHeight / scale;
            const sx = (vWidth - sw) / 2;
            const sy = (vHeight - sh) / 2;
            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
          } else {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }
          ctx.restore();
          drawWatermarkOnCanvas(ctx, canvas.width, canvas.height, {
            timeDigits: currentTimestamp.timeDigits,
            timePeriod: currentTimestamp.timePeriod,
            dateFormatted: currentTimestamp.dateFormatted,
            dayFormatted: currentTimestamp.dayFormatted,
            locationText: locationText || 'Tacloban City, 6500',
          });
          finalPhotoUri = canvas.toDataURL('image/jpeg', 0.88);
        }

        // Immediately turn off torch if it was active
        if (didEnableTorch && activeTorchTrack) {
          try {
            await activeTorchTrack.applyConstraints({ advanced: [{ torch: false } as any] });
          } catch {
            // ignore
          }
        }

        // Smoothly fade out the screen flash
        if (shouldFlash) {
          Animated.timing(screenFlashAnim, {
            toValue: 0,
            duration: 320,
            useNativeDriver: Platform.OS !== 'web',
          }).start();
        }
      } else if (nativeCameraRef.current) {
        // Capture directly from live embedded CameraView on native mobile
        const photo = await nativeCameraRef.current.takePictureAsync({
          quality: 0.88,
          base64: true,
        });
        if (photo?.uri) {
          let photoUri = photo.uri;
          capturedWidth = photo.width;
          capturedHeight = photo.height;
          if (isMirrored) {
            try {
              const manip = await manipulateAsync(
                photo.uri,
                [{ flip: FlipType.Horizontal }],
                { compress: 0.88, format: SaveFormat.JPEG, base64: true },
              );
              if (manip?.uri) {
                photoUri = manip.uri;
                if (manip.width && manip.height) {
                  capturedWidth = manip.width;
                  capturedHeight = manip.height;
                }
              }
            } catch (flipErr) {
              console.warn('[PhotoProof] Image flip failed:', flipErr);
            }
          }
          finalPhotoUri = photoUri;
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
          let photoUri = result.assets[0].uri;
          capturedWidth = result.assets[0].width;
          capturedHeight = result.assets[0].height;
          if (isMirrored) {
            try {
              const manip = await manipulateAsync(
                photoUri,
                [{ flip: FlipType.Horizontal }],
                { compress: 0.88, format: SaveFormat.JPEG, base64: true },
              );
              if (manip?.uri) {
                photoUri = manip.uri;
                if (manip.width && manip.height) {
                  capturedWidth = manip.width;
                  capturedHeight = manip.height;
                }
              }
            } catch (flipErr) {
              console.warn('[PhotoProof] Image flip failed:', flipErr);
            }
          }
          finalPhotoUri = photoUri;
        }
      }

      if (!finalPhotoUri) {
        setIsCapturing(false);
        return;
      }

      setCapturedPhotoUri(finalPhotoUri);

      // Create new photo proof log item
      newItem = {
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
        employeeId: employeeId || null,
        employeeName: employeeName || 'Employee',
        userEmail: userEmail || null,
        storeName: userStoreName,
        imageWidth: capturedWidth,
        imageHeight: capturedHeight,
        isWatermarked: Platform.OS === 'web',
      };

      console.log('[PhotoProof] Capturing photo proof for employee:', employeeName, 'id:', employeeId, 'store:', userStoreName);
      await savePhotoProof(newItem);
      console.log('[PhotoProof] Photo proof saved and synced!');
      setLastSavedItem(newItem);
      showTemporarySavedModal();
    } catch (err: any) {
      screenFlashAnim.setValue(0);
      console.error('Failed to capture and save photo proof:', err);
      Alert.alert('Capture Warning', `Photo saved locally, but cloud sync logged an issue: ${err?.message || err}`);
      if (newItem) {
        setLastSavedItem(newItem);
        showTemporarySavedModal();
      }
    } finally {
      if (didEnableTorch && activeTorchTrack) {
        try {
          void activeTorchTrack.applyConstraints({ advanced: [{ torch: false } as any] });
        } catch {}
      }
      setIsCapturing(false);
    }
  };

  const handleRetake = () => {
    if (savedModalTimerRef.current) {
      clearTimeout(savedModalTimerRef.current);
    }
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
                    el.play().catch(() => { });
                  }
                }}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  transform: `${isMirrored ? 'scaleX(-1)' : 'scaleX(1)'} ${zoom > 0 ? `scale(${1 + zoom * 2.5})` : ''}`.trim(),
                  transformOrigin: 'center center',
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
            zoom={zoom}
            flash={
              facingMode === 'user' && flashMode === 'on'
                ? (Platform.OS === 'android' ? 'screen' : 'on')
                : flashMode
            }
            animateShutter={true}
          />
        )}

        {/* Viewfinder Top Left Controls - Flash button for night photography */}
        {!capturedPhotoUri && (
          <View style={styles.viewfinderTopLeftBar}>
            <Pressable
              style={({ pressed }) => [
                styles.glassButton,
                flashMode === 'on' ? styles.glassButtonFlashOn : null,
                flashMode === 'auto' ? styles.glassButtonFlashAuto : null,
                pressed ? styles.glassButtonPressed : null,
              ]}
              onPress={toggleFlashMode}
              hitSlop={8}
              accessibilityLabel={`Flash mode: ${flashMode}`}
              accessibilityRole="button"
            >
              {flashMode === 'off' && (
                <ZapOff size={20} color="#ffffff" strokeWidth={2.2} />
              )}
              {flashMode === 'on' && (
                <Zap size={20} color="#facc15" fill="#facc15" strokeWidth={2.2} />
              )}
              {flashMode === 'auto' && (
                <View style={styles.flashAutoIconWrap}>
                  <Zap size={18} color="#38bdf8" strokeWidth={2.2} />
                  <Text style={styles.flashAutoLetter}>A</Text>
                </View>
              )}
            </Pressable>

            {/* Flash state pill indicator */}
            {flashMode !== 'off' && (
              <Pressable
                style={[
                  styles.flashBadge,
                  flashMode === 'on' ? styles.flashBadgeOn : styles.flashBadgeAuto,
                ]}
                onPress={toggleFlashMode}
                hitSlop={6}
              >
                <Text
                  style={[
                    styles.flashBadgeText,
                    flashMode === 'on' ? styles.flashBadgeTextOn : styles.flashBadgeTextAuto,
                  ]}
                >
                  {flashMode === 'on' ? 'FLASH ON' : 'AUTO'}
                </Text>
              </Pressable>
            )}
          </View>
        )}





        {/* Live Watermark Overlay (Bottom Left) - On Web, the captured photo already has the watermark burned into the canvas, so hide it during preview. On Android/native, preserve original behavior */}
        {(Platform.OS !== 'web' || !capturedPhotoUri) && (
          <View style={styles.watermarkContainer} pointerEvents="box-none">
            <View style={styles.watermarkTimeRow} pointerEvents="none">
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
        )}

        {/* Shutter Click Darkening Layer */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.shutterOverlay,
            {
              opacity: shutterAnim,
            },
          ]}
        />
      </View>

      {/* Bottom Shutter Bar */}
      <View
        style={[
          styles.bottomBar,
          {
            paddingBottom: Platform.OS === 'web' ? 12 : Math.max(insets.bottom, 12),
            minHeight: Platform.OS === 'web' ? 140 : Math.max(120 + insets.bottom, 140),
          },
        ]}
      >
        {capturedPhotoUri ? (
          <View style={styles.capturedControlsRow}>
            <Pressable style={styles.retakeButton} onPress={handleRetake}>
              <RefreshCw size={20} color="#0f172a" strokeWidth={2.4} />
              <Text style={styles.retakeText}>Take Another</Text>
            </Pressable>
            <Pressable style={styles.viewLogsButton} onPress={onOpenPhotoLog}>
              <Eye size={20} color="#ffffff" strokeWidth={2.4} />
              <Text style={styles.viewLogsText}>View Photo Log</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.shutterColumn}>
            {/* Quick Zoom Presets directly at the top of the capture button */}
            <View style={styles.zoomPresetsContainer}>
              {[
                { label: '1x', val: 0 },
                { label: '2x', val: 0.12 },
                { label: '3x', val: 0.25 },
              ].map((item) => {
                const isActive = Math.abs(zoom - item.val) < 0.04;
                return (
                  <Pressable
                    key={item.label}
                    style={({ pressed }) => [
                      styles.zoomPill,
                      isActive ? styles.zoomPillActive : null,
                      pressed ? styles.zoomButtonPressed : null,
                    ]}
                    onPress={() => handleSetPreset(item.val)}
                    hitSlop={6}
                  >
                    <Text style={[styles.zoomPillText, isActive ? styles.zoomPillTextActive : null]}>
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.shutterRow}>
              {/* Photo Log Button on the left side */}
              <View style={styles.shutterSideSlot}>
                <Pressable
                  style={({ pressed }) => [
                    styles.shutterSideButton,
                    pressed ? styles.shutterSideButtonPressed : null,
                  ]}
                  onPress={onOpenPhotoLog}
                  hitSlop={12}
                  accessibilityLabel="Photo Log"
                >
                  <Images size={28} color="#0f172a" strokeWidth={2} />
                </Pressable>
              </View>

              {/* Shutter Capture Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.shutterButtonOuter,
                  pressed ? styles.shutterButtonPressed : null,
                ]}
                onPress={handleCapture}
                disabled={isCapturing}
                hitSlop={8}
              >
                <View style={styles.shutterButtonInner} />
              </Pressable>

              {/* Swap Camera Button on the right side */}
              <View style={styles.shutterSideSlot}>
                <Pressable
                  style={({ pressed }) => [
                    styles.shutterSideButton,
                    pressed ? styles.shutterSideButtonPressed : null,
                  ]}
                  onPress={toggleFacingMode}
                  hitSlop={12}
                  accessibilityLabel="Swap Camera"
                >
                  <SwitchCamera size={28} color="#0f172a" strokeWidth={2} />
                </Pressable>
              </View>
            </View>
          </View>
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

      {/* Saved Success Confirmation Modal (Auto-dismisses in 1.2s to reveal photo preview) */}
      <Modal
        visible={showSavedModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSavedModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowSavedModal(false)}>
          <View style={styles.savedModalCard}>
            <View style={styles.savedCheckCircle}>
              <Check size={28} color="#16a34a" strokeWidth={3} />
            </View>
            <Text style={styles.savedTitle}>Photo Proof Saved!</Text>
          </View>
        </Pressable>
      </Modal>
      {/* Full-Screen Native-Style Screen Flash Overlay (Illuminates entire display for true Retina / Screen Flash) */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.fullScreenFlashOverlay,
          {
            opacity: screenFlashAnim,
          },
        ]}
      />
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
  viewfinderTopLeftBar: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
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
  glassButtonActive: {
    backgroundColor: 'rgba(2, 132, 199, 0.65)',
    borderColor: '#38bdf8',
  },
  glassButtonFlashOn: {
    backgroundColor: 'rgba(234, 179, 8, 0.3)',
    borderColor: '#facc15',
    borderWidth: 1.5,
  },
  glassButtonFlashAuto: {
    backgroundColor: 'rgba(2, 132, 199, 0.3)',
    borderColor: '#38bdf8',
    borderWidth: 1.5,
  },
  glassButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.94 }],
  },
  flashAutoIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    width: 22,
    height: 22,
  },
  flashAutoLetter: {
    position: 'absolute',
    bottom: -2,
    right: -5,
    fontSize: 9,
    fontWeight: fontWeights.heavy,
    color: '#38bdf8',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderRadius: 3,
    paddingHorizontal: 1,
    lineHeight: 11,
  },
  flashBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    borderWidth: 1,
  },
  flashBadgeOn: {
    borderColor: 'rgba(250, 204, 21, 0.5)',
  },
  flashBadgeAuto: {
    borderColor: 'rgba(56, 189, 248, 0.5)',
  },
  flashBadgeText: {
    fontSize: 10,
    fontWeight: fontWeights.bold,
    letterSpacing: 0.5,
  },
  flashBadgeTextOn: {
    color: '#facc15',
  },
  flashBadgeTextAuto: {
    color: '#38bdf8',
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
  shutterOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    zIndex: 20,
  },
  fullScreenFlashOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#ffffff',
    zIndex: 9999,
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
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 10,
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
  shutterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 24,
  },
  shutterSideSlot: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterSideButton: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterSideButtonPressed: {
    opacity: 0.5,
    transform: [{ scale: 0.92 }],
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
    maxWidth: 280,
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    paddingVertical: spacing.lg + 4,
    paddingHorizontal: spacing.lg,
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
    marginBottom: spacing.sm + 2,
  },
  savedTitle: {
    fontSize: 18,
    fontWeight: fontWeights.heavy,
    color: '#0f172a',
    textAlign: 'center',
  },
  shutterColumn: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomPresetsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    padding: 3,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  zoomPill: {
    paddingHorizontal: 13,
    paddingVertical: 4,
    borderRadius: 16,
    minWidth: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomPillActive: {
    backgroundColor: '#0f172a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  zoomButtonPressed: {
    opacity: 0.7,
    transform: [{ scale: 0.94 }],
  },
  zoomPillText: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: '#64748b',
  },
  zoomPillTextActive: {
    color: '#ffffff',
  },
});
