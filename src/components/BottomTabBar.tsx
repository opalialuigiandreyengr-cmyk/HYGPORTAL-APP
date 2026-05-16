import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Bell,
  CalendarDays,
  ClipboardList,
  FileText,
  Home,
  Plus,
  Tag,
  User,
  X,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontWeights, spacing } from '../theme';

export type TabKey = 'home' | 'requests' | 'approvals' | 'profile';

const tabs: { key: TabKey; label: string; icon: typeof Home }[] = [
  { key: 'home', label: 'Home', icon: Home },
  { key: 'requests', label: 'Requests', icon: ClipboardList },
  { key: 'approvals', label: 'Approvals', icon: Bell },
  { key: 'profile', label: 'Profile', icon: User },
];

type QuickActionKey = 'apply_esarf' | 'request_leave' | 'apply_discount';

const quickActions: { key: QuickActionKey; label: string; icon: typeof Home }[] = [
  { key: 'apply_esarf', label: 'Apply Esarf', icon: FileText },
  { key: 'request_leave', label: 'Request Leave', icon: CalendarDays },
  { key: 'apply_discount', label: 'Apply Discount', icon: Tag },
];

export function BottomTabBar({
  activeTab,
  onChange,
  onApplyEsarf,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
  onApplyEsarf?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionProgress = useRef(new Animated.Value(0)).current;
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [isActionMenuMounted, setIsActionMenuMounted] = useState(false);

  useEffect(() => {
    return () => {
      if (transitionTimer.current) {
        clearTimeout(transitionTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isActionMenuOpen) {
      setIsActionMenuMounted(true);
    }

    Animated.timing(actionProgress, {
      toValue: isActionMenuOpen ? 1 : 0,
      duration: isActionMenuOpen ? 180 : 130,
      easing: isActionMenuOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !isActionMenuOpen) {
        setIsActionMenuMounted(false);
      }
    });
  }, [actionProgress, isActionMenuOpen]);

  function changeTab(tab: TabKey) {
    if (tab === activeTab) {
      return;
    }

    setIsActionMenuOpen(false);

    if (transitionTimer.current) {
      clearTimeout(transitionTimer.current);
    }

    transitionTimer.current = setTimeout(() => onChange(tab), 90);
  }

  function toggleActionMenu() {
    setIsActionMenuOpen((current) => !current);
  }

  function handleQuickAction(key: QuickActionKey) {
    setIsActionMenuOpen(false);
    if (key === 'apply_esarf') {
      onApplyEsarf?.();
    }
  }

  const menuTranslateY = actionProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [14, 0],
  });

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      {isActionMenuMounted ? (
        <Pressable
          style={styles.dismissLayer}
          onPress={() => setIsActionMenuOpen(false)}
          pointerEvents={isActionMenuOpen ? 'auto' : 'none'}
        >
          <Animated.View style={[styles.dismissScrim, { opacity: actionProgress }]} />
        </Pressable>
      ) : null}

      {isActionMenuMounted ? (
        <Animated.View
          style={[
            styles.actionMenu,
            {
              bottom: Math.max(insets.bottom, 8) + 76,
              opacity: actionProgress,
              transform: [{ translateY: menuTranslateY }],
            },
          ]}
          pointerEvents={isActionMenuOpen ? 'auto' : 'none'}
        >
          {quickActions.map(({ key, label, icon: Icon }) => (
            <Pressable
              key={label}
              style={({ pressed }) => [styles.actionItem, pressed ? styles.actionItemPressed : null]}
              onPress={() => handleQuickAction(key)}
            >
              <View style={styles.actionIcon}>
                <Icon size={19} color={colors.brand.goldStrong} strokeWidth={2.5} />
              </View>
              <Text style={styles.actionLabel}>{label}</Text>
            </Pressable>
          ))}
        </Animated.View>
      ) : null}

      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {tabs.slice(0, 2).map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
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
              <Icon
                size={22}
                color={active ? colors.brand.gold : '#cbd5e1'}
                strokeWidth={active ? 2.8 : 2.3}
              />
              <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
            </Pressable>
          );
        })}

        <View style={styles.plusSlot}>
          <Pressable
            style={({ pressed }) => [
              styles.plusButton,
              isActionMenuOpen ? styles.plusButtonOpen : null,
              pressed ? styles.plusButtonPressed : null,
            ]}
            onPress={toggleActionMenu}
          >
            {isActionMenuOpen ? (
              <X size={25} color={colors.brand.ink} strokeWidth={2.8} />
            ) : (
              <Plus size={28} color={colors.brand.ink} strokeWidth={2.8} />
            )}
          </Pressable>
          <Text style={styles.plusLabel}>New</Text>
        </View>

        {tabs.slice(2).map(({ key, label, icon: Icon }) => {
          const active = activeTab === key;
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
              <Icon
                size={22}
                color={active ? colors.brand.gold : '#cbd5e1'}
                strokeWidth={active ? 2.8 : 2.3}
              />
              <Text style={[styles.label, active && styles.labelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
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
  dismissLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1000,
  },
  dismissScrim: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.24)',
  },
  actionMenu: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: '#dbe4ef',
    borderRadius: 8,
    padding: 8,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
  },
  actionItem: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  actionItemPressed: {
    backgroundColor: '#f1f5f9',
    transform: [{ scale: 0.99 }],
  },
  actionIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(250, 204, 21, 0.16)',
  },
  actionLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
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
  plusSlot: {
    width: 68,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
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
  plusButtonOpen: {
    backgroundColor: colors.brand.goldStrong,
  },
  plusButtonPressed: {
    transform: [{ scale: 0.94 }],
  },
  plusLabel: {
    color: colors.brand.gold,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: fontWeights.heavy,
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
