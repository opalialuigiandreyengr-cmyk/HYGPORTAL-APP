import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Bell,
  Bot,
  ClipboardList,
  Gift,
  Home,
  Tag,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontWeights, spacing } from '../theme';

export type TabKey = 'home' | 'requests' | 'approvals' | 'notifications' | 'perks' | 'profile' | 'settings' | 'rewards' | 'my_team';

const tabs: { key: TabKey; label: string; icon: typeof Home }[] = [
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
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function changeTab(tab: TabKey) {
    if (tab === activeTab) {
      return;
    }

    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
    }

    transitionTimer.current = setTimeout(() => onChange(tab), 90);
  }
  const leftTabs = tabs.slice(0, 2);
  const rightTabs = [
    showApprovals ? tabs.find((tab) => tab.key === 'approvals')! : tabs.find((tab) => tab.key === 'perks')!,
    tabs.find((tab) => tab.key === 'rewards')!,
  ];

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {leftTabs.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          const count = key === 'requests' ? requestCount : key === 'approvals' ? approvalCount : 0;
          return (
            <Pressable
              key={key}
              style={({ pressed }) => [
                styles.tab,
                active ? styles.tabActive : null,
                pressed ? styles.tabPressed : null,
              ]}
              onPress={() => changeTab(key)}
            >
              <View style={styles.iconSlot}>
                <Icon
                  size={22}
                  color={active ? colors.brand.gold : '#cbd5e1'}
                  strokeWidth={active ? 2.8 : 2.3}
                />
                {count > 0 ? <TabBadge count={count} /> : null}
              </View>
              <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
            </Pressable>
          );
        })}

        <View style={styles.plusSlot}>
          <Pressable
            style={({ pressed }) => [
              styles.plusButton,
              !onAssistant ? styles.plusButtonDisabled : null,
              pressed ? styles.plusButtonPressed : null,
            ]}
            onPress={onAssistant}
            disabled={!onAssistant}
          >
            <Bot size={30} color={colors.brand.ink} strokeWidth={2.8} />
          </Pressable>
        </View>

        {rightTabs.map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
          const count = key === 'approvals' ? approvalCount : 0;
          return (
            <Pressable
              key={key}
              style={({ pressed }) => [
                styles.tab,
                active ? styles.tabActive : null,
                pressed ? styles.tabPressed : null,
              ]}
              onPress={() => changeTab(key)}
            >
              <View style={styles.iconSlot}>
                <Icon
                  size={22}
                  color={active ? colors.brand.gold : '#cbd5e1'}
                  strokeWidth={active ? 2.8 : 2.3}
                />
                {count > 0 ? <TabBadge count={count} /> : null}
              </View>
              <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
            </Pressable>
          );
        })}
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
  },
  container: {
    flexDirection: 'row',
    backgroundColor: '#071426',
    borderTopWidth: 1,
    borderTopColor: '#173152',
    paddingTop: 8,
    paddingHorizontal: 8,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
  tab: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 8,
    paddingVertical: 5,
  },
  tabActive: {
    backgroundColor: 'rgba(250, 204, 21, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(250, 204, 21, 0.28)',
  },
  tabPressed: {
    opacity: 0.78,
    transform: [{ scale: 0.96 }],
  },
  iconSlot: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -7,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ef4444',
    borderWidth: 1,
    borderColor: '#071426',
  },
  badgeText: {
    color: colors.surface,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: fontWeights.heavy,
  },
  plusSlot: {
    width: 68,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  plusButton: {
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 25,
    backgroundColor: colors.brand.gold,
    borderWidth: 3,
    borderColor: '#071426',
    marginTop: -24,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
  },
  plusButtonDisabled: {
    opacity: 0.52,
  },
  plusButtonPressed: {
    transform: [{ scale: 0.94 }],
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
    color: '#cbd5e1',
  },
  labelActive: {
    color: colors.brand.gold,
    fontWeight: fontWeights.heavy,
  },
});
