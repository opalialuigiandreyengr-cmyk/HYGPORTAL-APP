import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { ArrowLeft, BadgePercent, CalendarDays, Check, ChevronDown, Plus, ShoppingCart, X } from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import type { AppToastMessage } from '../components/AppToast';
import { colors, fontWeights, radius, spacing } from '../theme';
import type { AssistantDraft } from '../services/assistant';
import { loadPerkUsage, startPerkRequest, verifyPerkRequest, type PerkProductInput, type PerkUsage } from '../services/perks';
import { formatDateInput, dateStringToDate } from '../utils/dateTime';

type DiscountMode = 'cash' | 'charge';

type ProductLine = {
  id: string;
  productName: string;
  quantity: string;
  unitPrice: string;
};

type ProductOption = {
  name: string;
  price: number;
};

const inventoryUrl = 'https://luigiandreyopalia.pythonanywhere.com/inventory/store_inventory_data';
const today = formatDateInput(new Date());

export function ApplyDiscountScreen({
  name,
  photoUrl,
  initialDraft,
  onAssistant,
  onBack,
  onToast,
  onSubmitted,
}: {
  name?: string | null;
  photoUrl?: string | null;
  initialDraft?: Extract<AssistantDraft, { intent: 'draft_perk_request' }> | null;
  onAssistant?: () => void;
  onBack: () => void;
  onToast?: (toast: AppToastMessage) => void;
  onSubmitted?: () => void | Promise<void>;
}) {
  const [mode, setMode] = useState<DiscountMode>(initialDraft?.fields.mode ?? 'cash');
  const [transactionDate, setTransactionDate] = useState(initialDraft?.fields.transactionDate ?? today);
  const [activePicker, setActivePicker] = useState(false);
  const [tempPickerDate, setTempPickerDate] = useState(new Date());
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [productQuery, setProductQuery] = useState('');
  const [productLines, setProductLines] = useState<ProductLine[]>([
    {
      id: '1',
      productName: initialDraft?.fields.productName ?? 'Select product',
      quantity: initialDraft?.fields.quantity ?? '0',
      unitPrice: initialDraft?.fields.unitPrice ?? '0.00',
    },
  ]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [productStatus, setProductStatus] = useState('');
  const [submitStatus, setSubmitStatus] = useState('');
  const [usage, setUsage] = useState<PerkUsage | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [approvalCode, setApprovalCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState<{
    requestId: string;
    email: string;
    requestLabel: string;
  } | null>(null);
  const formScrollRef = useRef<ScrollView>(null);

  const totals = useMemo(() => {
    const purchaseAmount = productLines.reduce((sum, line) => {
      return sum + parseAmount(line.quantity) * parseAmount(line.unitPrice);
    }, 0);
    const creditDiscountApplies = mode === 'charge' && !usage?.creditFirstDiscountUsed;
    const discountAmount = mode === 'cash' || creditDiscountApplies ? purchaseAmount * 0.15 : 0;
    const finalAmount = Math.max(purchaseAmount - discountAmount, 0);
    return { purchaseAmount, discountAmount, finalAmount, creditDiscountApplies };
  }, [mode, productLines, usage?.creditFirstDiscountUsed]);

  const activeProduct = productLines.find((line) => line.id === activeProductId) ?? null;
  const initialProductLine = {
    productName: initialDraft?.fields.productName ?? 'Select product',
    quantity: initialDraft?.fields.quantity ?? '0',
    unitPrice: initialDraft?.fields.unitPrice ?? '0.00',
  };
  const hasUnsavedChanges =
    mode !== (initialDraft?.fields.mode ?? 'cash') ||
    transactionDate !== (initialDraft?.fields.transactionDate ?? today) ||
    productLines.length !== 1 ||
    productLines.some((line, index) => {
      if (index > 0) {
        return true;
      }
      return (
        line.productName !== initialProductLine.productName ||
        line.quantity !== initialProductLine.quantity ||
        line.unitPrice !== initialProductLine.unitPrice
      );
    }) ||
    Boolean(emailInput.trim()) ||
    Boolean(approvalCode.trim()) ||
    Boolean(pendingVerification);
  const filteredProducts = useMemo(() => {
    const normalizedQuery = productQuery.trim().toLowerCase();
    if (!normalizedQuery) return products;
    return products.filter((product) => product.name.toLowerCase().includes(normalizedQuery));
  }, [productQuery, products]);

  useEffect(() => {
    loadInventoryProducts();
    refreshUsage();
  }, []);

  function confirmDiscard(action: () => void) {
    if (!hasUnsavedChanges || isSubmitting || isVerifying) {
      action();
      return;
    }

    Alert.alert('Discard perk request?', 'Your perk request has unsaved changes.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: action },
    ]);
  }

  async function refreshUsage() {
    try {
      setUsage(await loadPerkUsage());
    } catch {
      setUsage(null);
    }
  }

  async function loadInventoryProducts() {
    setIsLoadingProducts(true);
    setProductStatus('Loading products...');
    try {
      const response = await fetch(inventoryUrl, {
        headers: { Accept: 'application/json' },
      });
      const payload = await response.json();
      const inventories = Array.isArray(payload?.inventories) ? payload.inventories : [];
      const nextProducts = inventories
        .map((item: { item_name?: unknown; price?: unknown }) => {
          const productName = typeof item.item_name === 'string' ? item.item_name.trim() : '';
          const price = Number(item.price ?? 0);
          return productName ? { name: productName, price: Number.isFinite(price) ? price : 0 } : null;
        })
        .filter((item: ProductOption | null): item is ProductOption => Boolean(item));

      setProducts(nextProducts);
      setProductStatus(nextProducts.length ? '' : 'No products loaded. Enter product details manually.');
    } catch {
      setProducts([]);
      setProductStatus('Products unavailable. Enter product details manually.');
    } finally {
      setIsLoadingProducts(false);
    }
  }

  function openDatePicker() {
    setTempPickerDate(dateStringToDate(transactionDate));
    setActivePicker(true);
  }

  function handleDateChange(event: DateTimePickerEvent, selectedDate?: Date) {
    if (event.type === 'dismissed') {
      setActivePicker(false);
      return;
    }

    if (!selectedDate) return;

    if (Platform.OS === 'ios') {
      setTempPickerDate(selectedDate);
      return;
    }

    setTransactionDate(formatDateInput(selectedDate));
    setActivePicker(false);
  }

  function confirmIosDate() {
    setTransactionDate(formatDateInput(tempPickerDate));
    setActivePicker(false);
  }

  function addProductLine() {
    setProductLines((current) => [
      ...current,
      { id: String(Date.now()), productName: 'Select product', quantity: '0', unitPrice: '0.00' },
    ]);
  }

  function removeLastProductLine() {
    setProductLines((current) => {
      if (current.length <= 1) {
        return current.map((line) => ({ ...line, productName: 'Select product', quantity: '0', unitPrice: '0.00' }));
      }
      return current.slice(0, -1);
    });
  }

  function updateLine(id: string, patch: Partial<ProductLine>) {
    setProductLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function selectProduct(product: ProductOption) {
    if (!activeProductId) return;
    const currentLine = productLines.find((line) => line.id === activeProductId);
    updateLine(activeProductId, {
      productName: product.name,
      quantity: currentLine && parseAmount(currentLine.quantity) > 0 ? currentLine.quantity : '1',
      unitPrice: product.price.toFixed(2),
    });
    setActiveProductId(null);
    setProductQuery('');
  }

  function buildProducts() {
    return productLines
      .map((line) => ({
        name: line.productName === 'Select product' ? '' : line.productName.trim(),
        quantity: parseAmount(line.quantity),
        price: parseAmount(line.unitPrice),
      }))
      .filter((line) => line.name && line.quantity > 0 && line.price > 0)
      .map((line) => ({
        name: line.name,
        quantity: Math.floor(line.quantity),
        price: line.price,
      })) satisfies PerkProductInput[];
  }

  async function submit() {
    const selectedProducts = buildProducts();
    if (!transactionDate || !selectedProducts.length || totals.purchaseAmount <= 0) {
      setSubmitStatus('Please complete the transaction date and product details.');
      onToast?.({
        tone: 'warning',
        title: 'Incomplete discount',
        message: 'Add at least one product with quantity and unit price.',
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('Sending approval code...');
    try {
      const started = await startPerkRequest({
        formType: mode === 'cash' ? 'discount' : 'charge',
        transactionDate,
        products: selectedProducts,
        email: emailInput,
      });
      setPendingVerification(started);
      setShowEmailInput(false);
      setSubmitStatus(`Approval code sent to ${started.email}.`);
      onToast?.({
        tone: 'success',
        title: 'Code sent',
        message: 'Check your registered email for the approval code.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to send approval code.';
      setSubmitStatus(message);
      if (message.toLowerCase().includes('registered email')) {
        setShowEmailInput(true);
      }
      onToast?.({
        tone: 'error',
        title: 'Request not sent',
        message,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function verifyCode() {
    if (!pendingVerification || !approvalCode.trim()) {
      setSubmitStatus('Enter the approval code sent to your email.');
      return;
    }

    setIsVerifying(true);
    setSubmitStatus('Verifying approval code...');
    try {
      await verifyPerkRequest(pendingVerification.requestId, approvalCode.trim());
      await refreshUsage();
      setSubmitStatus('Request approved. E-receipt sent to your email.');
      onToast?.({
        tone: 'success',
        title: 'Request approved',
        message: 'Your e-receipt was sent to your registered email.',
      });
      await onSubmitted?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to verify approval code.';
      setSubmitStatus(message);
      onToast?.({
        tone: 'error',
        title: 'Code not accepted',
        message,
      });
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar name={name} photoUrl={photoUrl} onMessages={onAssistant ? () => confirmDiscard(onAssistant) : undefined} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
        style={styles.keyboardAvoider}
      >
      <ScrollView
        ref={formScrollRef}
        contentContainerStyle={[
          styles.scroll,
          showEmailInput || pendingVerification ? styles.scrollWithKeyboardPanel : null,
        ]}
        alwaysBounceVertical
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => confirmDiscard(onBack)}>
            <ArrowLeft size={20} color={colors.text} strokeWidth={2.5} />
          </Pressable>
          <View style={styles.headerText}>
            <Text style={styles.title}>Apply Discount</Text>
          </View>
        </View>

        <View style={styles.modeGrid}>
          <ModeCard
            active={mode === 'cash'}
            icon={<BadgePercent size={20} color="#f97316" strokeWidth={2.7} />}
            title="Employee Discount (Cash)"
            detail="15% off, PHP 3,000 yearly cap"
            onPress={() => setMode('cash')}
          />
          <ModeCard
            active={mode === 'charge'}
            icon={<ShoppingCart size={20} color={colors.primary} strokeWidth={2.7} />}
            title="Employee Charge (Credit)"
            detail="PHP 3,000 per transaction"
            onPress={() => setMode('charge')}
          />
        </View>

        <View style={styles.formCard}>
          <View style={styles.cardTitleRow}>
            <View style={styles.modeIconSmall}>
              {mode === 'cash' ? (
                <BadgePercent size={17} color="#f97316" strokeWidth={2.7} />
              ) : (
                <ShoppingCart size={17} color={colors.primary} strokeWidth={2.7} />
              )}
            </View>
            <View style={styles.cardTitleBlock}>
              <Text style={styles.cardTitle}>
                {mode === 'cash' ? 'Employee Discount (Cash)' : 'Employee Charge (Credit)'}
              </Text>
              <Text style={styles.cardSubtitle}>
                {mode === 'cash' ? '15% off, PHP 3,000 yearly cap, max 6 transactions' : 'PHP 3,000 yearly cap, first credit gets 15% off'}
              </Text>
            </View>
          </View>

          <UsagePanel mode={mode} usage={usage} />

          <FieldLabel label="Transaction date" />
          <Pressable style={styles.dateButton} onPress={openDatePicker}>
            <Text style={transactionDate ? styles.dateText : styles.placeholderText}>
              {formatDateDisplay(transactionDate) || 'mm/dd/yyyy'}
            </Text>
            <CalendarDays size={16} color={colors.text} strokeWidth={2.4} />
          </Pressable>

          <View style={styles.productsHeader}>
            <Text style={styles.productsTitle}>Products</Text>
            <View style={styles.productHeaderActions}>
              <Pressable style={styles.removeProductButton} onPress={removeLastProductLine}>
                <X size={16} color={colors.semantic.danger} strokeWidth={2.8} />
              </Pressable>
              <Pressable style={styles.addProductButton} onPress={addProductLine}>
                <Plus size={15} color={colors.text} strokeWidth={2.7} />
                <Text style={styles.addProductText}>Add product</Text>
              </Pressable>
            </View>
          </View>
          {productStatus ? <Text style={styles.productStatus}>{productStatus}</Text> : null}

          <View style={styles.productColumns}>
            <Text style={[styles.productColumnLabel, styles.productNameColumn]}>Product name</Text>
            <Text style={[styles.productColumnLabel, styles.quantityColumn]}>Quantity</Text>
            <Text style={[styles.productColumnLabel, styles.priceColumn]}>Unit price (PHP)</Text>
          </View>

          {productLines.map((line) => (
            <View key={line.id} style={styles.productRow}>
              {products.length ? (
                <Pressable
                  disabled={isLoadingProducts}
                  style={[
                    styles.productInput,
                    styles.productNameColumn,
                    isLoadingProducts ? styles.productInputDisabled : null,
                  ]}
                  onPress={() => {
                    setProductQuery('');
                    setActiveProductId(line.id);
                  }}
                >
                  <Text
                    style={[
                      styles.productInputText,
                      line.productName === 'Select product' ? styles.placeholderText : null,
                      isLoadingProducts ? styles.productInputTextDisabled : null,
                    ]}
                    numberOfLines={1}
                  >
                    {isLoadingProducts ? 'Loading products...' : line.productName}
                  </Text>
                  <ChevronDown size={14} color={colors.muted} strokeWidth={2.5} />
                </Pressable>
              ) : (
                <TextInput
                  value={line.productName === 'Select product' ? '' : line.productName}
                  onChangeText={(value) => updateLine(line.id, { productName: value })}
                  placeholder={isLoadingProducts ? 'Loading products...' : 'Enter product'}
                  placeholderTextColor={colors.muted}
                  editable={!isLoadingProducts}
                  style={[
                    styles.productTextInput,
                    styles.productNameColumn,
                    isLoadingProducts ? styles.productInputDisabled : null,
                  ]}
                />
              )}
              <TextInput
                value={line.quantity}
                onChangeText={(value) => updateLine(line.id, { quantity: value })}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.muted}
                style={[styles.productTextInput, styles.quantityColumn]}
              />
              <TextInput
                value={line.unitPrice}
                onChangeText={(value) => updateLine(line.id, { unitPrice: value })}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                style={[styles.productTextInput, styles.priceColumn]}
              />
            </View>
          ))}

          <View style={styles.amountPanel}>
            <AmountRow label="Purchase amount" value={formatMoney(totals.purchaseAmount)} />
            <AmountRow
              label={totals.discountAmount > 0 ? 'Discount 15%' : 'Discount'}
              value={formatMoney(totals.discountAmount)}
            />
            <AmountRow label={mode === 'cash' ? 'Cash total' : 'Charge total'} value={formatMoney(totals.finalAmount)} />
          </View>

          {showEmailInput ? (
            <View style={styles.emailPanel}>
              <Text style={styles.emailTitle}>Email required</Text>
              <Text style={styles.emailHint}>Enter your email address. It will be saved to your employee profile before sending the approval code.</Text>
              <TextInput
                value={emailInput}
                onChangeText={setEmailInput}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="name@email.com"
                placeholderTextColor={colors.muted}
                style={styles.emailInput}
                onFocus={() => {
                  setTimeout(() => formScrollRef.current?.scrollToEnd({ animated: true }), 120);
                }}
              />
            </View>
          ) : null}

          {pendingVerification ? (
            <View style={styles.verifyPanel}>
              <Text style={styles.emailTitle}>Approval code</Text>
              <Text style={styles.emailHint}>Code sent to {pendingVerification.email}. Verify it to auto-approve this request and send your e-receipt.</Text>
              <TextInput
                value={approvalCode}
                onChangeText={setApprovalCode}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="000000"
                placeholderTextColor={colors.muted}
                style={styles.codeInput}
                onFocus={() => {
                  setTimeout(() => formScrollRef.current?.scrollToEnd({ animated: true }), 120);
                }}
              />
              <Pressable
                disabled={isVerifying}
                style={[styles.submitButton, isVerifying ? styles.submitButtonDisabled : null]}
                onPress={verifyCode}
              >
                <Check size={16} color={colors.brand.ink} strokeWidth={2.8} />
                <Text style={styles.submitText}>{isVerifying ? 'Verifying...' : 'Verify and approve'}</Text>
              </Pressable>
            </View>
          ) : null}

          {!pendingVerification ? (
          <Pressable
            disabled={isSubmitting}
            style={[styles.submitButton, isSubmitting ? styles.submitButtonDisabled : null]}
            onPress={submit}
          >
            <BadgePercent size={16} color={colors.brand.ink} strokeWidth={2.8} />
            <Text style={styles.submitText}>
              {isSubmitting ? 'Sending code...' : mode === 'cash' ? 'Apply cash discount' : 'Apply employee charge'}
            </Text>
          </Pressable>
          ) : null}
          {submitStatus ? <Text style={styles.submitStatus}>{submitStatus}</Text> : null}
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {activePicker && Platform.OS === 'ios' ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setActivePicker(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.iosPickerPanel}>
              <DateTimePicker value={tempPickerDate} mode="date" display="spinner" onChange={handleDateChange} />
              <View style={styles.iosPickerActions}>
                <Pressable style={styles.iosPickerCancel} onPress={() => setActivePicker(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.iosPickerDone} onPress={confirmIosDate}>
                  <Text style={styles.doneText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : activePicker ? (
        <DateTimePicker value={dateStringToDate(transactionDate)} mode="date" display="default" onChange={handleDateChange} />
      ) : null}

      {activeProduct ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setActiveProductId(null)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={styles.modalDismissArea} onPress={() => setActiveProductId(null)} />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
              style={styles.keyboardSheetWrap}
            >
              <View style={styles.optionSheet}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>Select product</Text>
                <TextInput
                  value={productQuery}
                  onChangeText={setProductQuery}
                  placeholder="Search product..."
                  placeholderTextColor={colors.muted}
                  style={styles.productSearchInput}
                  returnKeyType="search"
                />
                <ScrollView style={styles.optionList} contentContainerStyle={styles.optionListContent} showsVerticalScrollIndicator={false}>
                  {filteredProducts.map((option) => {
                    const selected = activeProduct.productName === option.name;
                    return (
                      <Pressable
                        key={option.name}
                        style={[styles.optionRow, selected ? styles.optionRowActive : null]}
                        onPress={() => selectProduct(option)}
                      >
                        <View style={styles.optionTextBlock}>
                          <Text style={[styles.optionText, selected ? styles.optionTextActive : null]} numberOfLines={2}>
                            {option.name}
                          </Text>
                          {option.price > 0 ? <Text style={styles.optionMeta}>PHP {formatMoney(option.price)}</Text> : null}
                        </View>
                        {selected ? <Check size={18} color={colors.brand.goldStrong} strokeWidth={3} /> : null}
                      </Pressable>
                    );
                  })}
                  {!filteredProducts.length && !isLoadingProducts ? (
                    <View style={styles.optionEmpty}>
                      <Text style={styles.optionEmptyText}>
                        {products.length ? 'No products match your search.' : 'No products available from inventory.'}
                      </Text>
                    </View>
                  ) : null}
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

function ModeCard({
  active,
  icon,
  title,
  detail,
  onPress,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.modeCard, active ? styles.modeCardActive : null]} onPress={onPress}>
      <View style={styles.modeIcon}>{icon}</View>
      <View style={styles.modeText}>
        <Text style={styles.modeTitle}>{title}</Text>
        <Text style={styles.modeDetail}>{detail}</Text>
      </View>
      <View style={[styles.modeCheck, active ? styles.modeCheckActive : null]}>
        {active ? <Check size={15} color={colors.brand.ink} strokeWidth={3} /> : null}
      </View>
    </Pressable>
  );
}

function UsagePanel({ mode, usage }: { mode: DiscountMode; usage: PerkUsage | null }) {
  const cashUsed = usage?.cashAmountUsed ?? 0;
  const cashLimit = usage?.cashAmountLimit ?? 3000;
  const cashTransactions = usage?.cashTransactionsUsed ?? 0;
  const cashTransactionLimit = usage?.cashTransactionsLimit ?? 6;
  const creditUsed = usage?.creditAmountUsed ?? 0;
  const creditLimit = usage?.creditAmountLimit ?? 3000;
  const creditTransactions = usage?.creditTransactionsUsed ?? 0;
  const creditDiscountUsed = usage?.creditFirstDiscountUsed ?? false;

  return (
    <View style={styles.usagePanel}>
      <UsageRow
        label={mode === 'cash' ? 'Yearly cash cap used' : 'Yearly credit cap used'}
        value={mode === 'cash' ? `PHP ${formatMoney(cashUsed)} / ${formatMoney(cashLimit)}` : `PHP ${formatMoney(creditUsed)} / ${formatMoney(creditLimit)}`}
      />
      <UsageRow
        label={mode === 'cash' ? 'Cash transactions used' : 'First credit discount'}
        value={mode === 'cash' ? `${cashTransactions} / ${cashTransactionLimit} this year` : `${creditDiscountUsed ? 'Used' : 'Available'} • ${creditTransactions} transaction(s)`}
      />
    </View>
  );
}

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.usageRow}>
      <Text style={styles.usageLabel}>{label}</Text>
      <Text style={styles.usageValue}>{value}</Text>
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

function AmountRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.amountRow}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={styles.amountValue}>{value}</Text>
    </View>
  );
}

function parseAmount(value: string) {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number) {
  return value.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateDisplay(value: string) {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoider: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    padding: spacing.md,
    paddingBottom: 140,
  },
  scrollWithKeyboardPanel: {
    paddingBottom: 280,
  },
  header: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 21,
    lineHeight: 26,
    color: colors.text,
    fontWeight: fontWeights.heavy,
  },
  modeGrid: {
    flexDirection: 'column',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeCard: {
    flex: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.sm,
  },
  modeCardActive: {
    borderColor: colors.brand.goldStrong,
    backgroundColor: '#fffbeb',
  },
  modeIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeText: {
    flex: 1,
    minWidth: 0,
  },
  modeCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeCheckActive: {
    borderColor: colors.brand.goldStrong,
    backgroundColor: colors.brand.gold,
  },
  modeTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  modeDetail: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
  },
  formCard: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeIconSmall: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    backgroundColor: '#fffbeb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
  },
  cardSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
  },
  usagePanel: {
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.md,
  },
  usageRow: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  usageLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
  },
  usageValue: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
    marginBottom: 8,
  },
  dateButton: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  dateText: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.bold,
  },
  placeholderText: {
    color: '#94a3b8',
  },
  productsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  productsTitle: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: fontWeights.heavy,
  },
  productHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  removeProductButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addProductButton: {
    minHeight: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
  },
  addProductText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: fontWeights.heavy,
  },
  productStatus: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    marginTop: -4,
    marginBottom: spacing.sm,
  },
  productColumns: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    marginBottom: 5,
  },
  productColumnLabel: {
    color: colors.text,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.bold,
  },
  productNameColumn: {
    flex: 1.35,
  },
  quantityColumn: {
    flex: 0.58,
  },
  priceColumn: {
    flex: 0.78,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: spacing.sm,
  },
  productInput: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
  },
  productInputDisabled: {
    opacity: 0.62,
  },
  productInputText: {
    flex: 1,
    minWidth: 0,
    color: colors.text,
    fontSize: 13,
    fontWeight: fontWeights.medium,
  },
  productInputTextDisabled: {
    color: colors.muted,
  },
  productTextInput: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 13,
    fontWeight: fontWeights.medium,
    paddingHorizontal: 9,
    paddingVertical: 0,
  },
  amountPanel: {
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  amountRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  amountLabel: {
    flex: 1,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
  },
  amountValue: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: fontWeights.heavy,
  },
  submitButton: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.brand.gold,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  submitButtonDisabled: {
    opacity: 0.65,
  },
  submitText: {
    color: colors.brand.ink,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: fontWeights.heavy,
  },
  submitStatus: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.bold,
    marginTop: spacing.sm,
  },
  emailPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.semantic.warning,
    backgroundColor: '#fffbeb',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  verifyPanel: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  emailTitle: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: fontWeights.heavy,
  },
  emailHint: {
    marginTop: 3,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
  },
  emailInput: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    marginTop: spacing.sm,
  },
  codeInput: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: fontWeights.heavy,
    letterSpacing: 4,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
    justifyContent: 'flex-end',
  },
  modalDismissArea: {
    flex: 1,
  },
  iosPickerPanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  iosPickerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  iosPickerCancel: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosPickerDone: {
    flex: 1,
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
  },
  doneText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: fontWeights.heavy,
  },
  optionSheet: {
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  keyboardSheetWrap: {
    width: '100%',
    justifyContent: 'flex-end',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: fontWeights.heavy,
    marginBottom: spacing.sm,
  },
  productSearchInput: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: 15,
    fontWeight: fontWeights.medium,
    paddingHorizontal: spacing.md,
    paddingVertical: 0,
    marginBottom: spacing.sm,
  },
  optionList: {
    maxHeight: 420,
  },
  optionListContent: {
    paddingBottom: spacing.xs,
  },
  optionRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    marginBottom: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#eef2f7',
  },
  optionRowActive: {
    backgroundColor: '#fffbeb',
    borderColor: 'rgba(234, 179, 8, 0.4)',
  },
  optionText: {
    color: colors.text,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: fontWeights.bold,
    textAlign: 'center',
  },
  optionTextActive: {
    color: '#92400e',
  },
  optionTextBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionMeta: {
    marginTop: 2,
    color: colors.brand.goldStrong,
    fontSize: 12,
    lineHeight: 15,
    fontWeight: fontWeights.heavy,
    textAlign: 'center',
  },
  optionEmpty: {
    minHeight: 50,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  optionEmptyText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: fontWeights.medium,
    textAlign: 'center',
  },
});
