import { Image } from 'react-native';

export const hygPortalLogo = require('../../assets/HYG LOGO.png');
export const hygPortalLogoMobile = require('../../assets/HYG LOGO mobile.png');

let preloadStarted = false;

export function preloadHygPortalLogo() {
  if (preloadStarted) return;
  preloadStarted = true;

  const resolved = Image.resolveAssetSource(hygPortalLogoMobile);
  if (resolved?.uri) {
    Image.prefetch(resolved.uri).catch(() => undefined);
  }
}
