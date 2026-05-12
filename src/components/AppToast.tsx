import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react-native';

import { colors, fontWeights, radius, spacing } from '../theme';

export type AppToastMessage = {
  tone: 'success' | 'error' | 'warning';
  title: string;
  message: string;
};

export function AppToast({
  toast,
  onDismiss,
}: {
  toast: AppToastMessage | null;
  onDismiss: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(320)).current;
  const timerAnim = useRef(new Animated.Value(1)).current;
  const [visibleToast, setVisibleToast] = useState(toast);

  useEffect(() => {
    if (!toast) {
      if (visibleToast) {
        timerAnim.stopAnimation();
        Animated.timing(slideAnim, {
          toValue: -360,
          duration: 220,
          useNativeDriver: true,
        }).start(() => {
          setVisibleToast(null);
          slideAnim.setValue(320);
        });
      }
      return;
    }

    setVisibleToast(toast);
    slideAnim.setValue(320);
    timerAnim.setValue(1);
    Animated.spring(slideAnim, {
      toValue: 0,
      friction: 8,
      tension: 75,
      useNativeDriver: true,
    }).start();
    Animated.timing(timerAnim, {
      toValue: 0,
      duration: 3400,
      useNativeDriver: false,
    }).start();

    const timeout = setTimeout(onDismiss, 3400);
    return () => clearTimeout(timeout);
  }, [onDismiss, slideAnim, timerAnim, toast, visibleToast]);

  if (!visibleToast) {
    return null;
  }

  const toneStyles = getToneStyles(visibleToast.tone);

  return (
    <Animated.View style={[styles.toast, { transform: [{ translateX: slideAnim }] }]}>
      <Pressable style={[styles.toastInner, toneStyles.shell]} onPress={onDismiss}>
        <View style={[styles.toastIcon, toneStyles.iconShell]}>{toneStyles.icon}</View>
        <View style={styles.toastBody}>
          <Text style={styles.toastTitle}>{visibleToast.title}</Text>
          <Text style={styles.toastText}>{visibleToast.message}</Text>
        </View>
        <Pressable style={styles.toastClose} onPress={onDismiss} hitSlop={8}>
          <X size={16} color={colors.muted} strokeWidth={2.8} />
        </Pressable>
        <Animated.View
          style={[
            styles.toastTimer,
            toneStyles.timer,
            {
              width: timerAnim.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </Pressable>
    </Animated.View>
  );
}

function getToneStyles(tone: AppToastMessage['tone']) {
  if (tone === 'success') {
    return {
      shell: styles.toastSuccess,
      iconShell: styles.toastSuccessIcon,
      timer: styles.toastSuccessTimer,
      icon: <CheckCircle2 size={20} color={colors.semantic.success} strokeWidth={2.7} />,
    };
  }

  if (tone === 'warning') {
    return {
      shell: styles.toastWarning,
      iconShell: styles.toastWarningIcon,
      timer: styles.toastWarningTimer,
      icon: <Info size={20} color="#92400e" strokeWidth={2.7} />,
    };
  }

  return {
    shell: styles.toastError,
    iconShell: styles.toastErrorIcon,
    timer: styles.toastErrorTimer,
    icon: <AlertCircle size={20} color={colors.semantic.danger} strokeWidth={2.7} />,
  };
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: spacing.xl + spacing.sm,
    left: spacing.lg,
    right: 0,
    zIndex: 20,
    alignItems: 'flex-end',
  },
  toastInner: {
    width: '88%',
    maxWidth: 360,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    padding: spacing.sm,
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    overflow: 'hidden',
  },
  toastError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
  },
  toastWarning: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  toastSuccess: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  toastIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  toastErrorIcon: {
    backgroundColor: '#fee2e2',
  },
  toastWarningIcon: {
    backgroundColor: '#fef3c7',
  },
  toastSuccessIcon: {
    backgroundColor: '#dcfce7',
  },
  toastBody: {
    flex: 1,
  },
  toastTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    marginBottom: 2,
  },
  toastText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  toastClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  toastTimer: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 3,
  },
  toastErrorTimer: {
    backgroundColor: colors.semantic.danger,
  },
  toastWarningTimer: {
    backgroundColor: '#f59e0b',
  },
  toastSuccessTimer: {
    backgroundColor: colors.semantic.success,
  },
});
