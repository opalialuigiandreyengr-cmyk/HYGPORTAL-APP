import { Linking, Platform } from 'react-native';

export const APK_DOWNLOAD_FILENAME = 'hygportal.apk';
export const APK_DOWNLOAD_URL = 'https://hygportal.vercel.app/hygportal.apk';
const PWA_SERVICE_WORKER_VERSION = '20260616-v1.5.8';
export const PWA_VERSION = '1.5.9';

type InstallPlatform = 'android' | 'ios' | 'other';

export function getInstallPlatform(): InstallPlatform {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') {
    return Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'other';
  }

  const userAgent = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const isIpadOs = platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  if (/Android/i.test(userAgent)) {
    return 'android';
  }

  if (/iPhone|iPad|iPod/i.test(userAgent) || isIpadOs) {
    return 'ios';
  }

  return 'other';
}

export function isPwaInstalled() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  const standaloneNavigator = navigator as Navigator & { standalone?: boolean };

  return window.matchMedia?.('(display-mode: standalone)').matches || standaloneNavigator.standalone === true;
}

export function getInstallCopy() {
  const platform = getInstallPlatform();

  if (platform === 'ios') {
    return {
      subtitle: 'iPhone web app',
      action: 'Install',
    };
  }

  if (platform === 'android') {
    return {
      subtitle: 'Android app installer',
      action: 'Download',
    };
  }

  return {
    subtitle: 'Android APK or iPhone web app',
    action: 'Install',
  };
}

export function registerPwaInstallSupport() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return;
  }

  ensureLink('manifest', '/manifest.json');
  ensureLink('apple-touch-icon', '/apple-touch-icon.png');
  ensureMeta('apple-mobile-web-app-capable', 'yes');
  ensureMeta('apple-mobile-web-app-title', 'HYG Portal');
  ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  ensureMeta('theme-color', '#071426');

  if ('serviceWorker' in navigator) {
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) {
        return;
      }

      refreshing = true;
      window.location.reload();
    });

    const registerSW = () => {
      void navigator.serviceWorker.register(`/sw.js?v=${PWA_SERVICE_WORKER_VERSION}`).then((registration) => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        registration.addEventListener('updatefound', () => {
          const nextWorker = registration.installing;
          if (!nextWorker) {
            return;
          }

          nextWorker.addEventListener('statechange', () => {
            if (nextWorker.state === 'installed' && navigator.serviceWorker.controller) {
              nextWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      });
    };

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
      registerSW();
    } else {
      window.addEventListener('load', registerSW);
    }
  }
}

export function openPlatformInstall() {
  const platform = getInstallPlatform();

  if (platform === 'ios' && Platform.OS === 'web') {
    showPwaInstallInstructions();
    return;
  }

  openApkDownload();
}

export function openApkDownload() {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const anchor = document.createElement('a');
    anchor.href = '/hygportal.apk';
    anchor.download = APK_DOWNLOAD_FILENAME;
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }

  void Linking.openURL(APK_DOWNLOAD_URL);
}

function showPwaInstallInstructions() {
  const message = 'To install HYG Portal on iPhone: open this site in Safari, tap Share, then tap Add to Home Screen.';

  if (typeof window !== 'undefined') {
    window.alert(message);
  }
}

function ensureLink(rel: string, href: string) {
  if (document.querySelector(`link[rel="${rel}"][href="${href}"]`)) {
    return;
  }

  const link = document.createElement('link');
  link.rel = rel;
  link.href = href;
  document.head.appendChild(link);
}

function ensureMeta(name: string, content: string) {
  const existing = document.querySelector(`meta[name="${name}"]`);
  if (existing) {
    existing.setAttribute('content', content);
    return;
  }

  const meta = document.createElement('meta');
  meta.name = name;
  meta.content = content;
  document.head.appendChild(meta);
}
