import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CheckCircle2, MapPin, RotateCcw, Search, Store, WifiOff, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadPortalStores, type PortalStore } from '../services/storeApprovalWorkflow';
import { getSafeBottomInset } from '../utils/safeArea';
import { colors, fontWeights } from '../theme';

const GOLDILOCKS_COMPANIES = [
  'cake haven incorporation',
  'cakes and occasions corp.',
  'chawnah foods inc.',
  'fresh berry foods corp.',
];

function isGoldilocksCompanyName(company?: string | null): boolean {
  const c = (company || '').trim().toLowerCase();
  if (!c) return false;
  return c.includes('goldilocks') || GOLDILOCKS_COMPANIES.some((comp) => c.includes(comp));
}

function isGoldilocksStore(store: PortalStore): boolean {
  const sName = (store.name || '').trim().toLowerCase();
  const cName = (store.company_name || '').trim().toLowerCase();
  if (cName.includes('du99')) return false;
  if (sName.includes('chatime') || sName.includes('icebergs') || sName.includes('taters')) {
    return false;
  }
  return sName.includes('goldilocks') || isGoldilocksCompanyName(cName);
}

export type StoreDutyModalProps = {
  visible: boolean;
  selectedStoreId?: string | null;
  userCompanyName?: string | null;
  userStoreName?: string | null;
  isOnline?: boolean;
  subtitle?: string;
  onSelectStore: (store: PortalStore) => void;
  onClearStore: () => void;
  onClose: () => void;
};

export function StoreDutyModal({
  visible,
  selectedStoreId,
  userCompanyName,
  userStoreName,
  isOnline = true,
  subtitle,
  onSelectStore,
  onClearStore,
  onClose,
}: StoreDutyModalProps) {
  const insets = useSafeAreaInsets();
  const [stores, setStores] = useState<PortalStore[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!visible) return;
    setSearchQuery('');
    let isMounted = true;
    async function fetchStores() {
      setIsLoading(true);
      try {
        const list = await loadPortalStores();
        if (isMounted) setStores(list);
      } catch {
        // non-fatal
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }
    fetchStores();
    return () => {
      isMounted = false;
    };
  }, [visible]);

  const filteredStores = useMemo(() => {
    const rawUserCompany = (userCompanyName || '').trim().toLowerCase();
    const rawUserStore = (userStoreName || '').trim().toLowerCase();
    const isUserGoldilocks =
      isGoldilocksCompanyName(rawUserCompany) || rawUserStore.includes('goldilocks');

    const active = stores.filter((s) => {
      if (s.is_active === false) return false;

      // If employee is working in Goldilocks (any Goldilocks franchise company or Goldilocks store),
      // show all Goldilocks stores and exclude DU99 and other non-Goldilocks companies.
      if (isUserGoldilocks) {
        return isGoldilocksStore(s);
      }

      if (!rawUserCompany) return true;

      const storeCompany = (s.company_name || '').trim().toLowerCase();
      const storeName = (s.name || '').trim().toLowerCase();

      if (storeCompany) {
        return storeCompany.includes(rawUserCompany) || rawUserCompany.includes(storeCompany);
      }
      return storeName.includes(rawUserCompany);
    });

    const sorted = [...active].sort((a, b) => a.name.localeCompare(b.name));

    const q = searchQuery.trim().toLowerCase();
    if (!q) return sorted;

    return sorted.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.company_name && s.company_name.toLowerCase().includes(q)) ||
        (s.cluster_name && s.cluster_name.toLowerCase().includes(q)) ||
        (s.area_name && s.area_name.toLowerCase().includes(q)),
    );
  }, [stores, searchQuery, userCompanyName, userStoreName]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.backdrop}
      >
        <View style={[styles.card, { paddingBottom: Math.max(getSafeBottomInset(insets.bottom, 0), 16) }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconBox}>
                <Store size={20} color="#2563eb" strokeWidth={2.3} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Select Store Duty</Text>
                <Text style={styles.sub} numberOfLines={2}>
                  {subtitle || 'Choose where you had your duty to route approvals to that store.'}
                </Text>
                {!isOnline ? (
                  <View style={styles.offlineBadge}>
                    <WifiOff size={10} color="#b45309" strokeWidth={2.4} />
                    <Text style={styles.offlineText}>Offline Mode • Using cached stores</Text>
                  </View>
                ) : null}
              </View>
            </View>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <X size={20} color="#64748b" strokeWidth={2.4} />
            </Pressable>
          </View>

          {/* Search */}
          <View style={styles.searchBox}>
            <Search size={16} color="#94a3b8" strokeWidth={2.2} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search store by name, brand, area..."
              placeholderTextColor="#94a3b8"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={6}>
                <X size={15} color="#94a3b8" />
              </Pressable>
            ) : null}
          </View>

          {/* Store List */}
          <ScrollView
            style={styles.listScroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {isLoading && filteredStores.length === 0 ? (
              <View style={styles.emptyWrap}>
                <ActivityIndicator size="small" color="#2563eb" />
                <Text style={styles.emptyTitle}>Loading stores...</Text>
              </View>
            ) : filteredStores.length === 0 ? (
              <View style={styles.emptyWrap}>
                <MapPin size={30} color="#cbd5e1" strokeWidth={1.8} />
                <Text style={styles.emptyTitle}>No stores found</Text>
                <Text style={styles.emptySub}>Try searching with a different store or branch name.</Text>
              </View>
            ) : (
              filteredStores.map((store) => {
                const isSelected = Boolean(selectedStoreId && selectedStoreId === store.id);
                const meta = [store.company_name, store.cluster_name, store.area_name].filter(Boolean).join(' • ');
                return (
                  <Pressable
                    key={store.id}
                    style={[styles.row, isSelected ? styles.rowSelected : null]}
                    onPress={() => onSelectStore(store)}
                  >
                    <View style={[styles.rowIcon, isSelected ? styles.rowIconSelected : null]}>
                      <Store size={16} color={isSelected ? '#ffffff' : '#1d4ed8'} strokeWidth={2.2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, isSelected ? styles.rowTitleSelected : null]} numberOfLines={1}>
                        {store.name}
                      </Text>
                      {meta ? (
                        <Text style={styles.rowMeta} numberOfLines={1}>
                          {meta}
                        </Text>
                      ) : null}
                    </View>
                    {isSelected ? (
                      <CheckCircle2 size={20} color="#2563eb" strokeWidth={2.4} />
                    ) : (
                      <View style={styles.radioEmpty} />
                    )}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            {selectedStoreId ? (
              <Pressable style={styles.resetBtn} onPress={onClearStore}>
                <RotateCcw size={14} color="#475569" strokeWidth={2.3} />
                <Text style={styles.resetText}>Use Default Approvers</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelText}>Close</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingTop: 16,
    paddingHorizontal: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    flex: 1,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontWeight: fontWeights.bold,
    color: colors.text,
  },
  sub: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    lineHeight: 16,
  },
  offlineBadge: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#fef3c7',
  },
  offlineText: {
    fontSize: 10,
    fontWeight: fontWeights.semibold,
    color: '#b45309',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 0,
  },
  listScroll: {
    maxHeight: 380,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  emptySub: {
    fontSize: 12,
    color: colors.muted,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    marginBottom: 8,
  },
  rowSelected: {
    borderColor: '#93c5fd',
    backgroundColor: '#eff6ff',
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconSelected: {
    backgroundColor: '#2563eb',
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: fontWeights.semibold,
    color: colors.text,
  },
  rowTitleSelected: {
    color: '#1e3a8a',
  },
  rowMeta: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  radioEmpty: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  resetBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  resetText: {
    fontSize: 13,
    fontWeight: fontWeights.semibold,
    color: '#475569',
  },
  cancelBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  cancelText: {
    fontSize: 14,
    fontWeight: fontWeights.bold,
    color: '#ffffff',
  },
});
