-- Migration 0209: Create portal_events table for Events & Activities management
CREATE TABLE IF NOT EXISTS public.portal_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'Event', -- 'Event' or 'Activity'
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  event_date DATE NOT NULL,
  end_date DATE,
  time_from TEXT NOT NULL DEFAULT '08:00',
  time_to TEXT NOT NULL DEFAULT '17:00',
  total_hours NUMERIC(5,2) DEFAULT 8.00,
  is_active BOOLEAN DEFAULT true,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index for querying active events by date
CREATE INDEX IF NOT EXISTS idx_portal_events_date ON public.portal_events(event_date DESC);
CREATE INDEX IF NOT EXISTS idx_portal_events_active ON public.portal_events(is_active);

-- Enable Row Level Security
ALTER TABLE public.portal_events ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow read access to portal_events" ON public.portal_events;
DROP POLICY IF EXISTS "Allow authenticated insert portal_events" ON public.portal_events;
DROP POLICY IF EXISTS "Allow authenticated update portal_events" ON public.portal_events;
DROP POLICY IF EXISTS "Allow authenticated delete portal_events" ON public.portal_events;

-- Allow all authenticated users and anon to read active events
CREATE POLICY "Allow read access to portal_events"
  ON public.portal_events FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow authenticated users to insert, update, delete
CREATE POLICY "Allow authenticated insert portal_events"
  ON public.portal_events FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update portal_events"
  ON public.portal_events FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete portal_events"
  ON public.portal_events FOR DELETE
  TO authenticated
  USING (true);

-- RPC 1: Fetch events and activities ordered by event_date desc, time_from asc
CREATE OR REPLACE FUNCTION public.get_portal_events(p_only_active BOOLEAN DEFAULT false)
RETURNS TABLE (
  id UUID,
  title TEXT,
  type TEXT,
  description TEXT,
  location TEXT,
  event_date DATE,
  end_date DATE,
  time_from TEXT,
  time_to TEXT,
  total_hours NUMERIC,
  is_active BOOLEAN,
  created_by TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, e.title, e.type, e.description, e.location, e.event_date, e.end_date,
         e.time_from, e.time_to, e.total_hours, e.is_active, e.created_by, e.created_at, e.updated_at
  FROM public.portal_events e
  WHERE (NOT p_only_active OR e.is_active = true)
  ORDER BY e.event_date DESC, e.time_from ASC;
END;
$$;

-- RPC 2: Admin save/update event
CREATE OR REPLACE FUNCTION public.admin_save_portal_event(
  p_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT '',
  p_type TEXT DEFAULT 'Event',
  p_description TEXT DEFAULT '',
  p_location TEXT DEFAULT '',
  p_event_date DATE DEFAULT CURRENT_DATE,
  p_end_date DATE DEFAULT NULL,
  p_time_from TEXT DEFAULT '08:00',
  p_time_to TEXT DEFAULT '17:00',
  p_total_hours NUMERIC DEFAULT 8.00,
  p_is_active BOOLEAN DEFAULT true,
  p_created_by TEXT DEFAULT ''
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.portal_events WHERE id = p_id) THEN
    UPDATE public.portal_events
    SET title = p_title,
        type = p_type,
        description = p_description,
        location = p_location,
        event_date = p_event_date,
        end_date = COALESCE(p_end_date, p_event_date),
        time_from = p_time_from,
        time_to = p_time_to,
        total_hours = p_total_hours,
        is_active = p_is_active,
        updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.portal_events (
      title, type, description, location, event_date, end_date,
      time_from, time_to, total_hours, is_active, created_by
    ) VALUES (
      p_title, p_type, p_description, p_location, p_event_date, COALESCE(p_end_date, p_event_date),
      p_time_from, p_time_to, p_total_hours, p_is_active, p_created_by
    )
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- RPC 3: Admin delete event
CREATE OR REPLACE FUNCTION public.admin_delete_portal_event(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.portal_events WHERE id = p_id;
  RETURN true;
END;
$$;
