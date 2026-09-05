import React, { useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Camera, Plus } from 'lucide-react-native';
import Svg, { Line, Rect } from 'react-native-svg';

type DashboardFabProps = {
  onPhotoProof?: () => void;
  onPhotoLog?: () => void;
  onActivityLog?: () => void;
};

export function DashboardFab({ onPhotoProof, onPhotoLog, onActivityLog }: DashboardFabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const animation = useRef(new Animated.Value(0)).current;

  const toggleMenu = () => {
    const toValue = isOpen ? 0 : 1;
    setIsOpen(!isOpen);

    Animated.spring(animation, {
      toValue,
      friction: 6,
      tension: 45,
      useNativeDriver: true,
    }).start();
  };

  const closeMenu = () => {
    if (!isOpen) return;
    setIsOpen(false);
    Animated.timing(animation, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  };

  const handlePhotoProofPress = () => {
    closeMenu();
    onPhotoProof?.();
  };

  const handlePhotoLogPress = () => {
    closeMenu();
    if (onPhotoLog) {
      onPhotoLog();
    } else {
      onActivityLog?.();
    }
  };

  const rotation = animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  const photoProofTranslateX = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -72],
  });
  const photoProofTranslateY = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -38],
  });
  const photoProofScale = animation.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0.6, 1],
  });
  const photoProofOpacity = animation.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 0.8, 1],
  });

  const activityLogTranslateX = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -32],
  });
  const activityLogTranslateY = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -92],
  });
  const activityLogScale = animation.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0, 0.6, 1],
  });
  const activityLogOpacity = animation.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0, 0.8, 1],
  });

  return (
    <View style={styles.overlayContainer} pointerEvents="box-none">
      {isOpen && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={closeMenu}
        />
      )}

      {/* Activity Log Action Button */}
      <Animated.View
        style={[
          styles.subActionWrapper,
          {
            opacity: activityLogOpacity,
            transform: [
              { translateX: activityLogTranslateX },
              { translateY: activityLogTranslateY },
              { scale: activityLogScale },
            ],
          },
        ]}
        pointerEvents={isOpen ? 'auto' : 'none'}
      >
        <Pressable
          style={({ pressed }) => [
            styles.subActionButton,
            pressed ? styles.subButtonPressed : null,
          ]}
          onPress={handlePhotoLogPress}
          disabled={!isOpen}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Svg
            width={24}
            height={24}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#000000"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Rect x="4" y="3" width="16" height="18" rx="2" strokeWidth={2.2} />
            <Line x1="8" y1="8" x2="8.01" y2="8" strokeWidth={3} />
            <Line x1="12" y1="8" x2="16" y2="8" strokeWidth={2.2} />
            <Line x1="8" y1="12" x2="8.01" y2="12" strokeWidth={3} />
            <Line x1="12" y1="12" x2="16" y2="12" strokeWidth={2.2} />
            <Line x1="8" y1="16" x2="8.01" y2="16" strokeWidth={3} />
            <Line x1="12" y1="16" x2="16" y2="16" strokeWidth={2.2} />
          </Svg>
        </Pressable>
      </Animated.View>

      {/* Photo Proof Action Button */}
      <Animated.View
        style={[
          styles.subActionWrapper,
          {
            opacity: photoProofOpacity,
            transform: [
              { translateX: photoProofTranslateX },
              { translateY: photoProofTranslateY },
              { scale: photoProofScale },
            ],
          },
        ]}
        pointerEvents={isOpen ? 'auto' : 'none'}
      >
        <Pressable
          style={({ pressed }) => [
            styles.subActionButton,
            pressed ? styles.subButtonPressed : null,
          ]}
          onPress={handlePhotoProofPress}
          disabled={!isOpen}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Camera size={24} color="#000000" strokeWidth={2.4} />
        </Pressable>
      </Animated.View>

      {/* Main Floating Action Button */}
      <View style={styles.mainButtonWrapper} pointerEvents="box-none">
        <Pressable
          style={({ pressed }) => [
            styles.mainButton,
            pressed ? styles.mainButtonPressed : null,
          ]}
          onPress={toggleMenu}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Animated.View style={{ transform: [{ rotate: rotation }] }}>
            <Plus size={34} color="#ffffff" strokeWidth={3.5} />
          </Animated.View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayContainer: {
    ...StyleSheet.absoluteFill,
    zIndex: 99,
  },
  subActionWrapper: {
    position: 'absolute',
    right: 25,
    bottom: 97,
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    elevation: 8,
  },
  subActionButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 6,
  },
  subButtonPressed: {
    transform: [{ scale: 0.92 }],
    backgroundColor: '#f8fafc',
  },
  mainButtonWrapper: {
    position: 'absolute',
    right: 20,
    bottom: 92,
    width: 62,
    height: 62,
    zIndex: 101,
    elevation: 10,
  },
  mainButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#f5af00',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 8,
  },
  mainButtonPressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.92,
  },
});
