import { getCacheJSON, setCacheJSON } from '../lib/localCache';
import { supabase } from '../lib/supabase';

export type TrainingAttendee = {
  id: string;
  name?: string;
  department?: string;
  status?: string;
  confirmed_at?: string;
};

export type TrainingItem = {
  id: string;
  title: string;
  description: string;
  trainingDate: string;
  startTime: string;
  endTime: string;
  location: string;
  trainer: string;
  badgeId: string | null;
  badgeTitle: string;
  badgePoints: number;
  status: 'Upcoming' | 'Concluded' | 'Cancelled' | string;
  isBadgesAwarded: boolean;
  isConfirmed: boolean;
  attendees: TrainingAttendee[];
};

const TRAININGS_CACHE_TTL_MS = 5 * 60 * 1000;

export async function loadMyTrainings(
  userId?: string,
  employeeId?: string,
  employeeCode?: string,
  options?: { forceRefresh?: boolean },
): Promise<TrainingItem[]> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  if (!currentUserId) {
    return [];
  }

  const cacheKey = `employee_trainings_v1_${currentUserId}`;
  if (!options?.forceRefresh) {
    const cached = await getCacheJSON<TrainingItem[]>(cacheKey, TRAININGS_CACHE_TTL_MS);
    if (cached) {
      return cached;
    }
  }

  let empId = employeeId;
  if (!empId) {
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('employee_id')
      .eq('auth_user_id', currentUserId)
      .maybeSingle<{ employee_id: string | null }>();
    empId = userProfile?.employee_id ?? undefined;
  }

  const candidateIds = new Set(
    [empId, employeeCode]
      .map((v) => v?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v)),
  );

  try {
    const { data, error } = await supabase
      .from('trainings')
      .select(
        'id, title, description, training_date, start_time, end_time, location, trainer, badge_id, badge_title, badge_points, attendees, status, is_badges_awarded',
      )
      .order('training_date', { ascending: true });

    if (error) {
      throw new Error(error.message || 'Unable to load trainings.');
    }

    const items: TrainingItem[] = (data ?? [])
      .filter((row: any) => {
        const statusLower = String(row?.status || 'Upcoming').trim().toLowerCase();
        if (statusLower === 'cancelled') return false;

        const rawAttendees = Array.isArray(row?.attendees) ? row.attendees : [];
        if (rawAttendees.length === 0 || candidateIds.size === 0) {
          return true;
        }
        return rawAttendees.some((att: any) => {
          const attId = String(att?.id ?? att?.employee_id ?? '').trim().toLowerCase();
          return attId.length > 0 && candidateIds.has(attId);
        });
      })
      .map((row: any) => {
        const attendees: TrainingAttendee[] = Array.isArray(row.attendees) ? row.attendees : [];
        const matchedAttendee = attendees.find((att: any) => {
          const attId = String(att?.id ?? att?.employee_id ?? '').trim().toLowerCase();
          return attId.length > 0 && candidateIds.has(attId);
        });
        const isConfirmed =
          String(matchedAttendee?.status || '').trim().toLowerCase() === 'confirmed' ||
          Boolean(matchedAttendee?.confirmed_at);

        return {
          id: String(row.id),
          title: String(row.title || 'Training').trim(),
          description: String(row.description || '').trim(),
          trainingDate: String(row.training_date || ''),
          startTime: String(row.start_time || '09:00'),
          endTime: String(row.end_time || '12:00'),
          location: String(row.location || '').trim(),
          trainer: String(row.trainer || '').trim(),
          badgeId: row.badge_id ?? null,
          badgeTitle: String(row.badge_title || '').trim(),
          badgePoints: Number(row.badge_points ?? 0),
          status: String(row.status || 'Upcoming').trim(),
          isBadgesAwarded: Boolean(row.is_badges_awarded),
          isConfirmed,
          attendees,
        };
      });

    await setCacheJSON(cacheKey, items);
    return items;
  } catch (error) {
    const stale = await getCacheJSON<TrainingItem[]>(cacheKey);
    if (stale) {
      return stale;
    }
    throw error;
  }
}

export async function confirmTrainingAttendance(
  trainingId: string,
  userId?: string,
  employeeId?: string,
  employeeCode?: string,
): Promise<void> {
  const { data: sessionResult } = await supabase.auth.getSession();
  const currentUserId = userId || sessionResult.session?.user?.id;
  if (!currentUserId) {
    throw new Error('Authentication required.');
  }

  let empId = employeeId;
  if (!empId) {
    const { data: userProfile } = await supabase
      .from('user_profiles')
      .select('employee_id')
      .eq('auth_user_id', currentUserId)
      .maybeSingle<{ employee_id: string | null }>();
    empId = userProfile?.employee_id ?? undefined;
  }

  const candidateIds = new Set(
    [empId, employeeCode]
      .map((v) => v?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v)),
  );

  const { data: row, error: fetchError } = await supabase
    .from('trainings')
    .select('id, attendees')
    .eq('id', trainingId)
    .single();

  if (fetchError || !row) {
    throw new Error(fetchError?.message || 'Training not found.');
  }

  const nowIso = new Date().toISOString();
  const currentAttendees: any[] = Array.isArray(row.attendees) ? row.attendees : [];
  let updatedAny = false;
  const nextAttendees = currentAttendees.map((att) => {
    const attId = String(att?.id ?? att?.employee_id ?? '').trim().toLowerCase();
    if (attId && candidateIds.has(attId)) {
      updatedAny = true;
      return {
        ...att,
        status: 'Confirmed',
        confirmed_at: att?.confirmed_at || nowIso,
      };
    }
    return att;
  });

  if (!updatedAny && empId) {
    nextAttendees.push({
      id: empId,
      status: 'Confirmed',
      confirmed_at: nowIso,
    });
  }

  const { error: updateError } = await supabase
    .from('trainings')
    .update({
      attendees: nextAttendees,
      updated_at: nowIso,
    })
    .eq('id', trainingId);

  if (updateError) {
    throw new Error(updateError.message || 'Failed to confirm training attendance.');
  }

  // Update local cache immediately
  try {
    const cacheKey = `employee_trainings_v1_${currentUserId}`;
    const cached = await getCacheJSON<TrainingItem[]>(cacheKey);
    if (cached) {
      await setCacheJSON(
        cacheKey,
        cached.map((t) =>
          t.id === trainingId ? { ...t, isConfirmed: true, attendees: nextAttendees } : t,
        ),
      );
    }
  } catch {
    // ignore cache update error
  }
}
