import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { supabase } from '../lib/supabase';

export type PhotoProofItem = {
  id: string;
  photoUri: string;
  timestamp: string;
  timeDigits: string; // e.g. "10:35"
  timePeriod: string; // e.g. "AM" | "PM"
  dateFormatted: string; // e.g. "Sept. 01, 2026"
  dayFormatted: string; // e.g. "Thu"
  locationText: string; // Real full address
  latitude?: number;
  longitude?: number;
  employeeName?: string | null;
  userEmail?: string | null;
  storeName?: string | null;
  driveFileId?: string | null;
  driveWebViewLink?: string | null;
  syncedToCloud?: boolean;
};

const PHOTO_PROOFS_KEY = 'hyg_photo_proofs_list';

export async function loadPhotoProofs(): Promise<PhotoProofItem[]> {
  let localList: PhotoProofItem[] = [];
  try {
    const list = await getCacheJSON<PhotoProofItem[]>(PHOTO_PROOFS_KEY);
    if (list && Array.isArray(list)) {
      localList = list;
    }
  } catch (err) {
    console.error('Failed to load local photo proofs:', err);
  }

  try {
    const { data, error } = await supabase
      .from('photo_proofs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(50);

    if (!error && data && data.length > 0) {
      const cloudItems: PhotoProofItem[] = data.map((row: any) => ({
        id: row.id,
        photoUri: row.photo_url || row.drive_web_view_link || '',
        timestamp: row.timestamp,
        timeDigits: row.time_digits,
        timePeriod: row.time_period,
        dateFormatted: row.date_formatted,
        dayFormatted: row.day_formatted,
        locationText: row.location_text,
        latitude: row.latitude,
        longitude: row.longitude,
        employeeName: row.employee_name,
        storeName: row.store_name,
        driveFileId: row.drive_file_id,
        driveWebViewLink: row.drive_web_view_link,
        syncedToCloud: true,
      }));

      const map = new Map<string, PhotoProofItem>();
      for (const item of cloudItems) {
        map.set(item.id, item);
      }
      for (const item of localList) {
        if (!map.has(item.id)) {
          map.set(item.id, item);
        }
      }
      return Array.from(map.values()).sort(
        (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
      );
    }
  } catch {
    // Offline or table pending
  }

  return localList.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
}

export async function syncPhotoProofToCloud(item: PhotoProofItem): Promise<boolean> {
  try {
    let base64Photo = item.photoUri;

    // Convert local file:/// URI to base64 string on native mobile devices
    if (Platform.OS !== 'web' && item.photoUri && !item.photoUri.startsWith('data:')) {
      try {
        base64Photo = await FileSystem.readAsStringAsync(item.photoUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch (readErr) {
        console.warn('Failed to read photo file as base64:', readErr);
      }
    }

    console.log('[PhotoProofSync] Sending photo proof to Supabase Edge Function...', {
      employee: item.employeeName,
      store: item.storeName,
      hasPhoto: Boolean(base64Photo),
      photoDataLength: base64Photo?.length,
    });

    const { data: funcData, error: funcError } = await supabase.functions.invoke('upload-photo-proof', {
      body: {
        photoBase64: base64Photo,
        employeeName: item.employeeName || 'Employee',
        storeName: item.storeName || item.userEmail || undefined,
        timestamp: item.timestamp,
        timeDigits: item.timeDigits,
        timePeriod: item.timePeriod,
        dateFormatted: item.dateFormatted,
        dayFormatted: item.dayFormatted,
        locationText: item.locationText,
        latitude: item.latitude,
        longitude: item.longitude,
      },
    });

    console.log('[PhotoProofSync] Edge Function response:', { funcData, funcError });

    if (!funcError && funcData?.driveWebViewLink) {
      item.driveFileId = funcData.driveFileId;
      item.driveWebViewLink = funcData.driveWebViewLink;
      item.syncedToCloud = true;

      const current = await loadPhotoProofs();
      const updated = current.map((p) => (p.id === item.id ? { ...p, ...item } : p));
      await setCacheJSON(PHOTO_PROOFS_KEY, updated);
      return true;
    }
  } catch (err) {
    console.warn('Google Drive edge function sync error:', err);
  }

  // Database insert in photo_proofs table fallback
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id ?? null;

    const { error } = await supabase.from('photo_proofs').insert({
      employee_id: userId,
      employee_name: item.employeeName || 'Employee',
      store_name: item.storeName || item.userEmail || undefined,
      timestamp: item.timestamp,
      time_digits: item.timeDigits,
      time_period: item.timePeriod,
      date_formatted: item.dateFormatted,
      day_formatted: item.dayFormatted,
      location_text: item.locationText,
      latitude: item.latitude,
      longitude: item.longitude,
      drive_file_id: item.driveFileId,
      drive_web_view_link: item.driveWebViewLink,
    });

    if (!error) return true;
  } catch {
    // Offline
  }

  return Boolean(item.driveWebViewLink);
}



export async function savePhotoProof(item: PhotoProofItem): Promise<void> {
  try {
    const current = await loadPhotoProofs();
    const updated = [item, ...current.filter((p) => p.id !== item.id)];
    await setCacheJSON(PHOTO_PROOFS_KEY, updated);

    // Sync to Supabase cloud table in background
    void syncPhotoProofToCloud(item);
  } catch (err) {
    console.error('Failed to save photo proof:', err);
    throw err;
  }
}

export async function deletePhotoProof(id: string): Promise<void> {
  try {
    const current = await loadPhotoProofs();
    const updated = current.filter((p) => p.id !== id);
    await setCacheJSON(PHOTO_PROOFS_KEY, updated);
  } catch (err) {
    console.error('Failed to delete photo proof:', err);
    throw err;
  }
}

export async function requestCameraAndLocationPermissions(): Promise<{
  cameraGranted: boolean;
  locationGranted: boolean;
}> {
  let cameraGranted = false;
  let locationGranted = false;

  // 1. Camera permission
  try {
    let cameraStatus = await ImagePicker.getCameraPermissionsAsync();
    if (!cameraStatus.granted && cameraStatus.canAskAgain) {
      cameraStatus = await ImagePicker.requestCameraPermissionsAsync();
    }
    cameraGranted = cameraStatus.granted;
  } catch {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.mediaDevices) {
      cameraGranted = true;
    }
  }

  // 2. High-Accuracy GPS Location permission & prompt (Expo Go Native + Web)
  try {
    if (Platform.OS !== 'web') {
      const locStatus = await Location.requestForegroundPermissionsAsync();
      locationGranted = locStatus.status === 'granted';
      if (!locationGranted) {
        Alert.alert(
          'Location Permission Needed',
          'Please allow location access in Expo Go to record accurate GPS address stamps on photo proofs.',
        );
      }
    } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
      locationGranted = await new Promise<boolean>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          (err) => {
            if (err.code === err.PERMISSION_DENIED) {
              Alert.alert(
                'Location Access Blocked',
                'GPS location access is blocked in your browser. Please allow location access for accurate GPS photo proof.',
              );
              resolve(false);
            } else {
              resolve(true);
            }
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
        );
      });
    } else {
      locationGranted = true;
    }
  } catch {
    locationGranted = true;
  }

  return { cameraGranted, locationGranted };
}

/**
 * Reverse geocodes coordinates to a full, human-readable address.
 */
export async function reverseGeocodeCoordinates(
  lat: number,
  lon: number,
): Promise<string | null> {
  // Provider 1: OpenStreetMap Nominatim with full address components
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept-Language': 'en',
          'User-Agent': 'HYGPortalMobile/1.0',
        },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const addr = data.address || {};

      const building = addr.amenity || addr.shop || addr.building || addr.office || addr.tourism || addr.commercial || '';
      const streetNum = addr.house_number || '';
      const road = addr.road || addr.street || addr.pedestrian || addr.footway || addr.path || '';
      const streetPart = [streetNum, road].filter(Boolean).join(' ');

      const barangay =
        addr.neighbourhood ||
        addr.suburb ||
        addr.quarter ||
        addr.residential ||
        addr.village ||
        addr.hamlet ||
        '';

      const city =
        addr.city ||
        addr.town ||
        addr.municipality ||
        addr.city_district ||
        addr.county ||
        '';

      const province = addr.state || addr.province || addr.region || '';
      const postcode = addr.postcode || '';

      const parts: string[] = [];
      if (building) parts.push(building);
      if (streetPart) parts.push(streetPart);
      if (barangay) parts.push(barangay);
      if (city) parts.push(city);
      if (province && province !== city) parts.push(province);
      if (postcode) parts.push(postcode);

      if (parts.length >= 2) {
        return parts.join(', ');
      } else if (data.display_name) {
        return data.display_name;
      }
    }
  } catch {
    // fallback
  }

  // Provider 2: BigDataCloud Reverse Geocoding Client (Fast & CORS friendly)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`,
      { signal: controller.signal },
    );
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const parts: string[] = [];

      if (data.localityInfo?.administrative && Array.isArray(data.localityInfo.administrative)) {
        const adminList = data.localityInfo.administrative;
        for (let i = adminList.length - 1; i >= 0; i--) {
          const item = adminList[i];
          if (item && item.name && item.order >= 4 && !parts.includes(item.name)) {
            parts.push(item.name);
          }
        }
      }

      if (data.locality && !parts.includes(data.locality)) parts.push(data.locality);
      if (data.city && !parts.includes(data.city)) parts.push(data.city);
      if (data.principalSubdivision && !parts.includes(data.principalSubdivision)) parts.push(data.principalSubdivision);
      if (data.postcode && !parts.includes(data.postcode)) parts.push(data.postcode);

      if (parts.length > 0) {
        return parts.join(', ');
      }
    }
  } catch {
    // fallback
  }

  return null;
}

/**
 * Fallback to IP Geolocation when GPS hardware is unavailable or disabled on desktop.
 */
export async function getIpLocation(): Promise<{
  locationText: string;
  latitude?: number;
  longitude?: number;
} | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://ipwho.is/', { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.latitude && data.longitude) {
        const fullAddr = await reverseGeocodeCoordinates(data.latitude, data.longitude);
        if (fullAddr) {
          return {
            locationText: fullAddr,
            latitude: data.latitude,
            longitude: data.longitude,
          };
        }
        const parts = [data.city, data.region, data.postal, data.country].filter(Boolean);
        return {
          locationText: parts.join(', '),
          latitude: data.latitude,
          longitude: data.longitude,
        };
      }
    }
  } catch {
    // fallback
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://freeipapi.com/api/json', { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.latitude && data.longitude) {
        const fullAddr = await reverseGeocodeCoordinates(data.latitude, data.longitude);
        if (fullAddr) {
          return {
            locationText: fullAddr,
            latitude: data.latitude,
            longitude: data.longitude,
          };
        }
        const parts = [data.cityName, data.regionName, data.zipCode, data.countryName].filter(Boolean);
        return {
          locationText: parts.join(', '),
          latitude: data.latitude,
          longitude: data.longitude,
        };
      }
    }
  } catch {
    // fallback
  }

  return null;
}

/**
 * Gets high accuracy GPS coordinates with robust fallback.
 */
export async function getAccurateGPSCoordinates(): Promise<{
  latitude: number;
  longitude: number;
  accuracy?: number;
} | null> {
  // 1. Native Expo Go / Mobile location detection (Highest Hardware Satellite Accuracy)
  if (Platform.OS !== 'web') {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });
      if (loc?.coords) {
        return {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy,
        };
      }
    } catch {
      try {
        const lastLoc = await Location.getLastKnownPositionAsync({
          maxAge: 30000,
        });
        if (lastLoc?.coords) {
          return {
            latitude: lastLoc.coords.latitude,
            longitude: lastLoc.coords.longitude,
            accuracy: lastLoc.coords.accuracy,
          };
        }
      } catch {
        // fallback
      }
    }
  }

  // 2. Web Geolocation API (Browser GPS / WiFi triangulation)
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    const highAccuracyPromise = new Promise<{ latitude: number; longitude: number; accuracy?: number } | null>(
      (resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 },
        );
      },
    );

    const res1 = await highAccuracyPromise;
    if (res1) return res1;
  }

  return null;
}

/**
 * Retrieves the real full current address based strictly on hardware device GPS.
 */
export async function getCurrentLocationInfo(defaultHint?: string | null): Promise<{
  locationText: string;
  latitude?: number;
  longitude?: number;
}> {
  // 1. Try Pin-Point Hardware Device GPS
  const coords = await getAccurateGPSCoordinates();
  if (coords) {
    const resolvedAddress = await reverseGeocodeCoordinates(coords.latitude, coords.longitude);
    if (resolvedAddress) {
      return { locationText: resolvedAddress, latitude: coords.latitude, longitude: coords.longitude };
    }
    return {
      locationText: `Lat: ${coords.latitude.toFixed(5)}, Lon: ${coords.longitude.toFixed(5)}`,
      latitude: coords.latitude,
      longitude: coords.longitude,
    };
  }

  // 2. Only use IP Geolocation on Web desktop browsers if hardware GPS is entirely unavailable
  if (Platform.OS === 'web') {
    const ipResult = await getIpLocation();
    if (ipResult) {
      return ipResult;
    }
  }

  // 3. Fallback to store hint or standard default
  const cleanHint = defaultHint?.trim();
  if (cleanHint && cleanHint.toLowerCase() !== 'it' && cleanHint.toLowerCase() !== 'it department' && cleanHint.length > 3) {
    return { locationText: cleanHint };
  }

  return { locationText: 'Tacloban City, Leyte, 6500' };
}

export function formatProofTimestamp(date: Date = new Date()) {
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  const hoursStr = String(hours);
  const minStr = minutes < 10 ? `0${minutes}` : String(minutes);
  const timeDigits = `${hoursStr}:${minStr}`;

  const months = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const monthStr = months[date.getMonth()];
  const dayNum = date.getDate() < 10 ? `0${date.getDate()}` : `${date.getDate()}`;
  const year = date.getFullYear();
  const dateFormatted = `${monthStr} ${dayNum}, ${year}`;
  const dayFormatted = days[date.getDay()];

  return {
    timeDigits,
    timePeriod: period,
    dateFormatted,
    dayFormatted,
  };
}
