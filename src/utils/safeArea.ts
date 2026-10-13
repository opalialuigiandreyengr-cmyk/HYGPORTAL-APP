import { Platform } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

/**
 * Standard height of Android 3-button system navigation bar (Back, Home, Recents).
 * When 3-button navigation is active, Android draws a ~48dp bar at the bottom.
 */
export const ANDROID_3BUTTON_NAV_HEIGHT = 48;

/**
 * Height of the floating bottom tab bar container itself.
 */
export const FLOATING_TAB_BAR_HEIGHT = 64;

/**
 * Calculates a safe bottom inset.
 * Returns the reported bottom inset (e.g. from react-native-safe-area-context / iOS home indicator / gesture bar),
 * or falls back to a minimum inset when unmeasured (e.g. 0 on web/desktop).
 */
export function getSafeBottomInset(insetsBottom: number, fallback = 0): number {
  if (insetsBottom > 0) {
    return insetsBottom;
  }
  return fallback;
}

/**
 * Calculates safe bottom floating offset specifically for the floating bottom tab bar.
 * Ensures clean, responsive clearance above the home indicator, 3-button navigation, or screen bottom,
 * including seamless support for iOS Safari and standalone PWA modes.
 */
export function getFloatingTabBarBottomOffset(insetsBottom: number): number {
  if (Platform.OS === 'android') {
    // When 3-button navigation or gesture nav is active in edge-to-edge mode:
    if (insetsBottom > 0) {
      return insetsBottom + 8;
    }
    return 14;
  }

  // On native iOS:
  if (Platform.OS === 'ios') {
    if (insetsBottom > 0) {
      return insetsBottom + 8;
    }
    return 14;
  }

  // On Web / PWA:
  if (Platform.OS === 'web') {
    if (insetsBottom > 0) {
      return insetsBottom + 8;
    }

    // Detect if running on an iOS device (iPhone/iPad) in browser or installed PWA
    const isIosWeb =
      typeof navigator !== 'undefined' &&
      (/iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

    if (isIosWeb) {
      // Check if running in standalone PWA mode (added to home screen)
      const isStandalonePwa =
        (typeof window !== 'undefined' && (window.navigator as any)?.standalone === true) ||
        (typeof window !== 'undefined' &&
          window.matchMedia?.('(display-mode: standalone)').matches);

      // In iOS standalone PWA with Face ID, the Home Indicator takes ~34px.
      // Floating 8px above it yields 42px clearance.
      // In Safari browser mode, 20px provides clean clearance above the toolbar.
      return isStandalonePwa ? 42 : 20;
    }

    return 14;
  }

  return insetsBottom > 0 ? insetsBottom + 8 : 14;
}

/**
 * Calculates safe bottom inset specifically for the bottom tab bar.
 * Retained for backwards compatibility with any existing imports.
 */
export function getBottomTabBarSafeInset(insetsBottom: number): number {
  return getFloatingTabBarBottomOffset(insetsBottom);
}

/**
 * Calculates total bottom tab bar height including its floating offset from screen bottom.
 * Used by screens and DashboardFab to avoid any overlapping.
 */
export function getBottomTabBarHeight(insetsBottom: number): number {
  const bottomOffset = getFloatingTabBarBottomOffset(insetsBottom);
  return FLOATING_TAB_BAR_HEIGHT + bottomOffset;
}

/**
 * Calculates scroll view contentContainerStyle bottom padding.
 * - If screen has BottomTabBar: provides tab bar height + extra padding so the bottom-most items scroll clear of the tab bar.
 * - If screen does not have BottomTabBar: provides safeBottom + extra padding so items scroll clear of the navigation bar.
 */
export function getScreenBottomPadding(insetsBottom: number, hasTabBar = false, extra = 20): number {
  if (hasTabBar) {
    return getBottomTabBarHeight(insetsBottom) + extra;
  }
  return getSafeBottomInset(insetsBottom, 16) + extra;
}

/**
 * Hook that returns safe area insets along with Android 3-button navigation-safe insets.
 */
export function useAppSafeAreaInsets() {
  const insets = useSafeAreaInsets();
  const safeBottom = getSafeBottomInset(insets.bottom);
  const bottomTabBarHeight = getBottomTabBarHeight(insets.bottom);

  return {
    insets,
    top: insets.top,
    bottom: insets.bottom,
    left: insets.left,
    right: insets.right,
    safeBottom,
    bottomTabBarHeight,
    getScreenBottomPadding: (hasTabBar = false, extra = 20) =>
      getScreenBottomPadding(insets.bottom, hasTabBar, extra),
  };
}
