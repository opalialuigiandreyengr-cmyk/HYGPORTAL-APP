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
export const FLOATING_TAB_BAR_HEIGHT = 56;

/**
 * Detects whether system navigation has the three physical or on-screen keys enabled
 * (Android 3-button navigation: Back, Home, Recents).
 * Works across Native Android as well as Web / PWA environments running on Android devices.
 * When 3-button navigation is active, the system navigation bar reserves at least 36-48dp.
 * Gesture navigation reserves much less (16-24dp) or 0dp.
 * Safe area handling on system navigation bar only applies when the three keys are enabled.
 */
export function isThreeKeyNavigation(insetsBottom: number): boolean {
  const isAndroid =
    Platform.OS === 'android' ||
    (Platform.OS === 'web' &&
      typeof navigator !== 'undefined' &&
      /android/i.test(navigator.userAgent || ''));

  return isAndroid && insetsBottom >= 36;
}

/**
 * Calculates a safe bottom inset.
 * Safe area handling on system navigation bar only applies when the three keys are enabled.
 * When three keys are not enabled (gesture navigation, iOS, Web), system navigation
 * safe area handling is omitted and the fallback is used.
 */
export function getSafeBottomInset(insetsBottom: number, fallback = 0): number {
  if (isThreeKeyNavigation(insetsBottom)) {
    return insetsBottom;
  }
  return fallback;
}

/**
 * Calculates safe bottom floating offset specifically for the floating bottom tab bar.
 * Safe area handling on the system navigation bar only applies when the three keys are enabled.
 * - When the three keys are enabled: provides clearance above the 3-button system navigation bar (insetsBottom + 8).
 * - When the three keys are not enabled (gesture navigation, iOS, Web): uses the standard floating offset (14dp).
 */
export function getFloatingTabBarBottomOffset(insetsBottom: number): number {
  if (isThreeKeyNavigation(insetsBottom)) {
    return insetsBottom + 8;
  }
  return 14;
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
 * Hook that returns safe area insets along with 3-button navigation-safe insets.
 */
export function useAppSafeAreaInsets() {
  const insets = useSafeAreaInsets();
  const isThreeKey = isThreeKeyNavigation(insets.bottom);
  const safeBottom = getSafeBottomInset(insets.bottom);
  const bottomTabBarHeight = getBottomTabBarHeight(insets.bottom);

  return {
    insets,
    top: insets.top,
    bottom: isThreeKey ? insets.bottom : 0,
    left: insets.left,
    right: insets.right,
    safeBottom,
    bottomTabBarHeight,
    isThreeKeyNavigation: isThreeKey,
    getScreenBottomPadding: (hasTabBar = false, extra = 20) =>
      getScreenBottomPadding(insets.bottom, hasTabBar, extra),
  };
}
