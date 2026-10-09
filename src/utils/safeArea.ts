import { Platform } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

/**
 * Standard height of Android 3-button system navigation bar (Back, Home, Recents).
 * When 3-button navigation is active, Android draws a ~48dp bar at the bottom.
 */
export const ANDROID_3BUTTON_NAV_HEIGHT = 48;

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
 * Calculates safe bottom inset specifically for the bottom tab bar.
 * Avoids excessive blank space while ensuring clearance above the home indicator / navigation bar.
 */
export function getBottomTabBarSafeInset(insetsBottom: number): number {
  if (Platform.OS === 'android') {
    // On Android:
    // When 3-button navigation is enabled in edge-to-edge mode, insetsBottom is ~48dp,
    // providing full clearance above the Back, Home, and Recents buttons.
    // When gesture navigation is enabled, insetsBottom is ~16-24dp.
    // When non-edge-to-edge (system bar outside app window), insetsBottom is 0, using 6dp baseline.
    if (insetsBottom > 0) {
      return insetsBottom;
    }
    return 6;
  }

  // On iOS / Web:
  if (insetsBottom > 0) {
    // On iOS devices with home indicator (34px inset),
    // 24-26px gives comfortable clearance for the home indicator without excessive blank space.
    if (insetsBottom >= 30) {
      return Math.max(insetsBottom - 8, 22);
    }
    return insetsBottom;
  }
  return 6;
}

/**
 * Calculates total bottom tab bar height including safe area padding.
 */
export function getBottomTabBarHeight(insetsBottom: number): number {
  const safeBottom = getBottomTabBarSafeInset(insetsBottom);
  // Base tab bar container: 6dp top padding + 46dp tab button = 52dp
  return 52 + safeBottom;
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
