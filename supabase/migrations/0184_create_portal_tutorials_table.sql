-- Migration 0184: Create portal_tutorials table for YouTube video guides
CREATE TABLE IF NOT EXISTS public.portal_tutorials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  youtube_url TEXT NOT NULL,
  video_id TEXT NOT NULL DEFAULT '',
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.portal_tutorials ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Allow read access to portal_tutorials" ON public.portal_tutorials;
DROP POLICY IF EXISTS "Allow authenticated insert portal_tutorials" ON public.portal_tutorials;
DROP POLICY IF EXISTS "Allow authenticated update portal_tutorials" ON public.portal_tutorials;
DROP POLICY IF EXISTS "Allow authenticated delete portal_tutorials" ON public.portal_tutorials;

-- Allow all authenticated users and anon to read active tutorials
CREATE POLICY "Allow read access to portal_tutorials"
  ON public.portal_tutorials FOR SELECT
  TO authenticated, anon
  USING (true);

-- Allow authenticated users to manage tutorials (insert, update, delete)
CREATE POLICY "Allow authenticated insert portal_tutorials"
  ON public.portal_tutorials FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow authenticated update portal_tutorials"
  ON public.portal_tutorials FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow authenticated delete portal_tutorials"
  ON public.portal_tutorials FOR DELETE
  TO authenticated
  USING (true);

-- RPC 1: Fetch tutorials ordered by sort_order and creation date
CREATE OR REPLACE FUNCTION public.get_portal_tutorials()
RETURNS TABLE (
  id UUID,
  title TEXT,
  youtube_url TEXT,
  video_id TEXT,
  description TEXT,
  sort_order INTEGER,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.title, t.youtube_url, t.video_id, t.description, t.sort_order, t.is_active, t.created_at, t.updated_at
  FROM public.portal_tutorials t
  ORDER BY t.sort_order ASC, t.created_at DESC;
END;
$$;

-- RPC 2: Admin save/update tutorial
CREATE OR REPLACE FUNCTION public.admin_save_portal_tutorial(
  p_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT '',
  p_youtube_url TEXT DEFAULT '',
  p_video_id TEXT DEFAULT '',
  p_description TEXT DEFAULT '',
  p_sort_order INTEGER DEFAULT 0,
  p_is_active BOOLEAN DEFAULT true
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.portal_tutorials WHERE id = p_id) THEN
    UPDATE public.portal_tutorials
    SET title = p_title,
        youtube_url = p_youtube_url,
        video_id = p_video_id,
        description = p_description,
        sort_order = p_sort_order,
        is_active = p_is_active,
        updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.portal_tutorials (title, youtube_url, video_id, description, sort_order, is_active)
    VALUES (p_title, p_youtube_url, p_video_id, p_description, p_sort_order, p_is_active)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- RPC 3: Admin delete tutorial
CREATE OR REPLACE FUNCTION public.admin_delete_portal_tutorial(
  p_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.portal_tutorials WHERE id = p_id;
  RETURN true;
END;
$$;
