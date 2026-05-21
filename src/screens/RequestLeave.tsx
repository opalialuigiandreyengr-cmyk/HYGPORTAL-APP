import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from "react-native";
import {
  CreditCard,
  CircleDollarSign,
  GitBranch,
  ShieldPlus,
  Palmtree,
  Bell,
  Baby,
  Circle,
  Send,
} from "lucide-react-native";
import { TopBar } from "../components/TopBar";
import type { AppToastMessage } from "../components/AppToast";

type RequestLeaveProps = {
  onBack?: () => void;
  onToast?: (toast: AppToastMessage) => void;
  onSubmitted?: () => void;
};

const RequestLeave = ({ onBack, onToast, onSubmitted }: RequestLeaveProps) => {
  const [payType, setPayType] = useState("");
  const [leaveCategory, setLeaveCategory] = useState("");
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toLocaleDateString());
  const [endDate, setEndDate] = useState("");
  const [fullName, setFullName] = useState("JOHN PATRICK ZAMBRANO");
  const [position, setPosition] = useState("IT Staff");

  const initials = fullName
    .split(" ")
    .filter(Boolean)
    .map((name) => name[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // sample credits (used / total) — adjust to use real data if available
  const usedCredits = 4;
  const totalCredits = 7;

  const payTypes = [
    {
      label: "With Pay",
      value: "with_pay",
      icon: <CreditCard size={20} color="#2563EB" />,
    },
    {
      label: "Without Pay",
      value: "without_pay",
      icon: <CircleDollarSign size={20} color="#2563EB" />,
    },
    {
      label: "Both",
      value: "both",
      icon: <GitBranch size={20} color="#2563EB" />,
    },
  ];

  const leaveCategories = [
    {
      label: "Sick Leave",
      value: "sick",
      icon: <ShieldPlus size={20} color="#16A34A" />,
    },
    {
      label: "Vacation Leave",
      value: "vacation",
      icon: <Palmtree size={20} color="#2563EB" />,
    },
    {
      label: "Emergency Leave",
      value: "emergency",
      icon: <Bell size={20} color="#EF4444" />,
    },
    {
      label: "Maternity / Paternity",
      value: "maternity",
      icon: <Baby size={20} color="#9333EA" />,
    },
    {
      label: "Others",
      value: "others",
      icon: <Circle size={20} color="#F59E0B" />,
    },
  ];

  const renderCard = (
    item: any,
    selected: boolean,
    onPress: () => void
  ) => (
    <TouchableOpacity
      activeOpacity={0.8}
      style={[styles.card, selected && styles.selectedCard]}
      onPress={onPress}
    >
      <View style={styles.iconContainer}>{item.icon}</View>

      <Text style={styles.cardText}>{item.label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.wrapper}>
      <TopBar initials={initials} />

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Leave Credits */}
        <View style={styles.creditsCard}>
          <View style={styles.creditsHeader}>
            <Text style={styles.creditsTitle}>Leave Credits</Text>
            <TouchableOpacity style={styles.historyButton}>
              <Text style={styles.historyText}>History</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.progressRow}>
            <View style={styles.progressBarBackground}>
              <View
                style={[
                  styles.progressBarFill,
                  { width: `${Math.round((usedCredits / totalCredits) * 100)}%` },
                ]}
              />
            </View>

            <Text style={styles.creditsCounter}>{`${usedCredits} / ${totalCredits} days`}</Text>
          </View>

          <Text style={styles.creditsSubtitle}>Based on your current available credits.</Text>
        </View>

        {/* Employee Information */}
        <View style={styles.sectionHeader}>
          <View style={styles.stepCircle}>
            <Text style={styles.stepText}>1</Text>
          </View>

          <Text style={styles.sectionTitle}>Employee Information</Text>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Full Name</Text>
            <TextInput
              style={styles.infoInput}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Full name"
              placeholderTextColor="#9CA3AF"
            />
          </View>

          <View style={styles.infoField}>
            <Text style={styles.infoLabel}>Position</Text>
            <TextInput
              style={styles.infoInput}
              value={position}
              onChangeText={setPosition}
              placeholder="Position"
              placeholderTextColor="#9CA3AF"
            />
          </View>
        </View>
        {/* <View style={styles.sectionHeader}>
        <View style={styles.stepCircle}>
          <Text style={styles.stepText}>1</Text>
        </View>

        <Text style={styles.sectionTitle}>Employee Information</Text>
      </View> */}
      {/* Leave Category */}
      <View style={styles.sectionHeader}>
        <View style={styles.stepCircle}>
          <Text style={styles.stepText}>2</Text>
        </View>

        <Text style={styles.sectionTitle}>Leave Details</Text>
      </View>

      <View style={styles.dateRow}>
        <View style={styles.dateField}>
          <Text style={styles.infoLabel}>Start Date</Text>
          <TextInput
            style={styles.dateInput}
            value={startDate}
            onChangeText={setStartDate}
            placeholder="mm/dd/yyyy"
            placeholderTextColor="#9CA3AF"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        </View>

        <View style={styles.dateField}>
          <Text style={styles.infoLabel}>End Date</Text>
          <TextInput
            style={styles.dateInput}
            value={endDate}
            onChangeText={setEndDate}
            placeholder="mm/dd/yyyy"
            placeholderTextColor="#9CA3AF"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
        </View>
      </View>

      <View style={styles.durationBox}>
        <Text style={styles.durationLabel}>Total Duration</Text>
        <Text style={styles.durationValue}>{useMemo(() => {
          if (!startDate || !endDate) return `0 day/s`;
          try {
            const s = new Date(startDate);
            const e = new Date(endDate);
            const diff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
            return `${diff > 0 ? diff : 0} day/s`;
          } catch (e) {
            return `0 day/s`;
          }
        }, [startDate, endDate])}</Text>
      </View>

      {/* Leave Pay Type */}
      <Text style={styles.label}>
        Leave Pay Type <Text style={styles.required}>*</Text>
      </Text>

      <View style={styles.grid}>
        {payTypes.map((item) => (
          <View key={item.value} style={styles.gridItem}>
            {renderCard(
              item,
              payType === item.value,
              () => setPayType(item.value)
            )}
          </View>
        ))}
      </View>

      {/* Leave Category */}
      <Text style={[styles.label, { marginTop: 18 }]}>
        Leave Category <Text style={styles.required}>*</Text>
      </Text>

      <View style={styles.grid}>
        {leaveCategories.map((item) => (
          <View key={item.value} style={styles.gridItem}>
            {renderCard(
              item,
              leaveCategory === item.value,
              () => setLeaveCategory(item.value)
            )}
          </View>
        ))}
      </View>

      {/* Reason */}
      <View style={styles.sectionHeader}>
        <View style={styles.stepCircle}>
          <Text style={styles.stepText}>3</Text>
        </View>

        <Text style={styles.sectionTitle}>Reason</Text>
      </View>

      <Text style={styles.label}>
        Reason for Leave <Text style={styles.required}>*</Text>
      </Text>

      <TextInput
        multiline
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        placeholder="Enter reason for your leave..."
        placeholderTextColor="#9CA3AF"
        style={styles.textArea}
        textAlignVertical="top"
      />

      <Text style={styles.counter}>{reason.length}/500</Text>

      {/* Submit */}
      <TouchableOpacity
        style={styles.submitButton}
        activeOpacity={0.8}
        onPress={() => {
          if (!payType || !leaveCategory || !reason.trim()) {
            onToast?.({
              tone: 'warning',
              title: 'Incomplete Form',
              message: 'Please fill in all required fields.',
            });
            return;
          }
          onToast?.({
            tone: 'success',
            title: 'Leave Request Submitted',
            message: 'Your leave request has been submitted successfully.',
          });
          onSubmitted?.();
        }}
      >
        <Send size={18} color="#000" />

        <Text style={styles.submitText}>Submit Leave Request</Text>
      </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

export default RequestLeave;

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: "#F3F4F6",
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
  },

  backButton: {
    padding: 8,
    marginLeft: -8,
  },

  headerTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#0F172A",
  },

  headerSpacer: {
    width: 40,
  },

  container: {
    flex: 1,
    backgroundColor: "#F3F4F6",
    padding: 12,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    marginTop: 8,
  },

  stepCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#2563EB",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 10,
  },

  stepText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 16,
  },

  sectionTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: "#0F172A",
  },

  label: {
    fontSize: 14,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 10,
  },

  required: {
    color: "#EF4444",
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },

  gridItem: {
    width: "48%",
    marginBottom: 12,
  },

  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#DCE3F0",
    borderRadius: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
  },

  selectedCard: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },

  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  cardText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    flexShrink: 1,
  },

  textArea: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#DCE3F0",
    borderRadius: 14,
    minHeight: 120,
    padding: 12,
    fontSize: 15,
    color: "#111827",
  },

  counter: {
    textAlign: "right",
    marginTop: 8,
    color: "#334155",
    fontWeight: "600",
  },

  submitButton: {
    marginTop: 20,
    height: 50,
    borderRadius: 14,
    backgroundColor: "#FACC15",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },

  submitText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#000",
  },
  creditsCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  creditsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  creditsTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#0F172A",
  },
  historyButton: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "#EEF2FF",
  },
  historyText: {
    color: "#3730A3",
    fontWeight: "700",
  },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  progressBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: "#EEF2FF",
    borderRadius: 999,
    marginRight: 10,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: "#10B981",
  },
  creditsCounter: {
    fontWeight: "800",
    color: "#0F172A",
    fontSize: 13,
  },
  creditsSubtitle: {
    marginTop: 8,
    color: "#6B7280",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  infoField: {
    flex: 1,
  },
  infoLabel: {
    color: "#6B7280",
    marginBottom: 8,
    fontWeight: "700",
  },
  infoInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#DCE3F0",
    borderRadius: 12,
    padding: 10,
  },
  infoValue: {
    color: "#0F172A",
    fontWeight: "700",
  },
  dateRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  dateField: {
    flex: 1,
  },
  dateInput: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#DCE3F0",
    borderRadius: 12,
    padding: 10,
    minHeight: 44,
    justifyContent: "center",
  },
  durationBox: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#DCE3F0",
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
    marginVertical: 10,
  },
  durationLabel: {
    color: "#6B7280",
    fontWeight: "700",
  },
  durationValue: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
    marginTop: 6,
  },
});