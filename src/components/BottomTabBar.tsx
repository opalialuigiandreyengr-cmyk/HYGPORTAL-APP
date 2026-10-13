import React, { useRef } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  Bell,
  Bot,
  ClipboardList,
  Gift,
  Home,
  Tag,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontWeights } from '../theme';
import {
  FLOATING_TAB_BAR_HEIGHT,
  getFloatingTabBarBottomOffset,
} from '../utils/safeArea';

export type TabKey =
  | 'home'
  | 'requests'
  | 'approvals'
  | 'notifications'
  | 'perks'
  | 'profile'
  | 'settings'
  | 'rewards'
  | 'my_team';

type TabDefinition = {
  key: TabKey;
  label: string;
  icon: typeof Home;
};

const allTabs: TabDefinition[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'requests', label: 'Requests', icon: ClipboardList },
  { key: 'approvals', label: 'Approvals', icon: Bell },
  { key: 'perks', label: 'Perks', icon: Tag },
  { key: 'rewards', label: 'Rewards', icon: Gift },
];

export function BottomTabBar({
  activeTab,
  onChange,
  onAssistant,
  requestCount = 0,
  approvalCount = 0,
  showApprovals = true,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
  onAssistant?: () => void;
  requestCount?: number;
  approvalCount?: number;
  showApprovals?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  // Screen responsiveness calculations to prevent any overlapping
  const isSmallScreen = windowWidth < 375;
  const isTablet = windowWidth >= 600;

  const horizontalMargin = isTablet ? 0 : isSmallScreen ? 10 : 14;
  const maxBarWidth = 480;
  const barWidth = isTablet
    ? maxBarWidth
    : Math.min(windowWidth - horizontalMargin * 2, maxBarWidth);

  const floatingBottom = getFloatingTabBarBottomOffset(insets.bottom);

  const leftTabs = allTabs.slice(0, 2);
  const rightTabs = [
    showApprovals
      ? allTabs.find((t) => t.key === 'approvals')!
      : allTabs.find((t) => t.key === 'perks')!,
    allTabs.find((t) => t.key === 'rewards')!,
  ];

  function handleTabPress(tabKey: TabKey) {
    if (tabKey === activeTab) return;
    onChange(tabKey);
  }

  const renderTab = ({ key, label, icon: Icon }: TabDefinition) => {
    const active = activeTab === key;
    const count =
      key === 'requests'
        ? requestCount
        : key === 'approvals'
        ? approvalCount
        : 0;

    const iconColor = active ? '#FACC15' : '#f1f5f9';
    const textColor = active ? '#FACC15' : '#cbd5e1';
    const iconSize = isSmallScreen ? 18 : 20;
    const labelFontSize = isSmallScreen ? 9.5 : 10.5;

    return (
      <Pressable
        key={key}
        style={({ pressed }) => [
          styles.tabPressable,
          pressed && styles.tabPressed,
        ]}
        onPress={() => handleTabPress(key)}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      >
        <View
          style={[
            styles.tabContentCapsule,
            active ? styles.tabContentCapsuleActive : styles.tabContentCapsuleInactive,
            isSmallScreen && styles.tabContentCapsuleSmall,
          ]}
        >
          <View style={styles.iconSlot}>
            <Icon
              size={iconSize}
              color={iconColor}
              strokeWidth={active ? 2.4 : 2.1}
            />
            {count > 0 ? <TabBadge count={count} /> : null}
          </View>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            adjustsFontSizeToFit={true}
            minimumFontScale={0.8}
            style={[
              styles.label,
              { fontSize: labelFontSize, color: textColor },
              active && styles.labelActive,
            ]}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    );
  };

  const centerButtonSize = isSmallScreen ? 42 : 46;
  const botIconSize = isSmallScreen ? 22 : 24;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View
        style={[
          styles.floatingBar,
          {
            bottom: floatingBottom,
            width: barWidth,
          },
        ]}
        pointerEvents="auto"
      >
        {/* Left Tabs (Home, Requests) */}
        {leftTabs.map(renderTab)}

        {/* Center Assistant Bot Button */}
        <View
          style={[
            styles.centerSlot,
            { width: isSmallScreen ? 48 : 54 },
          ]}
        >
          <Pressable
            style={({ pressed }) => [
              styles.centerButton,
              {
                width: centerButtonSize,
                height: centerButtonSize,
                borderRadius: centerButtonSize / 2,
              },
              !onAssistant && styles.centerButtonDisabled,
              pressed && styles.centerButtonPressed,
            ]}
            onPress={onAssistant}
            disabled={!onAssistant}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Bot
              size={botIconSize}
              color="#071426"
              strokeWidth={2.6}
            />
          </Pressable>
        </View>

        {/* Right Tabs (Perks/Approvals, Rewards) */}
        {rightTabs.map(renderTab)}
      </View>
    </View>
  );
}

function TabBadge({ count }: { count: number }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    backgroundColor: 'transparent',
    zIndex: 90,
  },
  floatingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: FLOATING_TAB_BAR_HEIGHT,
    backgroundColor: '#09121f',
    borderRadius: 34,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 14,
    elevation: 14,
    ...(Platform.OS === 'web'
      ? ({
          userSelect: 'none',
          WebkitUserSelect: 'none',
        } as any)
      : {}),
  },
  tabPressable: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web'
      ? ({
          cursor: 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        } as any)
      : {}),
  },
  tabPressed: {
    opacity: 0.75,
    transform: [{ scale: 0.96 }],
  },
  tabContentCapsule: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 78,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 22,
    borderWidth: 0.75,
    borderColor: 'transparent',
  },
  tabContentCapsuleSmall: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    maxWidth: 68,
  },
  tabContentCapsuleActive: {
    borderColor: 'rgba(250, 204, 21, 0.38)',
    backgroundColor: 'rgba(250, 204, 21, 0.06)',
  },
  tabContentCapsuleInactive: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  iconSlot: {
    width: 26,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    borderWidth: 1.5,
    borderColor: '#09121f',
    zIndex: 5,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 8.5,
    lineHeight: 11,
    fontWeight: fontWeights.heavy,
  },
  centerSlot: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  centerButton: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FACC15',
    shadowColor: '#FACC15',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
    ...(Platform.OS === 'web'
      ? ({
          cursor: 'pointer',
          userSelect: 'none',
          WebkitUserSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        } as any)
      : {}),
  },
  centerButtonDisabled: {
    opacity: 0.45,
  },
  centerButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.92,
  },
  label: {
    marginTop: 2,
    lineHeight: 13,
    fontWeight: fontWeights.semibold,
    textAlign: 'center',
  },
  labelActive: {
    fontWeight: fontWeights.bold,
  },
});
