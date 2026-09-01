import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type ScrollableTimePickerModalProps = {
  visible: boolean;
  title?: string;
  initialTime?: string; // "HH:mm" or "HH:mm:ss" (24h format, e.g. "14:50:00")
  onConfirm: (time24: string) => void;
  onCancel: () => void;
};

const HOURS_12 = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const SECONDS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const ITEM_HEIGHT = 44;
const VISIBLE_COUNT = 3;
const PADDING_COUNT = 1; // 1 item padding top and bottom

function parse24To12(time24?: string): {
  hourStr: string;
  minuteStr: string;
  secondStr: string;
  ampm: 'AM' | 'PM';
} {
  if (!time24) {
    const now = new Date();
    let h = now.getHours();
    const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const hFormatted = String(h).padStart(2, '0');
    const mFormatted = String(now.getMinutes()).padStart(2, '0');
    const sFormatted = String(now.getSeconds()).padStart(2, '0');
    return { hourStr: hFormatted, minuteStr: mFormatted, secondStr: sFormatted, ampm };
  }

  const parts = time24.split(':');
  let h = parseInt(parts[0] || '9', 10);
  const mNum = Math.min(59, Math.max(0, parseInt(parts[1] || '0', 10)));
  const sNum = Math.min(59, Math.max(0, parseInt(parts[2] || '0', 10)));
  const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const hFormatted = String(h).padStart(2, '0');
  const mFormatted = String(mNum).padStart(2, '0');
  const sFormatted = String(sNum).padStart(2, '0');

  return { hourStr: hFormatted, minuteStr: mFormatted, secondStr: sFormatted, ampm };
}

function convert12To24(hourStr: string, minuteStr: string, secondStr: string, ampm: 'AM' | 'PM'): string {
  let h = parseInt(hourStr, 10);
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  const hFormatted = String(h).padStart(2, '0');
  return `${hFormatted}:${minuteStr}:${secondStr}`;
}

type WheelColumnProps<T> = {
  items: T[];
  selectedValue: T;
  onSelect: (val: T) => void;
  formatLabel?: (val: T) => string;
};

function WheelColumn<T extends string | number>({
  items,
  selectedValue,
  onSelect,
  formatLabel = (val) => String(val),
}: WheelColumnProps<T>) {
  const scrollViewRef = useRef<ScrollView | null>(null);
  const [activeValue, setActiveValue] = useState<T>(selectedValue);

  useEffect(() => {
    setActiveValue(selectedValue);
    const idx = items.indexOf(selectedValue);
    const targetIdx = idx >= 0 ? idx : 0;
    const timer = setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: targetIdx * ITEM_HEIGHT,
        animated: false,
      });
    }, 25);
    return () => clearTimeout(timer);
  }, [selectedValue, items]);

  const updateScrollSelection = (yOffset: number) => {
    const index = Math.round(yOffset / ITEM_HEIGHT);
    const clampedIndex = Math.max(0, Math.min(items.length - 1, index));
    const targetItem = items[clampedIndex];
    if (targetItem !== undefined && targetItem !== activeValue) {
      setActiveValue(targetItem);
      onSelect(targetItem);
    }
  };

  const handleScroll = (e: any) => {
    updateScrollSelection(e.nativeEvent.contentOffset.y);
  };

  const handleMomentumEnd = (e: any) => {
    const yOffset = e.nativeEvent.contentOffset.y;
    const index = Math.round(yOffset / ITEM_HEIGHT);
    const clampedIndex = Math.max(0, Math.min(items.length - 1, index));
    const targetItem = items[clampedIndex];
    if (targetItem !== undefined) {
      setActiveValue(targetItem);
      onSelect(targetItem);
    }
  };

  return (
    <View style={styles.wheelColumnTrack}>
      <View style={styles.centerHighlightOverlay} pointerEvents="none" />
      <ScrollView
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        snapToAlignment="center"
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleMomentumEnd}
        onScrollEndDrag={handleMomentumEnd}
        contentContainerStyle={{
          paddingVertical: ITEM_HEIGHT * PADDING_COUNT,
        }}
      >
        {items.map((item, idx) => {
          const isSelected = item === activeValue;
          return (
            <Pressable
              key={`${item}-${idx}`}
              style={styles.wheelItem}
              onPress={() => {
                setActiveValue(item);
                onSelect(item);
                scrollViewRef.current?.scrollTo({
                  y: idx * ITEM_HEIGHT,
                  animated: true,
                });
              }}
            >
              <Text
                style={[
                  styles.wheelItemText,
                  isSelected ? styles.wheelItemTextSelected : styles.wheelItemTextDimmed,
                ]}
              >
                {formatLabel(item)}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

export function ScrollableTimePickerModal({
  visible,
  title,
  initialTime = '09:00:00',
  onConfirm,
  onCancel,
}: ScrollableTimePickerModalProps) {
  const parsed = useMemo(() => parse24To12(initialTime), [initialTime]);
  const [selectedHour, setSelectedHour] = useState(parsed.hourStr);
  const [selectedMinute, setSelectedMinute] = useState(parsed.minuteStr);
  const [selectedSecond, setSelectedSecond] = useState(parsed.secondStr);
  const [selectedAmPm, setSelectedAmPm] = useState<'AM' | 'PM'>(parsed.ampm);

  useEffect(() => {
    if (visible) {
      const p = parse24To12(initialTime);
      setSelectedHour(p.hourStr);
      setSelectedMinute(p.minuteStr);
      setSelectedSecond(p.secondStr);
      setSelectedAmPm(p.ampm);
    }
  }, [visible, initialTime]);

  if (!visible) return null;

  const handleConfirm = () => {
    const time24 = convert12To24(selectedHour, selectedMinute, selectedSecond, selectedAmPm);
    onConfirm(time24);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Modal Header / Title */}
          {title ? (
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitleText}>{title}</Text>
            </View>
          ) : null}

          {/* Section 1: SELECTED TIME Preview */}
          <Text style={styles.sectionHeading}>Selected Time</Text>
          <View style={styles.previewBox}>
            <View style={styles.previewInner}>
              <Text style={styles.previewDigits}>{selectedHour}</Text>
              <Text style={styles.previewColon}>:</Text>
              <Text style={styles.previewDigits}>{selectedMinute}</Text>
              <Text style={styles.previewColon}>:</Text>
              <Text style={styles.previewDigits}>{selectedSecond}</Text>
              <Text style={styles.previewPeriod}>{selectedAmPm}</Text>
            </View>
          </View>

          {/* Section 2: ADJUST HOUR · MINUTE · SECOND */}
          <Text style={[styles.sectionHeading, { marginTop: 12 }]}>
            Adjust Hour · Minute · Second
          </Text>
          <View style={styles.columnHeaderRow}>
            <Text style={styles.columnHeaderText}>Hour</Text>
            <Text style={styles.columnHeaderText}>Min</Text>
            <Text style={styles.columnHeaderText}>Sec</Text>
          </View>

          {/* Wheels Frame re-keyed by initialTime so columns mount pre-scrolled */}
          <View key={initialTime} style={styles.wheelsRow}>
            {/* Hour Wheel */}
            <WheelColumn
              items={HOURS_12}
              selectedValue={selectedHour}
              onSelect={setSelectedHour}
            />

            {/* Minute Wheel */}
            <WheelColumn
              items={MINUTES}
              selectedValue={selectedMinute}
              onSelect={setSelectedMinute}
            />

            {/* Second Wheel */}
            <WheelColumn
              items={SECONDS}
              selectedValue={selectedSecond}
              onSelect={setSelectedSecond}
            />
          </View>

          {/* Section 3: PERIOD */}
          <Text style={[styles.sectionHeading, { marginTop: 12 }]}>Period</Text>
          <View style={styles.periodRow}>
            <Pressable
              style={[styles.periodBtn, selectedAmPm === 'AM' ? styles.periodBtnActive : null]}
              onPress={() => setSelectedAmPm('AM')}
            >
              <Text
                style={[
                  styles.periodBtnText,
                  selectedAmPm === 'AM' ? styles.periodBtnTextActive : null,
                ]}
              >
                AM
              </Text>
            </Pressable>
            <Pressable
              style={[styles.periodBtn, selectedAmPm === 'PM' ? styles.periodBtnActive : null]}
              onPress={() => setSelectedAmPm('PM')}
            >
              <Text
                style={[
                  styles.periodBtnText,
                  selectedAmPm === 'PM' ? styles.periodBtnTextActive : null,
                ]}
              >
                PM
              </Text>
            </Pressable>
          </View>

          {/* Action Buttons: Text Buttons only */}
          <View style={styles.actionRow}>
            <Pressable style={styles.textBtn} onPress={onCancel}>
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable style={styles.textBtn} onPress={handleConfirm}>
              <Text style={styles.confirmBtnText}>Set Time</Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 310,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    elevation: 12,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
  },
  modalHeader: {
    alignItems: 'center',
    marginBottom: 10,
  },
  modalTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    letterSpacing: 0.2,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '500',
    color: '#64748b',
    letterSpacing: 0.6,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  previewBox: {
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewDigits: {
    fontSize: 32,
    fontWeight: '800',
    color: '#0f172a',
    letterSpacing: 0.5,
    minWidth: 38,
    textAlign: 'center',
  },
  previewColon: {
    fontSize: 26,
    fontWeight: '700',
    color: '#334155',
    marginHorizontal: 3,
    alignSelf: 'center',
  },
  previewPeriod: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginLeft: 8,
    marginTop: 4,
  },
  columnHeaderRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 4,
  },
  columnHeaderText: {
    flex: 1,
    textAlign: 'center',
    color: '#64748b',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.5,
  },
  wheelsRow: {
    flexDirection: 'row',
    gap: 8,
    height: ITEM_HEIGHT * VISIBLE_COUNT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelColumnTrack: {
    flex: 1,
    height: ITEM_HEIGHT * VISIBLE_COUNT,
    backgroundColor: '#f8fafc',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    overflow: 'hidden',
    position: 'relative',
  },
  centerHighlightOverlay: {
    position: 'absolute',
    top: ITEM_HEIGHT * PADDING_COUNT,
    left: 4,
    right: 4,
    height: ITEM_HEIGHT,
    backgroundColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wheelItemText: {
    textAlign: 'center',
  },
  wheelItemTextSelected: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  wheelItemTextDimmed: {
    fontSize: 14,
    fontWeight: '500',
    color: '#94a3b8',
  },
  periodRow: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
    flexDirection: 'row',
    gap: 4,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  periodBtnActive: {
    backgroundColor: '#eab308',
  },
  periodBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748b',
  },
  periodBtnTextActive: {
    color: '#ffffff',
    fontWeight: '800',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    marginTop: 20,
  },
  textBtn: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#ca8a04',
    letterSpacing: 0.5,
  },
});

