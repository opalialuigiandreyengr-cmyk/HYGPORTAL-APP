import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Pressable,
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
  ArrowLeft,
} from "lucide-react-native";
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
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          style={({ pressed }) => [styles.backButton, pressed && { opacity: 0.6 }]}
          onPress={onBack}
        >
          <ArrowLeft size={24} color="#2563EB" />
        </Pressable>
        <Text style={styles.headerTitle}>Request Leave</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
      {/* Leave Category */}
      <View style={styles.sectionHeader}>
        <View style={styles.stepCircle}>
          <Text style={styles.stepText}>2</Text>
        </View>

        <Text style={styles.sectionTitle}>Leave Category</Text>
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
    padding: 16,
  },

  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
    marginTop: 10,
  },

  stepCircle: {
    width: 38,
    height: 38,
    borderRadius: 20,
    backgroundColor: "#2563EB",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },

  stepText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 18,
  },

  sectionTitle: {
    fontSize: 30,
    fontWeight: "800",
    color: "#0F172A",
  },

  label: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 12,
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
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 82,
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
    minHeight: 150,
    padding: 16,
    fontSize: 16,
    color: "#111827",
  },

  counter: {
    textAlign: "right",
    marginTop: 8,
    color: "#334155",
    fontWeight: "600",
  },

  submitButton: {
    marginTop: 24,
    height: 58,
    borderRadius: 14,
    backgroundColor: "#FACC15",
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },

  submitText: {
    fontSize: 18,
    fontWeight: "800",
    color: "#000",
  },
});