import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';

type UniversalDateTimePickerProps = {
  value: Date;
  mode?: 'date' | 'time';
  display?: 'default' | 'spinner' | 'calendar';
  is24Hour?: boolean;
  onChange: (event: DateTimePickerEvent, date?: Date) => void;
  onClose?: () => void;
};

export function UniversalDateTimePicker({
  value,
  mode = 'date',
  display = 'default',
  is24Hour = false,
  onChange,
  onClose,
}: UniversalDateTimePickerProps) {
  if (Platform.OS === 'web') {
    const formatWebDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    const formatWebTime = (d: Date) => {
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    };

    const [valStr, setValStr] = useState(mode === 'date' ? formatWebDate(value) : formatWebTime(value));

    const handleConfirm = () => {
      if (!valStr) {
        onClose?.();
        return;
      }
      let selected: Date;
      if (mode === 'date') {
        const [y, m, d] = valStr.split('-').map(Number);
        selected = new Date(y, (m || 1) - 1, d || 1);
      } else {
        const [h, m] = valStr.split(':').map(Number);
        selected = new Date(value);
        selected.setHours(h || 0, m || 0, 0, 0);
      }
      onChange({ type: 'set', nativeEvent: { timestamp: selected.getTime() } } as DateTimePickerEvent, selected);
      onClose?.();
    };

    const handleCancel = () => {
      onChange({ type: 'dismissed', nativeEvent: { timestamp: value.getTime() } } as DateTimePickerEvent, undefined);
      onClose?.();
    };

    return (
      <Modal transparent animationType="fade" visible onRequestClose={handleCancel}>
        <View style={styles.modalBackdrop}>
          <View style={styles.webPickerPanel}>
            <Text style={styles.webPickerTitle}>{mode === 'date' ? 'Select Date' : 'Select Time'}</Text>
            {mode === 'date' ? (
              <input
                type="date"
                value={valStr}
                onChange={(e) => setValStr(e.target.value)}
                style={{
                  fontSize: '18px',
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  width: '100%',
                  boxSizing: 'border-box',
                  margin: '16px 0',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            ) : (
              <input
                type="time"
                value={valStr}
                onChange={(e) => setValStr(e.target.value)}
                style={{
                  fontSize: '18px',
                  padding: '12px',
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  width: '100%',
                  boxSizing: 'border-box',
                  margin: '16px 0',
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            )}
            <View style={styles.webPickerActions}>
              <Pressable style={styles.cancelBtn} onPress={handleCancel}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.confirmBtn} onPress={handleConfirm}>
                <Text style={styles.confirmText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <Modal transparent animationType="fade" visible onRequestClose={onClose}>
        <View style={styles.modalBackdrop}>
          <View style={styles.iosPickerPanel}>
            <DateTimePicker
              value={value}
              mode={mode}
              display={display === 'default' ? 'spinner' : display}
              is24Hour={is24Hour}
              onChange={onChange}
            />
            <View style={styles.webPickerActions}>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.confirmBtn} onPress={onClose}>
                <Text style={styles.confirmText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <DateTimePicker
      value={value}
      mode={mode}
      display={display}
      is24Hour={is24Hour}
      onChange={onChange}
    />
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  webPickerPanel: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    alignItems: 'stretch',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
  },
  iosPickerPanel: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    elevation: 10,
  },
  webPickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#071426',
    marginBottom: 4,
  },
  webPickerActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 12,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  cancelText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 14,
  },
  confirmBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#071426',
  },
  confirmText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
});
