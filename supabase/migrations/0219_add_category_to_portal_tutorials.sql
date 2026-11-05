-- Migration 0219: Add category column to portal_tutorials
ALTER TABLE public.portal_tutorials
ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'General';

-- Update RPC 1: Fetch tutorials ordered by sort_order and creation date with category
CREATE OR REPLACE FUNCTION public.get_portal_tutorials()
RETURNS TABLE (
  id UUID,
  title TEXT,
  youtube_url TEXT,
  video_id TEXT,
  description TEXT,
  sort_order INTEGER,
  is_active BOOLEAN,
  category TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.title,
    t.youtube_url,
    t.video_id,
    t.description,
    t.sort_order,
    t.is_active,
    COALESCE(t.category, 'General'),
    t.created_at,
    t.updated_at
  FROM public.portal_tutorials t
  ORDER BY t.sort_order ASC, t.created_at DESC;
END;
$$;

-- Update RPC 2: Admin save/update tutorial with category
CREATE OR REPLACE FUNCTION public.admin_save_portal_tutorial(
  p_id UUID DEFAULT NULL,
  p_title TEXT DEFAULT '',
  p_youtube_url TEXT DEFAULT '',
  p_video_id TEXT DEFAULT '',
  p_description TEXT DEFAULT '',
  p_sort_order INTEGER DEFAULT 0,
  p_is_active BOOLEAN DEFAULT true,
  p_category TEXT DEFAULT 'General'
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
        category = COALESCE(NULLIF(p_category, ''), 'General'),
        updated_at = now()
    WHERE id = p_id
    RETURNING id INTO v_id;
  ELSE
    INSERT INTO public.portal_tutorials (title, youtube_url, video_id, description, sort_order, is_active, category)
    VALUES (p_title, p_youtube_url, p_video_id, p_description, p_sort_order, p_is_active, COALESCE(NULLIF(p_category, ''), 'General'))
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

