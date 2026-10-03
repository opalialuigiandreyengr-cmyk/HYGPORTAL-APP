import { Platform } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

/**
 * Standard height of Android 3-button system navigation bar (Back, Home, Recents).
 * When 3-button navigation is active, Android draws a ~48dp bar at the bottom.
 */
export const ANDROID_3BUTTON_NAV_HEIGHT = 48;

/**
 * Calculates a safe bottom inset.
 * On Android, guarantees at least 48dp so the 3-button system navigation bar
 * (Back, Home, Recents) never covers or overlaps bottom elements (tab bar, buttons, footers).
 */
export function getSafeBottomInset(insetsBottom: number, fallback = 0): number {
  if (Platform.OS === 'android') {
    // If insetsBottom is already reported (> 0), use the larger of insetsBottom or 48.
    // If insetsBottom is 0 (unreported / edge-to-edge), fallback to 48dp.
    return Math.max(insetsBottom, ANDROID_3BUTTON_NAV_HEIGHT);
  }
  return Math.max(insetsBottom, fallback);
}

/**
 * Calculates total bottom tab bar height including safe area padding.
 */
export function getBottomTabBarHeight(insetsBottom: number): number {
  const safeBottom = getSafeBottomInset(insetsBottom, 8);
  // Base tab bar container: 8dp top padding + 52dp tab button minHeight = 60dp
  return 60 + safeBottom;
}

/**
 * Calculates scroll view contentContainerStyle bottom padding.
 * - If screen has BottomTabBar: provides tab bar height + extra padding so the bottom-most items scroll clear of the tab bar.
 * - If screen does not have BottomTabBar: provides safeBottom + extra padding so items scroll clear of the 3-button navigation bar.
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
