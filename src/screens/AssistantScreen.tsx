import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  Bot,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FileText,
  HelpCircle,
  ListChecks,
  Send,
  Tag,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TopBar } from '../components/TopBar';
import { assistantFallbacks, assistantFaqQuestions, assistantRequestTemplates } from '../constants/assistantKnowledge';
import { createAssistantReply, type AssistantDraft, type AssistantReply } from '../services/assistant';
import { colors, fontWeights, radius, spacing } from '../theme';

type ChatItem = {
  id: string;
  role: 'assistant' | 'employee';
  text: string;
  draft?: AssistantDraft;
  isTyping?: boolean;
};

const faqPageSize = 4;

export function AssistantScreen({
  name,
  username,
  photoUrl,
  leaveCreditRemaining,
  offsetBalance,
  onBack,
  onOpenDraft,
}: {
  name?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  leaveCreditRemaining: number;
  offsetBalance: number;
  onBack: () => void;
  onOpenDraft: (draft: AssistantDraft) => void;
}) {
  const insets = useSafeAreaInsets();
  const [message, setMessage] = useState('');
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
  const [showFaq, setShowFaq] = useState(false);
  const [faqPage, setFaqPage] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [items, setItems] = useState<ChatItem[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: assistantFallbacks.welcome,
    },
  ]);
  const isAssistantTyping = useMemo(() => items.some((item) => item.isTyping), [items]);
  const faqPageCount = Math.ceil(assistantFaqQuestions.length / faqPageSize);
  const visibleFaqButtons = assistantFaqQuestions.slice(faqPage * faqPageSize, faqPage * faqPageSize + faqPageSize);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setIsKeyboardVisible(true);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setIsKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
      }
    };
  }, []);

  function submitMessage(value = message) {
    const trimmed = value.trim();
    if (!trimmed || isAssistantTyping) {
      return;
    }

    const reply = createAssistantReply(trimmed, { leaveCreditRemaining, offsetBalance });
    const typingId = `typing-${Date.now()}`;
    setItems((current) => [
      ...current,
      { id: `employee-${Date.now()}`, role: 'employee', text: trimmed },
      { id: typingId, role: 'assistant', text: '', isTyping: true },
    ]);
    setMessage('');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);

    if (typingTimer.current) {
      clearTimeout(typingTimer.current);
    }
    typingTimer.current = setTimeout(() => {
      setItems((current) => current.map((item) => (item.id === typingId ? mapReplyToItem(reply, typingId) : item)));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
      typingTimer.current = null;
    }, 3000);
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <StatusBar style="dark" />
      <TopBar
        name={name}
        username={username}
        photoUrl={photoUrl}
        onBackHome={onBack}
        backSubtitle="Local AI plan"
        backTitle="HYG Assist"
        backAccessory="sparkles"
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.scroll}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.templatePanel}>
          <Text style={styles.panelTitle}>Request templates</Text>
          <View style={styles.chips}>
            {assistantRequestTemplates.map((chip) => (
              <Pressable
                key={chip}
                disabled={isAssistantTyping}
                style={[styles.chip, isAssistantTyping ? styles.chipDisabled : null]}
                onPress={() => submitMessage(chip)}
              >
                <Text style={styles.chipText}>{chip}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          style={[styles.faqToggle, showFaq ? styles.faqToggleActive : null]}
          onPress={() => setShowFaq((current) => !current)}
        >
          <View style={styles.faqToggleIcon}>
            <HelpCircle size={18} color={showFaq ? colors.brand.ink : colors.primary} strokeWidth={2.7} />
          </View>
          <View style={styles.faqToggleTextBlock}>
            <Text style={styles.faqToggleTitle}>FAQ</Text>
            <Text style={styles.faqToggleSubtitle}>Browse usual employee questions</Text>
          </View>
          <Text style={styles.faqToggleState}>{showFaq ? 'Hide' : 'Show'}</Text>
        </Pressable>

        {showFaq ? (
          <View style={styles.faqPanel}>
            <View style={styles.faqPanelHeader}>
              <Text style={styles.panelTitle}>Select a question</Text>
              <Text style={styles.faqPageText}>
                {faqPage + 1} / {faqPageCount}
              </Text>
            </View>
            <View style={styles.faqGrid}>
              {visibleFaqButtons.map((question) => (
                <Pressable
                  key={question}
                  disabled={isAssistantTyping}
                  style={[styles.faqButton, isAssistantTyping ? styles.chipDisabled : null]}
                  onPress={() => submitMessage(question)}
                >
                  <Text style={styles.faqButtonText}>{question}</Text>
                </Pressable>
              ))}
            </View>
            {faqPageCount > 1 ? (
              <View style={styles.faqPager}>
                <Pressable
                  disabled={faqPage === 0}
                  style={[styles.pagerButton, faqPage === 0 ? styles.pagerButtonDisabled : null]}
                  onPress={() => setFaqPage((current) => Math.max(0, current - 1))}
                >
                  <ChevronLeft size={18} color={colors.text} strokeWidth={2.7} />
                  <Text style={styles.pagerButtonText}>Prev</Text>
                </Pressable>
                <View style={styles.pagerDots}>
                  {Array.from({ length: faqPageCount }).map((_, index) => (
                    <View key={index} style={[styles.pagerDot, index === faqPage ? styles.pagerDotActive : null]} />
                  ))}
                </View>
                <Pressable
                  disabled={faqPage >= faqPageCount - 1}
                  style={[styles.pagerButton, faqPage >= faqPageCount - 1 ? styles.pagerButtonDisabled : null]}
                  onPress={() => setFaqPage((current) => Math.min(faqPageCount - 1, current + 1))}
                >
                  <Text style={styles.pagerButtonText}>Next</Text>
                  <ChevronRight size={18} color={colors.text} strokeWidth={2.7} />
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.thread}>
          {items.map((item) => (
            <View
              key={item.id}
              style={[
                styles.messageRow,
                item.role === 'employee' ? styles.employeeMessageRow : styles.assistantMessageRow,
              ]}
            >
            <View
              style={[
                styles.bubble,
                item.role === 'employee' ? styles.employeeBubble : styles.assistantBubble,
              ]}
            >
              <View style={styles.bubbleHeader}>
                {item.role === 'assistant' ? <Bot size={15} color={colors.primary} strokeWidth={2.5} /> : null}
                <Text style={[styles.bubbleLabel, item.role === 'employee' ? styles.employeeLabel : null]}>
                  {item.role === 'assistant' ? 'HYG Assist' : 'You'}
                </Text>
              </View>
              {item.isTyping ? (
                <TypingDots />
              ) : (
                <Text style={[styles.bubbleText, item.role === 'employee' ? styles.employeeText : null]}>
                  {item.text}
                </Text>
              )}
              {item.draft ? <DraftPreview draft={item.draft} onOpen={() => onOpenDraft(item.draft!)} /> : null}
            </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <View
        style={[
          styles.composer,
          {
            paddingBottom: isKeyboardVisible ? spacing.md : Math.max(insets.bottom, spacing.md),
          },
        ]}
      >
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Example: file overtime today 6pm to 9pm"
          placeholderTextColor={colors.muted}
          multiline
          style={styles.input}
          onFocus={() => {
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
          }}
        />
        <Pressable
          disabled={isAssistantTyping}
          style={[styles.sendButton, isAssistantTyping ? styles.sendButtonDisabled : null]}
          onPress={() => submitMessage()}
        >
          <Send size={19} color={colors.brand.ink} strokeWidth={2.8} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function TypingDots() {
  const dotOne = useRef(new Animated.Value(0)).current;
  const dotTwo = useRef(new Animated.Value(0)).current;
  const dotThree = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    function dotTiming(value: Animated.Value) {
      return Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 260,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]);
    }

    const animation = Animated.loop(
      Animated.stagger(140, [dotTiming(dotOne), dotTiming(dotTwo), dotTiming(dotThree)]),
    );
    animation.start();

    return () => {
      animation.stop();
    };
  }, [dotOne, dotTwo, dotThree]);

  return (
    <View style={styles.typingDots}>
      {[dotOne, dotTwo, dotThree].map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.typingDot,
            {
              opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
              transform: [
                {
                  translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }),
                },
              ],
            },
          ]}
        />
      ))}
    </View>
  );
}

function mapReplyToItem(reply: AssistantReply, id = `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`): ChatItem {
  return {
    id,
    role: 'assistant',
    text: reply.message,
    draft: reply.type === 'draft' ? reply.draft : undefined,
  };
}

function DraftPreview({ draft, onOpen }: { draft: AssistantDraft; onOpen: () => void }) {
  const Icon = draft.intent === 'draft_leave_request' ? CalendarDays : draft.intent === 'draft_esarf_request' ? FileText : Tag;
  const title =
    draft.intent === 'draft_leave_request'
      ? 'Leave draft'
      : draft.intent === 'draft_esarf_request'
        ? 'ESARF draft'
        : 'Perk draft';

  return (
    <View style={styles.preview}>
      <View style={styles.previewHeader}>
        <View style={styles.previewIcon}>
          <Icon size={16} color={colors.brand.ink} strokeWidth={2.6} />
        </View>
        <View style={styles.previewTitleBlock}>
          <Text style={styles.previewTitle}>{title}</Text>
          <Text style={styles.previewMeta}>{Math.round(draft.confidence * 100)}% confidence</Text>
        </View>
      </View>
      <Text style={styles.previewSummary}>{draft.summary}</Text>
      <View style={styles.previewFields}>
        {getDraftRows(draft).map((row) => (
          <View key={row.label} style={styles.previewFieldRow}>
            <Text style={styles.previewFieldLabel}>{row.label}</Text>
            <Text style={styles.previewFieldValue}>{row.value}</Text>
          </View>
        ))}
      </View>
      {draft.missingFields.length ? (
        <View style={styles.missingRow}>
          <ListChecks size={14} color="#b45309" strokeWidth={2.6} />
          <Text style={styles.missingText}>Needs: {draft.missingFields.join(', ')}</Text>
        </View>
      ) : null}
      <Pressable style={styles.openButton} onPress={onOpen}>
        <Text style={styles.openButtonText}>Review in form</Text>
      </Pressable>
    </View>
  );
}

function getDraftRows(draft: AssistantDraft) {
  if (draft.intent === 'draft_leave_request') {
    return [
      { label: 'Date', value: `${draft.fields.startDate ?? 'Missing'} to ${draft.fields.endDate ?? 'Missing'}` },
      { label: 'Type', value: draft.fields.leaveCategory ?? 'Missing' },
      { label: 'Reason', value: draft.fields.reason || 'Missing' },
    ];
  }

  if (draft.intent === 'draft_esarf_request') {
    return [
      { label: 'Transaction', value: draft.fields.transactions?.join(', ') || 'Missing' },
      { label: 'Date', value: `${draft.fields.dateFrom ?? 'Missing'} to ${draft.fields.dateTo ?? 'Missing'}` },
      { label: 'Time', value: `${draft.fields.timeFrom ?? 'Missing'} to ${draft.fields.timeTo ?? 'Missing'}` },
      { label: 'Schedule', value: draft.fields.schedule ?? 'Missing' },
      { label: 'Day off', value: draft.fields.dayOff ?? 'Missing' },
      { label: 'Payroll', value: draft.fields.payrollClass ?? 'Missing' },
    ];
  }

  return [
    { label: 'Mode', value: draft.fields.mode === 'charge' ? 'Employee Charge' : 'Cash Discount' },
    { label: 'Date', value: draft.fields.transactionDate ?? 'Missing' },
    { label: 'Product', value: draft.fields.productName ?? 'Missing' },
  ];
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: fontWeights.heavy,
  },
  templatePanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  panelTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  chip: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  chipDisabled: {
    opacity: 0.55,
  },
  chipText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
  },
  faqToggle: {
    minHeight: 62,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  faqToggleActive: {
    borderColor: 'rgba(234, 179, 8, 0.55)',
    backgroundColor: '#fffbeb',
  },
  faqToggleIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  faqToggleTextBlock: {
    flex: 1,
  },
  faqToggleTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: fontWeights.heavy,
  },
  faqToggleSubtitle: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
    marginTop: 2,
  },
  faqToggleState: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  faqPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  faqPanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  faqPageText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.heavy,
  },
  faqGrid: {
    gap: spacing.xs,
  },
  faqButton: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  faqButtonText: {
    color: colors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  faqPager: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pagerButton: {
    minWidth: 86,
    minHeight: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
  },
  pagerButtonDisabled: {
    opacity: 0.35,
  },
  pagerButtonText: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  pagerDots: {
    flex: 1,
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  pagerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#cbd5e1',
  },
  pagerDotActive: {
    width: 18,
    backgroundColor: colors.brand.goldStrong,
  },
  thread: {
    gap: spacing.sm,
  },
  messageRow: {
    flexDirection: 'row',
    width: '100%',
  },
  assistantMessageRow: {
    justifyContent: 'flex-start',
  },
  employeeMessageRow: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '84%',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  assistantBubble: {
    borderTopLeftRadius: 3,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  employeeBubble: {
    borderTopRightRadius: 3,
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  bubbleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  bubbleLabel: {
    color: colors.primary,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
  },
  employeeLabel: {
    color: colors.surface,
  },
  bubbleText: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.medium,
  },
  employeeText: {
    color: colors.surface,
  },
  typingDots: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.muted,
    opacity: 0.75,
  },
  preview: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: '#fde68a',
    backgroundColor: '#fffbeb',
    padding: spacing.md,
    marginTop: spacing.md,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  previewIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitleBlock: {
    flex: 1,
  },
  previewTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
  },
  previewMeta: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: fontWeights.bold,
  },
  previewSummary: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: fontWeights.bold,
  },
  previewFields: {
    borderTopWidth: 1,
    borderTopColor: '#fde68a',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    gap: 6,
  },
  previewFieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  previewFieldLabel: {
    width: 74,
    color: '#92400e',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  previewFieldValue: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
  },
  missingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  missingText: {
    flex: 1,
    color: '#b45309',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: fontWeights.bold,
  },
  openButton: {
    minHeight: 42,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  openButtonText: {
    color: colors.surface,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
  },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#f8fafc',
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.brand.gold,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.55,
  },
});
