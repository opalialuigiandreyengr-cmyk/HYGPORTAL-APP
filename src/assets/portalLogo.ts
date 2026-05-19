import { Image } from 'react-native';

export const hygPortalLogo = require('../../assets/HYG LOGO.png');

let preloadStarted = false;

export function preloadHygPortalLogo() {
  if (preloadStarted) return;
  preloadStarted = true;

  const resolved = Image.resolveAssetSource(hygPortalLogo);
  if (resolved?.uri) {
    Image.prefetch(resolved.uri).catch(() => undefined);
  }
}
