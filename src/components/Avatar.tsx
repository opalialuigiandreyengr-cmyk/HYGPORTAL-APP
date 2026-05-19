import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, fontWeights } from '../theme';

type Props = {
  name?: string | null;
  photoUrl?: string | null;
  size?: number;
  textSize?: number;
  borderRadius?: number;
  textColor?: string;
};

export function Avatar({
  name,
  photoUrl,
  size = 34,
  textSize = 13,
  borderRadius = size / 2,
  textColor = colors.brand.white,
}: Props) {
  const initials = getNameInitials(name);

  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius }]}>
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.image} />
      ) : (
        <Text style={[styles.text, { fontSize: textSize, color: textColor }]}>{initials}</Text>
      )}
    </View>
  );
}

export function getNameInitials(name?: string | null) {
  const parts = (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

const styles = StyleSheet.create({
  avatar: {
    backgroundColor: colors.brand.panel,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  text: {
    fontWeight: fontWeights.bold,
  },
});
