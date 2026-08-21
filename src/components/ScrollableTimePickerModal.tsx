import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type ScrollableTimePickerModalProps = {
  visible: boolean;
  title?: string;
  initialTime?: string; // "HH:mm" (24h format, e.g. "14:50")
  onConfirm: (time24: string) => void;
  onCancel: () => void;
};

const HOURS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
const AMPM_OPTIONS = ['AM', 'PM'];
const ITEM_HEIGHT = 44;

function parse24To12(time24?: string): { hour12: number; minuteStr: string; ampm: 'AM' | 'PM' } {
  if (!time24) {
    const now = new Date();
    let h = now.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const m = String(now.getMinutes()).padStart(2, '0');
    return { hour12: h, minuteStr: m, ampm };
  }

  const [hStr, mStr] = time24.split(':');
  let h = parseInt(hStr || '9', 10);
  const mNum = Math.min(59, Math.max(0, parseInt(mStr || '0', 10)));
  const ampm: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const mFormatted = String(mNum).padStart(2, '0');

  return { hour12: h, minuteStr: mFormatted, ampm };
}

function convert12To24(hour12: number, minuteStr: string, ampm: 'AM' | 'PM'): string {
  let h = hour12;
  if (ampm === 'PM' && h < 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  const hFormatted = String(h).padStart(2, '0');
  return `${hFormatted}:${minuteStr}`;
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
    }, 20);
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

  return (
    <View style={styles.wheelColumnContainer}>
      <ScrollView
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={handleScroll}
        onMomentumScrollEnd={handleScroll}
        onScrollEndDrag={handleScroll}
        contentContainerStyle={{
          paddingVertical: ITEM_HEIGHT,
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
  initialTime = '09:00',
  onConfirm,
  onCancel,
}: ScrollableTimePickerModalProps) {
  const parsed = useMemo(() => parse24To12(initialTime), [initialTime]);
  const [selectedHour, setSelectedHour] = useState(parsed.hour12);
  const [selectedMinute, setSelectedMinute] = useState(parsed.minuteStr);
  const [selectedAmPm, setSelectedAmPm] = useState<'AM' | 'PM'>(parsed.ampm);

  useEffect(() => {
    if (visible) {
      const p = parse24To12(initialTime);
      setSelectedHour(p.hour12);
      setSelectedMinute(p.minuteStr);
      setSelectedAmPm(p.ampm);
    }
  }, [visible, initialTime]);

  if (!visible) return null;

  const handleConfirm = () => {
    const time24 = convert12To24(selectedHour, selectedMinute, selectedAmPm);
    onConfirm(time24);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {title ? <Text style={styles.headerTitle}>{title}</Text> : null}

          {/* Wheel Frame re-keyed by initialTime so columns mount pre-scrolled to set time */}
          <View key={initialTime} style={styles.wheelFrame}>
            {/* Center Highlight Overlay Box with top/bottom lines */}
            <View style={styles.centerHighlightOverlay} pointerEvents="none" />

            {/* Hour Wheel */}
            <WheelColumn
              items={HOURS_12}
              selectedValue={selectedHour}
              onSelect={setSelectedHour}
            />

            {/* Separator Colon */}
            <View style={styles.colonColumn}>
              <Text style={styles.colonText}>:</Text>
            </View>

            {/* Minute Wheel */}
            <WheelColumn
              items={MINUTES}
              selectedValue={selectedMinute}
              onSelect={setSelectedMinute}
            />

            {/* AM / PM Wheel */}
            <WheelColumn
              items={AMPM_OPTIONS}
              selectedValue={selectedAmPm}
              onSelect={(val) => setSelectedAmPm(val as 'AM' | 'PM')}
            />
          </View>

          {/* Action Buttons */}
          <View style={styles.actionRow}>
            <Pressable style={styles.btn} onPress={onCancel}>
              <Text style={styles.btnText}>CANCEL</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={handleConfirm}>
              <Text style={styles.btnText}>OK</Text>
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
    backgroundColor: 'rgba(7, 20, 38, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 310,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 14,
  },
  wheelFrame: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: ITEM_HEIGHT * 3,
    position: 'relative',
    overflow: 'hidden',
  },
  centerHighlightOverlay: {
    position: 'absolute',
    top: ITEM_HEIGHT,
    left: 0,
    right: 0,
    height: ITEM_HEIGHT,
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: '#475569',
    zIndex: 1,
  },
  wheelColumnContainer: {
    flex: 1,
    height: ITEM_HEIGHT * 3,
    alignItems: 'center',
  },
  colonColumn: {
    width: 20,
    height: ITEM_HEIGHT * 3,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  colonText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#334155',
  },
  wheelItem: {
    height: ITEM_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
    width: 70,
  },
  wheelItemText: {
    textAlign: 'center',
  },
  wheelItemTextSelected: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  wheelItemTextDimmed: {
    fontSize: 16,
    fontWeight: '500',
    color: '#cbd5e1',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 16,
    marginTop: 20,
  },
  btn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563eb',
    letterSpacing: 0.5,
  },
});
