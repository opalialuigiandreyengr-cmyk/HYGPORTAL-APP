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
  createdAt?: string;
  updatedAt?: string;
};

const TUTORIALS_CACHE_KEY = 'portal_tutorials_list_v1';

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

function mapTutorialRow(row: Record<string, any>): PortalTutorial {
  const rawUrl = String(row.youtube_url || '');
  const rawId = String(row.video_id || '');
  const videoId = rawId || extractYouTubeVideoId(rawUrl);

  return {
    id: String(row.id || ''),
    title: String(row.title || 'Untitled Tutorial'),
    youtubeUrl: rawUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : ''),
    videoId,
    description: String(row.description || ''),
    sortOrder: typeof row.sort_order === 'number' ? row.sort_order : 0,
    isActive: row.is_active !== false,
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
