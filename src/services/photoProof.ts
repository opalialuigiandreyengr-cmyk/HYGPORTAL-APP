import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';

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
};

const PHOTO_PROOFS_KEY = 'hyg_photo_proofs_list';

export async function loadPhotoProofs(): Promise<PhotoProofItem[]> {
  try {
    const list = await getCacheJSON<PhotoProofItem[]>(PHOTO_PROOFS_KEY);
    if (!list || !Array.isArray(list)) {
      return [];
    }
    return list.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  } catch (err) {
    console.error('Failed to load photo proofs:', err);
    return [];
  }
}

export async function savePhotoProof(item: PhotoProofItem): Promise<void> {
  try {
    const current = await loadPhotoProofs();
    const updated = [item, ...current.filter((p) => p.id !== item.id)];
    await setCacheJSON(PHOTO_PROOFS_KEY, updated);
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
    const cameraStatus = await ImagePicker.requestCameraPermissionsAsync();
    cameraGranted = cameraStatus.granted;
  } catch {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.mediaDevices) {
      cameraGranted = true;
    }
  }

  // 2. Location permission
  try {
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      locationGranted = await new Promise<boolean>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(true),
          { timeout: 5000, enableHighAccuracy: true, maximumAge: 0 },
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
  // 1. Primary: OpenStreetMap Nominatim with full address details
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: { 'Accept-Language': 'en' },
        signal: controller.signal,
      },
    );
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.display_name) {
        return data.display_name;
      }

      const addr = data.address || {};
      const building = addr.amenity || addr.shop || addr.building || addr.office || addr.tourism || '';
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

      if (parts.length > 0) {
        return parts.join(', ');
      }
    }
  } catch (err) {
    // fallback
  }

  // 2. Secondary: BigDataCloud Reverse Geocoding Client
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
      if (data.locality) parts.push(data.locality);
      if (data.city && data.city !== data.locality) parts.push(data.city);
      if (data.principalSubdivision) parts.push(data.principalSubdivision);
      if (data.postcode) parts.push(data.postcode);

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
 * Retrieves the real full current address based on live device location or IP geo-fallback.
 */
export async function getCurrentLocationInfo(defaultHint?: string | null): Promise<{
  locationText: string;
  latitude?: number;
  longitude?: number;
}> {
  // 1. Try Browser / Device Geolocation
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    const devicePos = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(pos),
        () => {
          // If high accuracy failed or timed out, try standard accuracy
          navigator.geolocation.getCurrentPosition(
            (pos2) => resolve(pos2),
            () => resolve(null),
            { enableHighAccuracy: false, timeout: 6000, maximumAge: 0 },
          );
        },
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
      );
    });

    if (devicePos?.coords) {
      const { latitude, longitude } = devicePos.coords;
      const resolvedAddress = await reverseGeocodeCoordinates(latitude, longitude);
      if (resolvedAddress) {
        return { locationText: resolvedAddress, latitude, longitude };
      }
    }
  }

  // 2. Fallback to IP Geolocation if device GPS is slow or unavailable
  const ipResult = await getIpLocation();
  if (ipResult) {
    return ipResult;
  }

  // 3. Fallback to valid clean store hint or standard default
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
