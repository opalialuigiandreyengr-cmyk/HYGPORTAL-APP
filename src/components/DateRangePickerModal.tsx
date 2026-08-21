import React, { useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react-native';

type DateRangePickerModalProps = {
  visible: boolean;
  initialStartDate?: string; // YYYY-MM-DD
  initialEndDate?: string;   // YYYY-MM-DD
  onApply: (startDate: string, endDate: string) => void;
  onClose: () => void;
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function parseYMD(ymd?: string): Date | null {
  if (!ymd) return null;
  const parts = ymd.split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return null;
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatReadable(ymd: string): string {
  const d = parseYMD(ymd);
  if (!d) return ymd;
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

export function DateRangePickerModal({
  visible,
  initialStartDate = '',
  initialEndDate = '',
  onApply,
  onClose,
}: DateRangePickerModalProps) {
  const todayObj = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => formatYMD(todayObj), [todayObj]);
  const maxYear = todayObj.getFullYear();
  const maxMonth = todayObj.getMonth();

  const initialDateObj = parseYMD(initialStartDate) || todayObj;
  const [currentYear, setCurrentYear] = useState(initialDateObj.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(initialDateObj.getMonth());

  const [startDateStr, setStartDateStr] = useState(initialStartDate);
  const [endDateStr, setEndDateStr] = useState(initialEndDate);
  const [selectingStep, setSelectingStep] = useState<'start' | 'end'>(initialStartDate && !initialEndDate ? 'end' : 'start');
  const [warningMsg, setWarningMsg] = useState('');

  const isAtMaxMonth = currentYear > maxYear || (currentYear === maxYear && currentMonth >= maxMonth);

  const daysInMonth = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const startWeekday = firstDay.getDay(); // 0 = Sun
    const totalDays = lastDay.getDate();

    const days: Array<{ dateStr: string; dayNum: number; isCurrentMonth: boolean }> = [];

    // Prev month padding
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const pDate = new Date(currentYear, currentMonth - 1, prevMonthLastDay - i);
      days.push({ dateStr: formatYMD(pDate), dayNum: pDate.getDate(), isCurrentMonth: false });
    }

    // Current month days
    for (let d = 1; d <= totalDays; d++) {
      const cDate = new Date(currentYear, currentMonth, d);
      days.push({ dateStr: formatYMD(cDate), dayNum: d, isCurrentMonth: true });
    }

    // Next month padding to complete 42 cells (6 rows)
    const remaining = 42 - days.length;
    for (let n = 1; n <= remaining; n++) {
      const nDate = new Date(currentYear, currentMonth + 1, n);
      days.push({ dateStr: formatYMD(nDate), dayNum: n, isCurrentMonth: false });
    }

    return days;
  }, [currentYear, currentMonth]);

  if (!visible) return null;

  const handlePrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (isAtMaxMonth) return;
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const handleDaySelect = (dateStr: string) => {
    setWarningMsg('');
    // Only past or current days can be selected
    if (dateStr > todayStr) return;

    if (!startDateStr || (startDateStr && endDateStr)) {
      setStartDateStr(dateStr);
      setEndDateStr('');
      setSelectingStep('end');
    } else {
      // We have startDate, selecting endDate
      if (dateStr < startDateStr) {
        setStartDateStr(dateStr);
        setEndDateStr('');
        setSelectingStep('end');
      } else {
        setEndDateStr(dateStr);
        setSelectingStep('start');
      }
    }
  };

  const handleClear = () => {
    setStartDateStr('');
    setEndDateStr('');
    setSelectingStep('start');
    setWarningMsg('');
  };

  const handleToday = () => {
    setStartDateStr(todayStr);
    setEndDateStr(todayStr);
    setCurrentYear(maxYear);
    setCurrentMonth(maxMonth);
    setWarningMsg('');
  };

  const handleApply = () => {
    if (!startDateStr && !endDateStr) {
      setWarningMsg('Please select Date From and Date To before applying.');
      return;
    }
    if (startDateStr && !endDateStr) {
      setWarningMsg('Please select Date To (End Date) before applying.');
      return;
    }
    if (!startDateStr && endDateStr) {
      setWarningMsg('Please select Date From (Start Date) before applying.');
      return;
    }

    let finalStart = startDateStr;
    let finalEnd = endDateStr;
    if (finalEnd < finalStart) {
      const temp = finalStart;
      finalStart = finalEnd;
      finalEnd = temp;
    }
    setWarningMsg('');
    onApply(finalStart, finalEnd);
    onClose();
  };

  const getRangeDisplay = () => {
    if (startDateStr && endDateStr) {
      return `${formatReadable(startDateStr)} – ${formatReadable(endDateStr)}`;
    }
    if (startDateStr) {
      return `${formatReadable(startDateStr)} – Select end date`;
    }
    return 'Select date range';
  };

  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          {/* Centered Top Title Label */}
          <Text style={styles.topModalTitle}>Set Date From-To</Text>

          {/* Header Bar */}
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.monthTitle}>
                {MONTH_NAMES[currentMonth]} {currentYear}
              </Text>
              <Text style={styles.rangeSubtext}>{getRangeDisplay()}</Text>
            </View>
            <View style={styles.navButtons}>
              <Pressable style={styles.navBtn} onPress={handlePrevMonth}>
                <ChevronLeft size={18} color="#0f172a" />
              </Pressable>
              <Pressable
                disabled={isAtMaxMonth}
                style={[styles.navBtn, isAtMaxMonth ? styles.navBtnDisabled : null]}
                onPress={handleNextMonth}
              >
                <ChevronRight size={18} color={isAtMaxMonth ? '#cbd5e1' : '#0f172a'} />
              </Pressable>
            </View>
          </View>

          {warningMsg ? (
            <View style={styles.warningBox}>
              <AlertCircle size={14} color="#92400e" strokeWidth={2.3} />
              <Text style={styles.warningText}>{warningMsg}</Text>
            </View>
          ) : null}

          {/* Weekday Labels */}
          <View style={styles.weekdayRow}>
            {WEEKDAYS.map((w) => (
              <Text key={w} style={styles.weekdayText}>
                {w}
              </Text>
            ))}
          </View>

          {/* Days Grid */}
          <View style={styles.grid}>
            {daysInMonth.map((item, idx) => {
              const isFuture = item.dateStr > todayStr;
              const isStart = item.dateStr === startDateStr;
              const isEnd = item.dateStr === endDateStr;
              const isInRange =
                startDateStr &&
                endDateStr &&
                item.dateStr >= startDateStr &&
                item.dateStr <= endDateStr;
              const isToday = item.dateStr === todayStr;

              return (
                <Pressable
                  key={`${item.dateStr}-${idx}`}
                  disabled={isFuture}
                  style={[
                    styles.dayCell,
                    isInRange ? styles.inRangeCell : null,
                    isStart ? styles.startCell : null,
                    isEnd ? styles.endCell : null,
                  ]}
                  onPress={() => handleDaySelect(item.dateStr)}
                >
                  <View
                    style={[
                      styles.dayInner,
                      isStart || isEnd ? styles.activeDayInner : null,
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        !item.isCurrentMonth ? styles.dimmedText : null,
                        isFuture ? styles.futureDayText : null,
                        isToday && !isStart && !isEnd ? styles.todayText : null,
                        isStart || isEnd ? styles.activeDayText : null,
                      ]}
                    >
                      {item.dayNum}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Footer Actions */}
          <View style={styles.footer}>
            <View style={styles.leftFooterActions}>
              <Pressable style={styles.textActionBtn} onPress={handleClear}>
                <Text style={styles.textActionLabel}>Clear</Text>
              </Pressable>
              <Pressable style={styles.textActionBtn} onPress={handleToday}>
                <Text style={styles.textActionLabel}>Today</Text>
              </Pressable>
            </View>

            <View style={styles.rightFooterActions}>
              <Pressable style={styles.cancelBtn} onPress={onClose}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.applyBtn} onPress={handleApply}>
                <Text style={styles.applyBtnText}>Apply</Text>
              </Pressable>
            </View>
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
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 350,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  topModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  rangeSubtext: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
    marginTop: 2,
  },
  navButtons: {
    flexDirection: 'row',
    gap: 6,
  },
  navBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: {
    opacity: 0.4,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  weekdayText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  dayCell: {
    width: '14.28%',
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inRangeCell: {
    backgroundColor: '#dbeafe',
  },
  startCell: {
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    backgroundColor: '#dbeafe',
  },
  endCell: {
    borderTopRightRadius: 20,
    borderBottomRightRadius: 20,
    backgroundColor: '#dbeafe',
  },
  dayInner: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeDayInner: {
    backgroundColor: '#2563eb',
  },
  dayText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0f172a',
  },
  dimmedText: {
    color: '#cbd5e1',
  },
  futureDayText: {
    color: '#e2e8f0',
  },
  todayText: {
    color: '#2563eb',
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  activeDayText: {
    color: '#ffffff',
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  leftFooterActions: {
    flexDirection: 'row',
    gap: 12,
  },
  rightFooterActions: {
    flexDirection: 'row',
    gap: 8,
  },
  textActionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  textActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  cancelBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
  },
  applyBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#071426',
  },
  applyBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fef3c7',
    borderColor: '#fde68a',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    marginTop: 8,
    marginBottom: 4,
  },
  warningText: {
    flex: 1,
    color: '#92400e',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});
