import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Svg, { Path } from 'react-native-svg';
import {
  CircleHelp,
  Clapperboard,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Tv,
  X,
} from 'lucide-react-native';

import { TopBar } from '../components/TopBar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSafeBottomInset } from '../utils/safeArea';
import { colors, fontWeights } from '../theme';
import type { ProfileLoadResult } from '../types/domain';
import type { AppToastMessage } from '../components/AppToast';
import {
  getYouTubeEmbedUrl,
  getYouTubeThumbnailUrl,
  loadPortalTutorials,
  type PortalTutorial,
} from '../services/tutorials';

function YouTubeIcon({ size = 16, color = '#dc2626' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19.1c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.43z"
        fill={color}
      />
      <Path d="m9.75 15.02 5.75-3.27-5.75-3.27v6.54z" fill="#ffffff" />
    </Svg>
  );
}

type Props = {
  profileResult?: ProfileLoadResult | null;
  notificationCount?: number;
  pointsBalance?: number;
  onAssistant?: () => void;
  onNotifications?: () => void;
  onOpenProfile?: () => void;
  onOpenRewards?: () => void;
  onBackHome?: () => void;
  onToast?: (toast: AppToastMessage) => void;
};

export function TutorialsScreen({
  profileResult,
  notificationCount = 0,
  pointsBalance = 0,
  onAssistant,
  onNotifications,
  onOpenProfile,
  onOpenRewards,
  onBackHome,
  onToast,
}: Props) {
  const insets = useSafeAreaInsets();
  const profile = profileResult?.status === 'linked' ? profileResult.profile : null;
  const [tutorials, setTutorials] = useState<PortalTutorial[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTutorial, setSelectedTutorial] = useState<PortalTutorial | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchTutorials = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const data = await loadPortalTutorials();
      setTutorials(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to load tutorials';
      setErrorMessage(msg);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchTutorials();
  }, [fetchTutorials]);

  const filteredTutorials = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return tutorials.filter((item) => {
      if (!item.isActive) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.youtubeUrl.toLowerCase().includes(q)
      );
    });
  }, [tutorials, searchQuery]);

  async function handleOpenVideo(tutorial: PortalTutorial) {
    const targetUrl = tutorial.youtubeUrl || (tutorial.videoId ? `https://www.youtube.com/watch?v=${tutorial.videoId}` : '');
    if (!targetUrl) {
      onToast?.({
        tone: 'error',
        title: 'Video Unavailable',
        message: 'No YouTube link is attached to this tutorial.',
      });
      return;
    }

    if (Platform.OS === 'web') {
      setSelectedTutorial(tutorial);
      return;
    }

    if (Platform.OS === 'android' && tutorial.videoId) {
      try {
        await Linking.openURL(`vnd.youtube:${tutorial.videoId}`);
        return;
      } catch {
        // Fallback to web URL if YouTube app protocol is not handled
      }
    }

    try {
      await Linking.openURL(targetUrl);
    } catch {
      setSelectedTutorial(tutorial);
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <TopBar
        name={profile?.fullName}
        username={profile?.username}
        photoUrl={profile?.photoUrl}
        pointsBalance={pointsBalance}
        notificationCount={notificationCount}
        onMessages={onAssistant}
        onNotifications={onNotifications}
        onOpenProfile={onOpenProfile}
        onOpenRewards={onOpenRewards}
        onBackHome={onBackHome}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: getSafeBottomInset(insets.bottom, 20) + 30 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => fetchTutorials(true)}
            colors={[colors.brand.gold, colors.primary]}
            tintColor={colors.brand.gold}
            progressBackgroundColor="#ffffff"
          />
        }
      >
        {/* Hero Header Card */}
        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroIconWrapper}>
              <Clapperboard size={24} color="#ffffff" strokeWidth={2.4} />
            </View>
            <View style={styles.heroTextCol}>
              <View style={styles.heroBadgeRow}>
                <Text style={styles.heroTitle}>HYG Portal Tutorials</Text>
                <View style={styles.youtubeTag}>
                  <YouTubeIcon size={14} color="#dc2626" />
                  <Text style={styles.youtubeTagText}>Video Guides</Text>
                </View>
              </View>
              <Text style={styles.heroSubtitle}>
                Learn how to navigate and use HYG Portal features with quick video walkthroughs.
              </Text>
            </View>
          </View>

          {/* Search Box */}
          <View style={styles.searchBox}>
            <Search size={18} color={colors.muted} strokeWidth={2.4} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search guides by title or keyword..."
              placeholderTextColor="#94a3b8"
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {searchQuery.length > 0 ? (
              <TouchableOpacity
                onPress={() => setSearchQuery('')}
                hitSlop={8}
                style={styles.searchClearBtn}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <X size={16} color={colors.muted} strokeWidth={2.4} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/* Error Notification */}
        {errorMessage ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{errorMessage}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => fetchTutorials()}>
              <RefreshCw size={14} color={colors.primary} strokeWidth={2.4} />
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Content Section */}
        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={styles.loadingText}>Loading video guides...</Text>
          </View>
        ) : filteredTutorials.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIconCircle}>
              <Tv size={36} color="#94a3b8" strokeWidth={2} />
            </View>
            <Text style={styles.emptyTitle}>
              {searchQuery ? 'No tutorials found' : 'No tutorials available yet'}
            </Text>
            <Text style={styles.emptySub}>
              {searchQuery
                ? `No guides matched "${searchQuery}". Try different keywords.`
                : 'Tutorial videos published by administrators will appear here.'}
            </Text>
            {searchQuery ? (
              <TouchableOpacity style={styles.clearSearchBtn} onPress={() => setSearchQuery('')}>
                <Text style={styles.clearSearchText}>Clear Search</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.clearSearchBtn} onPress={() => fetchTutorials()}>
                <RefreshCw size={15} color="#ffffff" strokeWidth={2.4} />
                <Text style={styles.clearSearchText}>Refresh</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <View style={styles.listContainer}>
            <View style={styles.listHeaderRow}>
              <Text style={styles.listCountText}>
                {filteredTutorials.length} {filteredTutorials.length === 1 ? 'Tutorial' : 'Tutorials'} Available
              </Text>
              <Text style={styles.listTipText}>Tap any video to watch</Text>
            </View>

            {filteredTutorials.map((item) => (
              <TutorialCard
                key={item.id}
                tutorial={item}
                onPlay={() => handleOpenVideo(item)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {/* Video Preview / Playback Modal */}
      {selectedTutorial ? (
        <TutorialModal
          tutorial={selectedTutorial}
          onClose={() => setSelectedTutorial(null)}
          onOpenExternal={async () => {
            const videoId = selectedTutorial.videoId;
            const url =
              selectedTutorial.youtubeUrl ||
              (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '');
            if (Platform.OS === 'android' && videoId) {
              try {
                await Linking.openURL(`vnd.youtube:${videoId}`);
                return;
              } catch {
                // Fallback to web URL
              }
            }
            if (url) {
              void Linking.openURL(url);
            }
          }}
        />
      ) : null}
    </View>
  );
}

const TutorialCard = memo(function TutorialCard({
  tutorial,
  onPlay,
}: {
  tutorial: PortalTutorial;
  onPlay: () => void;
}) {
  const [imageError, setImageError] = useState(false);
  const thumbnailUrl = tutorial.videoId ? getYouTubeThumbnailUrl(tutorial.videoId) : '';

  return (
    <View style={styles.card}>
      {/* 16:9 Video Thumbnail Preview */}
      <TouchableOpacity
        activeOpacity={0.88}
        style={styles.thumbnailWrapper}
        onPress={onPlay}
        accessibilityRole="button"
        accessibilityLabel={`Play ${tutorial.title}`}
      >
        {thumbnailUrl && !imageError ? (
          <Image
            source={{ uri: thumbnailUrl }}
            style={styles.thumbnailImage}
            resizeMode="cover"
            onError={() => setImageError(true)}
          />
        ) : (
          <View style={styles.thumbnailFallback}>
            <Tv size={42} color="#64748b" strokeWidth={1.8} />
            <Text style={styles.thumbnailFallbackText}>HYG Tutorial Video</Text>
          </View>
        )}

        {/* Thumbnail Overlay Gradient */}
        <View style={styles.thumbnailOverlay} />

        {/* Central Play Button */}
        <View style={styles.playButtonCircle}>
          <Play size={24} color="#ffffff" fill="#ffffff" style={{ marginLeft: 3 }} />
        </View>
      </TouchableOpacity>

      {/* Card Info Content */}
      <View style={styles.cardContent}>
        <TouchableOpacity activeOpacity={0.7} onPress={onPlay}>
          <Text style={styles.cardTitle} numberOfLines={2}>
            {tutorial.title}
          </Text>
        </TouchableOpacity>

        {tutorial.description ? (
          <Text style={styles.cardDesc} numberOfLines={3}>
            {tutorial.description}
          </Text>
        ) : (
          <Text style={[styles.cardDesc, styles.cardDescEmpty]}>
            Interactive walkthrough guide for HYG Portal.
          </Text>
        )}

        {/* Action Row */}
        <View style={styles.cardActionRow}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={styles.watchNowBtn}
            onPress={onPlay}
          >
            <Play size={15} color="#ffffff" fill="#ffffff" />
            <Text style={styles.watchNowText}>Watch Video</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

function TutorialModal({
  tutorial,
  onClose,
  onOpenExternal,
}: {
  tutorial: PortalTutorial;
  onClose: () => void;
  onOpenExternal: () => void;
}) {
  const embedUrl = tutorial.videoId ? getYouTubeEmbedUrl(tutorial.videoId) : '';
  const thumbnailUrl = tutorial.videoId ? getYouTubeThumbnailUrl(tutorial.videoId) : '';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <Pressable style={styles.absoluteFill} onPress={onClose} />
        <View style={styles.modalCard}>
          {/* Modal Header */}
          <View style={styles.modalHeader}>
            <View style={styles.modalHeaderTitleWrap}>
              <View style={styles.modalIconWrap}>
                <YouTubeIcon size={18} color="#dc2626" />
              </View>
              <Text style={styles.modalHeaderTitle} numberOfLines={1}>
                Tutorial Preview
              </Text>
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={onClose} hitSlop={10}>
              <X size={20} color="#64748b" strokeWidth={2.4} />
            </TouchableOpacity>
          </View>

          {/* Video Preview or Iframe */}
          <View style={styles.modalVideoContainer}>
            {Platform.OS === 'web' && embedUrl ? (
              <iframe
                src={embedUrl}
                title={tutorial.title}
                style={{
                  width: '100%',
                  height: '100%',
                  border: 'none',
                }}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <TouchableOpacity activeOpacity={0.9} style={styles.modalNativePlayer} onPress={onOpenExternal}>
                {thumbnailUrl ? (
                  <Image source={{ uri: thumbnailUrl }} style={styles.modalThumbnailImage} resizeMode="cover" />
                ) : (
                  <View style={styles.thumbnailFallback}>
                    <Tv size={48} color="#64748b" />
                  </View>
                )}
                <View style={styles.thumbnailOverlay} />
                <View style={styles.modalLargePlayBtn}>
                  <Play size={32} color="#ffffff" fill="#ffffff" style={{ marginLeft: 4 }} />
                </View>
                <View style={styles.modalTapToPlayBanner}>
                  <Text style={styles.modalTapToPlayText}>Tap to open in YouTube</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          {/* Modal Details */}
          <ScrollView style={styles.modalDetailsScroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.modalTitle}>{tutorial.title}</Text>
            {tutorial.description ? (
              <Text style={styles.modalDescription}>{tutorial.description}</Text>
            ) : null}

            {/* Quick Tips */}
            <View style={styles.modalTipCard}>
              <Sparkles size={16} color={colors.primary} strokeWidth={2.4} />
              <Text style={styles.modalTipText}>
                Watch in full-screen or on the YouTube app for the best HD clarity and playback controls.
              </Text>
            </View>
          </ScrollView>

          {/* Modal Footer Actions */}
          <View style={styles.modalFooter}>
            <TouchableOpacity activeOpacity={0.82} style={styles.modalLaunchBtn} onPress={onOpenExternal}>
              <YouTubeIcon size={18} color="#ffffff" />
              <Text style={styles.modalLaunchBtnText}>Open in YouTube</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.7} style={styles.modalDismissBtn} onPress={onClose}>
              <Text style={styles.modalDismissBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  absoluteFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  /* Hero Card */
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  heroIconWrapper: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.brand.panel,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.brand.line,
  },
  heroTextCol: {
    flex: 1,
    minWidth: 0,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  heroTitle: {
    fontSize: 20,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    letterSpacing: -0.3,
  },
  youtubeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#fef2f2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  youtubeTagText: {
    fontSize: 11,
    fontWeight: fontWeights.bold,
    color: '#dc2626',
    textTransform: 'uppercase',
  },
  heroSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    marginTop: 4,
  },

  /* Search */
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    marginTop: 14,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: Platform.OS === 'web' ? 16 : 14,
    color: colors.text,
    paddingVertical: 0,
  },
  searchClearBtn: {
    padding: 4,
  },

  /* Error */
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: '#b91c1c',
    marginRight: 8,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ffffff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#f87171',
  },
  retryText: {
    fontSize: 12,
    fontWeight: fontWeights.bold,
    color: colors.primary,
  },

  /* Loading & Empty */
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: colors.muted,
    fontWeight: fontWeights.medium,
  },
  emptyContainer: {
    paddingVertical: 50,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    textAlign: 'center',
    marginBottom: 6,
  },
  emptySub: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
    maxWidth: 280,
    marginBottom: 16,
  },
  clearSearchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 8,
  },
  clearSearchText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },

  /* List */
  listContainer: {
    gap: 16,
  },
  listHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  listCountText: {
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  listTipText: {
    fontSize: 12,
    color: colors.muted,
  },

  /* Tutorial Card */
  card: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    elevation: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 8,
  },
  thumbnailWrapper: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#0f172a',
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  thumbnailImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  thumbnailFallback: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e293b',
    gap: 8,
  },
  thumbnailFallbackText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: fontWeights.medium,
  },
  thumbnailOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(7, 20, 38, 0.32)',
  },
  playButtonCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(220, 38, 38, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
  },

  /* Card Content */
  cardContent: {
    padding: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    lineHeight: 22,
    marginBottom: 6,
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
    marginBottom: 14,
  },
  cardDescEmpty: {
    fontStyle: 'italic',
    color: '#94a3b8',
  },
  cardActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  watchNowBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    paddingVertical: 10,
    borderRadius: 8,
  },
  watchNowText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },

  /* Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(7, 20, 38, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 580,
    maxHeight: '90%',
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 20,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalHeaderTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  modalIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalHeaderTitle: {
    fontSize: 15,
    fontWeight: fontWeights.heavy,
    color: colors.text,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalVideoContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    position: 'relative',
  },
  modalNativePlayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalThumbnailImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  modalLargePlayBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    borderWidth: 2.5,
    borderColor: '#ffffff',
  },
  modalTapToPlayBanner: {
    position: 'absolute',
    bottom: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },
  modalTapToPlayText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: fontWeights.bold,
  },
  modalDetailsScroll: {
    padding: 16,
    maxHeight: 220,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: fontWeights.heavy,
    color: colors.text,
    lineHeight: 23,
    marginBottom: 8,
  },
  modalDescription: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.muted,
    marginBottom: 12,
  },
  modalTipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#eff6ff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  modalTipText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
    color: '#1e40af',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: '#f8fafc',
  },
  modalLaunchBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#dc2626',
    paddingVertical: 10,
    borderRadius: 8,
  },
  modalLaunchBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: fontWeights.heavy,
    textTransform: 'uppercase',
  },
  modalDismissBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalDismissBtnText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: fontWeights.bold,
  },
});
