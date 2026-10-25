import { supabase } from '../lib/supabase';
import { formatDateInput } from '../utils/dateTime';
import { parseTimeToMinutes } from '../utils/requestCalculations';

export type PortalEventActivity = {
  id: string;
  title: string;
  type: string; // 'Event' | 'Activity'
  description?: string;
  location?: string;
  event_date: string; // 'YYYY-MM-DD'
  end_date?: string;
  time_from: string; // e.g. '08:00'
  time_to: string; // e.g. '17:00'
  total_hours: number;
  is_active: boolean;
};

/**
 * Checks if an event or activity has already passed or is finished.
 * Returns true if:
 * 1. The event's effective end date (end_date || event_date) is before today's date (local).
 * 2. The event ends today, and current time has reached or passed the event's end time (time_to).
 * Returns false if the event is scheduled on a future date or has not ended yet today.
 */
export function isEventPassedOrDone(ev: PortalEventActivity, now: Date = new Date()): boolean {
  if (!ev || !ev.event_date) return false;
  const todayStr = formatDateInput(now);
  const effectiveEndDate = (ev.end_date && ev.end_date.trim()) || ev.event_date;

  if (effectiveEndDate < todayStr) {
    return true;
  }
  if (effectiveEndDate > todayStr) {
    return false;
  }

  // Event ends today
  if (!ev.time_to) {
    return false;
  }
  const endMinutes = parseTimeToMinutes(ev.time_to);
  if (endMinutes === null) {
    return false;
  }
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return currentMinutes >= endMinutes;
}

export async function loadActiveEventsActivities(): Promise<PortalEventActivity[]> {
  try {
    const { data, error } = await supabase
      .from('portal_events')
      .select('id, title, type, description, location, event_date, end_date, time_from, time_to, total_hours, is_active')
      .eq('is_active', true)
      .order('event_date', { ascending: false })
      .order('time_from', { ascending: true });

    if (!error && Array.isArray(data)) {
      return data.map((d: any) => ({
        id: String(d.id),
        title: String(d.title || ''),
        type: String(d.type || 'Event'),
        description: d.description ? String(d.description) : '',
        location: d.location ? String(d.location) : '',
        event_date: String(d.event_date || ''),
        end_date: d.end_date ? String(d.end_date) : undefined,
        time_from: String(d.time_from || '08:00'),
        time_to: String(d.time_to || '17:00'),
        total_hours: typeof d.total_hours === 'number' ? d.total_hours : parseFloat(d.total_hours) || 8.0,
        is_active: Boolean(d.is_active),
      }));
    }
  } catch (err) {
    console.warn('Error querying portal_events directly:', err);
  }

  // Fallback: try RPC get_portal_events
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc('get_portal_events', {
      p_only_active: true,
    });
    if (!rpcErr && Array.isArray(rpcData)) {
      return rpcData.map((d: any) => ({
        id: String(d.id),
        title: String(d.title || ''),
        type: String(d.type || 'Event'),
        description: d.description ? String(d.description) : '',
        location: d.location ? String(d.location) : '',
        event_date: String(d.event_date || ''),
        end_date: d.end_date ? String(d.end_date) : undefined,
        time_from: String(d.time_from || '08:00'),
        time_to: String(d.time_to || '17:00'),
        total_hours: typeof d.total_hours === 'number' ? d.total_hours : parseFloat(d.total_hours) || 8.0,
        is_active: Boolean(d.is_active),
      }));
    }
  } catch (rpcCatch) {
    console.warn('Error calling get_portal_events RPC:', rpcCatch);
  }

  return [];
}
