import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';

import { colors, spacing } from '../theme';

export function SelectButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.selectButton} onPress={onPress}>
      <Text style={styles.selectButtonText}>{label}</Text>
    </Pressable>
  );
}

export function PickerField({
  value,
  onValueChange,
  options,
  disabledOptions = [],
  labels = {},
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
  disabledOptions?: string[];
  labels?: Record<string, string>;
}) {
  return (
    <View style={styles.pickerShell}>
      <Picker selectedValue={value} onValueChange={onValueChange} style={styles.picker}>
        {options.map((option) => (
          <Picker.Item
            key={option}
            label={disabledOptions.includes(option) ? `${labels[option] ?? option} - unavailable` : labels[option] ?? option}
            value={option}
            enabled={!disabledOptions.includes(option)}
          />
        ))}
      </Picker>
    </View>
  );
}

const styles = StyleSheet.create({
  pickerShell: {
    minHeight: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  picker: {
    minHeight: 48,
    color: colors.text,
  },
  selectButton: {
    minHeight: 48,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
  },
  selectButtonText: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
});
