import { supabase } from '../lib/supabase';
import { getCacheJSON, setCacheJSON } from '../lib/localCache';

export type PortalTutorial = {
  id: string;
  title: string;
  youtubeUrl: string;
  videoId: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  category: string;
  createdAt?: string;
  updatedAt?: string;
};

export const TUTORIAL_CATEGORIES = [
  'All Categories',
  'Update and Install',
  'ESARF',
  'Pre-approved OT/Offset',
  'Leave',
  'Perks',
  'Travel Order',
] as const;

export type TutorialCategory = (typeof TUTORIAL_CATEGORIES)[number];

const TUTORIALS_CACHE_KEY = 'portal_tutorials_list_v2';

export function extractYouTubeVideoId(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';

  // Direct 11-char ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  // Match full or shortened YouTube URLs, embed, shorts
  const regExp = /(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=|(?:shorts)\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i;
  const match = trimmed.match(regExp);
  if (match && match[1]) {
    return match[1];
  }
  return '';
}

export function getYouTubeThumbnailUrl(videoId: string): string {
  if (!videoId) return '';
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function getYouTubeEmbedUrl(videoId: string): string {
  if (!videoId) return '';
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
}

export function normalizeYouTubeUrl(url: string): string {
  const id = extractYouTubeVideoId(url);
  if (id) {
    return `https://www.youtube.com/watch?v=${id}`;
  }
  return (url || '').trim();
}

export function inferTutorialCategory(title: string, description?: string, rawCategory?: string | null): string {
  const explicit = (rawCategory || '').trim();
  if (explicit && explicit.toLowerCase() !== 'general') {
    const match = TUTORIAL_CATEGORIES.find(
      (cat) => cat.toLowerCase() === explicit.toLowerCase()
    );
    if (match && match !== 'All Categories') return match;
    return explicit;
  }

  const text = `${title} ${description || ''}`.toLowerCase();

  if (
    text.includes('update') ||
    text.includes('install') ||
    text.includes('download') ||
    text.includes('apk') ||
    text.includes('version') ||
    text.includes('setup') ||
    text.includes('updating') ||
    text.includes('installing')
  ) {
    return 'Update and Install';
  }
  if (
    text.includes('esarf') ||
    text.includes('time request') ||
    text.includes('time adjustment') ||
    text.includes('attendance') ||
    text.includes('dtr') ||
    text.includes('biometric') ||
    text.includes('clock in') ||
    text.includes('clock out') ||
    text.includes('punch') ||
    text.includes('change schedule')
  ) {
    return 'ESARF';
  }
  if (
    text.includes('pre-approved') ||
    text.includes('preapproved') ||
    text.includes('overtime') ||
    text.includes(' ot ') ||
    text.includes('offset') ||
    text.includes('ot/offset') ||
    text.includes('ot / offset')
  ) {
    return 'Pre-approved OT/Offset';
  }
  if (
    text.includes('leave') ||
    text.includes('vacation') ||
    text.includes('sick') ||
    text.includes('maternity') ||
    text.includes('paternity') ||
    text.includes('bereavement') ||
    text.includes('credit')
  ) {
    return 'Leave';
  }
  if (
    text.includes('perk') ||
    text.includes('discount') ||
    text.includes('reward') ||
    text.includes('points') ||
    text.includes('benefit')
  ) {
    return 'Perks';
  }
  if (
    text.includes('travel') ||
    text.includes('travel order') ||
    text.includes('pass slip') ||
    text.includes('errand') ||
    text.includes('trip') ||
    text.includes('locator')
  ) {
    return 'Travel Order';
  }

  return explicit || 'General';
}

function mapTutorialRow(row: Record<string, any>): PortalTutorial {
  const rawUrl = String(row.youtube_url || '');
  const rawId = String(row.video_id || '');
  const videoId = rawId || extractYouTubeVideoId(rawUrl);
  const title = String(row.title || 'Untitled Tutorial');
  const description = String(row.description || '');
  const category = inferTutorialCategory(title, description, row.category);

  return {
    id: String(row.id || ''),
    title,
    youtubeUrl: rawUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
    videoId,
    description,
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
    isActive: row.is_active !== false,
    category,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export async function loadPortalTutorials(): Promise<PortalTutorial[]> {
  // First attempt: direct table select
  try {
    const { data, error } = await supabase
      .from('portal_tutorials')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const items = data.map(mapTutorialRow);
      await setCacheJSON(TUTORIALS_CACHE_KEY, items);
      return items;
    }
  } catch (err) {
    console.warn('Direct portal_tutorials select error, trying RPC:', err);
  }

  // Second attempt: get_portal_tutorials RPC
  try {
    const { data: rpcData, error: rpcError } = await supabase.rpc('get_portal_tutorials');
    if (!rpcError && Array.isArray(rpcData)) {
      const items = rpcData.map(mapTutorialRow);
      await setCacheJSON(TUTORIALS_CACHE_KEY, items);
      return items;
    }
  } catch (rpcErr) {
    console.warn('get_portal_tutorials RPC failed:', rpcErr);
  }

  // Fallback: cached tutorials if available
  const cached = await getCacheJSON<PortalTutorial[]>(TUTORIALS_CACHE_KEY);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return cached;
  }

  return [];
}
