import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Check, Clock, X } from 'lucide-react-native';
import { colors, fontWeights, radius, spacing } from '../theme';
import { formatTimeDisplay } from '../utils/dateTime';

type WebTimePickerModalProps = {
  visible: boolean;
  title: string;
  value: string; // "HH:mm"
  onConfirm: (time24: string) => void;
  onClose: () => void;
};

const hoursList = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const minutesList = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

const commonPresets = [
  { label: '06:00 AM', value: '06:00' },
  { label: '07:00 AM', value: '07:00' },
  { label: '07:30 AM', value: '07:30' },
  { label: '08:00 AM', value: '08:00' },
  { label: '08:30 AM', value: '08:30' },
  { label: '09:00 AM', value: '09:00' },
  { label: '12:00 PM', value: '12:00' },
  { label: '01:00 PM', value: '13:00' },
  { label: '04:00 PM', value: '16:00' },
  { label: '05:00 PM', value: '17:00' },
  { label: '05:30 PM', value: '17:30' },
  { label: '06:00 PM', value: '18:00' },
  { label: '06:30 PM', value: '18:30' },
  { label: '07:00 PM', value: '19:00' },
  { label: '08:00 PM', value: '20:00' },
  { label: '09:00 PM', value: '21:00' },
];

export function parseTime24To12(value: string) {
  if (!value) {
    return { hour12: 8, minute: 0, period: 'AM' as const };
  }
  const [rawHour, rawMinute] = value.split(':').map(Number);
  const h = Number.isNaN(rawHour) ? 8 : rawHour;
  const m = Number.isNaN(rawMinute) ? 0 : rawMinute;
  const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 || 12;
  return { hour12, minute: m, period };
}

export function formatTime12To24(hour12: number, minute: number, period: 'AM' | 'PM') {
  let h = hour12 % 12;
  if (period === 'PM') {
    h += 12;
  }
  const hStr = String(h).padStart(2, '0');
  const mStr = String(minute).padStart(2, '0');
  return `${hStr}:${mStr}`;
}

export function WebTimePickerModal({
  visible,
  title,
  value,
  onConfirm,
  onClose,
}: WebTimePickerModalProps) {
  const parsed = parseTime24To12(value);
  const [selectedHour, setSelectedHour] = useState(parsed.hour12);
  const [selectedMinute, setSelectedMinute] = useState(parsed.minute);
  const [selectedPeriod, setSelectedPeriod] = useState<'AM' | 'PM'>(parsed.period);

  useEffect(() => {
    if (visible) {
      const p = parseTime24To12(value);
      setSelectedHour(p.hour12);
      setSelectedMinute(p.minute);
      setSelectedPeriod(p.period);
    }
  }, [visible, value]);

  if (!visible) return null;

  const current24 = formatTime12To24(selectedHour, selectedMinute, selectedPeriod);
  const currentDisplay = formatTimeDisplay(current24);

  function handleSelectPreset(presetValue: string) {
    onConfirm(presetValue);
    onClose();
  }

  function handleDone() {
    onConfirm(current24);
    onClose();
  }

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.container}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Clock size={20} color={colors.primary} />
              <Text style={styles.title}>{title}</Text>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose}>
              <X size={18} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.displayCard}>
            <Text style={styles.displayLabel}>Selected Time</Text>
            <Text style={styles.displayText}>{currentDisplay}</Text>
          </View>

          <View style={styles.pickerRow}>
            {/* Hour column */}
            <View style={styles.column}>
              <Text style={styles.columnLabel}>Hour</Text>
              <ScrollView style={styles.columnScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                {hoursList.map((h) => {
                  const active = h === selectedHour;
                  return (
                    <Pressable
                      key={h}
                      style={[styles.itemChip, active ? styles.itemChipActive : null]}
                      onPress={() => setSelectedHour(h)}
                    >
                      <Text style={[styles.itemChipText, active ? styles.itemChipTextActive : null]}>
                        {String(h).padStart(2, '0')}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Minute column */}
            <View style={styles.column}>
              <Text style={styles.columnLabel}>Min</Text>
              <ScrollView style={styles.columnScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                {minutesList.map((m) => {
                  const active = m === selectedMinute;
                  return (
                    <Pressable
                      key={m}
                      style={[styles.itemChip, active ? styles.itemChipActive : null]}
                      onPress={() => setSelectedMinute(m)}
                    >
                      <Text style={[styles.itemChipText, active ? styles.itemChipTextActive : null]}>
                        {String(m).padStart(2, '0')}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* AM / PM column */}
            <View style={styles.column}>
              <Text style={styles.columnLabel}>Period</Text>
              <View style={styles.periodGroup}>
                <Pressable
                  style={[styles.periodBtn, selectedPeriod === 'AM' ? styles.periodBtnActive : null]}
                  onPress={() => setSelectedPeriod('AM')}
                >
                  <Text style={[styles.periodBtnText, selectedPeriod === 'AM' ? styles.periodBtnTextActive : null]}>
                    AM
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.periodBtn, selectedPeriod === 'PM' ? styles.periodBtnActive : null]}
                  onPress={() => setSelectedPeriod('PM')}
                >
                  <Text style={[styles.periodBtnText, selectedPeriod === 'PM' ? styles.periodBtnTextActive : null]}>
                    PM
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* Quick Presets */}
          <Text style={styles.sectionLabel}>Quick Presets</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presetScroll} contentContainerStyle={styles.presetContent}>
            {commonPresets.map((preset) => {
              const active = current24 === preset.value;
              return (
                <Pressable
                  key={preset.value}
                  style={[styles.presetChip, active ? styles.presetChipActive : null]}
                  onPress={() => handleSelectPreset(preset.value)}
                >
                  <Text style={[styles.presetChipText, active ? styles.presetChipTextActive : null]}>
                    {preset.label}
                  </Text>
                  {active ? <Check size={12} color="#fff" style={{ marginLeft: 3 }} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Action Footer */}
          <View style={styles.footer}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.doneBtn} onPress={handleDone}>
              <Text style={styles.doneBtnText}>Confirm Time</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },
  container: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  closeBtn: {
    padding: 6,
    borderRadius: radius.sm,
    backgroundColor: '#f1f5f9',
  },
  displayCard: {
    backgroundColor: '#f8fafc',
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  displayLabel: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  displayText: {
    fontSize: 24,
    fontWeight: fontWeights.heavy,
    color: colors.primary,
  },
  pickerRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: spacing.md,
  },
  column: {
    flex: 1,
    alignItems: 'center',
  },
  columnLabel: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: colors.muted,
    marginBottom: 6,
  },
  columnScroll: {
    maxHeight: 160,
    width: '100%',
  },
  itemChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemChipActive: {
    backgroundColor: colors.primary,
  },
  itemChipText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  itemChipTextActive: {
    color: '#ffffff',
  },
  periodGroup: {
    gap: 8,
    width: '100%',
  },
  periodBtn: {
    paddingVertical: 14,
    borderRadius: radius.sm,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodBtnActive: {
    backgroundColor: colors.brand.gold,
  },
  periodBtnText: {
    fontSize: 14,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  periodBtnTextActive: {
    color: colors.brand.ink,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: colors.muted,
    marginBottom: 8,
  },
  presetScroll: {
    marginBottom: spacing.md,
  },
  presetContent: {
    gap: 6,
  },
  presetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  presetChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  presetChipTextActive: {
    color: '#ffffff',
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  doneBtn: {
    flex: 2,
    paddingVertical: 11,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  doneBtnText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
});
