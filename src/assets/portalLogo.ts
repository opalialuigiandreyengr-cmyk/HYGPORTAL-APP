import { Image, Platform } from 'react-native';

export const hygPortalLogo = require('../../assets/HYG LOGO.png');
export const hygPortalLogoMobile = require('../../assets/HYG LOGO mobile.png');

let preloadStarted = false;

export function preloadHygPortalLogo() {
  if (preloadStarted) return;
  preloadStarted = true;

  if (Platform.OS === 'web') return;

  const resolved = Image.resolveAssetSource(hygPortalLogoMobile);
  if (resolved?.uri) {
    Image.prefetch(resolved.uri).catch(() => undefined);
  }
}
