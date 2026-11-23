-- Migration 0236: Reward Redemptions table & fixed atomic redeem_reward RPC
-- Compatible with 0235_reward_redemption_requests.sql and fixes employee department/profile lookup.

CREATE TABLE IF NOT EXISTS public.reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id UUID REFERENCES public.rewards(id) ON DELETE SET NULL,
  reward_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  image_url TEXT,
  points_cost INTEGER NOT NULL DEFAULT 0,
  employee_id UUID REFERENCES public.employees(id) ON DELETE CASCADE,
  auth_user_id UUID,
  user_profile_id UUID,
  employee_name TEXT,
  department TEXT,
  notes TEXT,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'fulfilled', 'rejected', 'cancelled')),
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS reward_id UUID REFERENCES public.rewards(id) ON DELETE SET NULL;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS reward_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'General';
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS points_cost INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS employee_id UUID;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS user_profile_id UUID;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS employee_name TEXT;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE public.reward_redemptions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Drop NOT NULL constraints on any legacy columns (e.g. product_name) from an older schema
DO $$
DECLARE
  v_col text;
BEGIN
  FOR v_col IN
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reward_redemptions'
      AND is_nullable = 'NO'
      AND column_name NOT IN ('id', 'reward_name', 'points_cost', 'status', 'redeemed_at', 'created_at', 'updated_at')
  LOOP
    EXECUTE format('ALTER TABLE public.reward_redemptions ALTER COLUMN %I DROP NOT NULL', v_col);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_employee_redeemed
  ON public.reward_redemptions (employee_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_auth_redeemed
  ON public.reward_redemptions (auth_user_id, redeemed_at DESC);

ALTER TABLE public.reward_redemptions ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.reward_redemptions TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Users can view own reward redemptions" ON public.reward_redemptions;
DROP POLICY IF EXISTS "Public select reward_redemptions" ON public.reward_redemptions;
CREATE POLICY "Users can view own reward redemptions"
  ON public.reward_redemptions FOR SELECT
  TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.auth_user_id = auth.uid()
        AND (
          up.employee_id = reward_redemptions.employee_id
          OR up.app_role IN ('admin', 'hr', 'super_admin')
        )
    )
  );

DROP POLICY IF EXISTS "Users can insert own reward redemptions" ON public.reward_redemptions;
DROP POLICY IF EXISTS "Public insert reward_redemptions" ON public.reward_redemptions;
CREATE POLICY "Users can insert own reward redemptions"
  ON public.reward_redemptions FOR INSERT
  TO authenticated
  WITH CHECK (
    auth_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.user_profiles up
      WHERE up.auth_user_id = auth.uid()
        AND up.employee_id = reward_redemptions.employee_id
    )
  );

DROP FUNCTION IF EXISTS public.redeem_reward(UUID);

CREATE OR REPLACE FUNCTION public.redeem_reward(p_reward_id UUID)
RETURNS TABLE (
  redemption_id UUID,
  reward_id UUID,
  reward_name TEXT,
  image_url TEXT,
  points_cost INTEGER,
  status TEXT,
  redeemed_at TIMESTAMPTZ,
  new_balance NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_uid UUID := auth.uid();
  v_profile RECORD;
  v_emp_name TEXT := 'Employee';
  v_dept_name TEXT := 'General';
  v_reward RECORD;
  v_account RECORD;
  v_current_balance NUMERIC := 0;
  v_new_balance NUMERIC := 0;
  v_redemption_id UUID;
  v_redeemed_at TIMESTAMPTZ := NOW();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to redeem rewards.';
  END IF;

  SELECT up.id, up.employee_id, up.username
  INTO v_profile
  FROM public.user_profiles up
  WHERE up.auth_user_id = v_uid
  LIMIT 1;

  IF v_profile.employee_id IS NOT NULL THEN
    SELECT
      COALESCE(
        NULLIF(TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), ''),
        NULLIF(TRIM(v_profile.username), ''),
        'Employee'
      )
    INTO v_emp_name
    FROM public.employees e
    WHERE e.id = v_profile.employee_id
    LIMIT 1;

    SELECT COALESCE(NULLIF(TRIM(d.name), ''), 'General')
    INTO v_dept_name
    FROM public.employee_assignments ea
    LEFT JOIN public.departments d ON d.id = ea.department_id
    WHERE ea.employee_id = v_profile.employee_id
      AND ea.effective_from <= CURRENT_DATE
      AND (ea.effective_to IS NULL OR ea.effective_to >= CURRENT_DATE)
    ORDER BY ea.is_primary DESC, ea.effective_from DESC, ea.created_at DESC
    LIMIT 1;
  END IF;

  v_emp_name := COALESCE(NULLIF(TRIM(v_emp_name), ''), 'Employee');
  v_dept_name := COALESCE(NULLIF(TRIM(v_dept_name), ''), 'General');

  -- Lock the reward row
  SELECT r.*
  INTO v_reward
  FROM public.rewards r
  WHERE r.id = p_reward_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reward item not found.';
  END IF;

  IF LOWER(COALESCE(v_reward.status, 'Active')) <> 'active' THEN
    RAISE EXCEPTION 'This reward is currently inactive.';
  END IF;

  IF COALESCE(v_reward.stocks, 0) <= 0 THEN
    RAISE EXCEPTION 'This reward is out of stock.';
  END IF;

  -- Enforce one-time redemption per reward per employee
  IF EXISTS (
    SELECT 1
    FROM public.reward_redemptions rr
    WHERE rr.reward_id = p_reward_id
      AND (
        rr.auth_user_id = v_uid
        OR (v_profile.employee_id IS NOT NULL AND rr.employee_id = v_profile.employee_id)
      )
      AND LOWER(COALESCE(rr.status, 'pending')) NOT IN ('rejected', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'You have already redeemed this reward.';
  END IF;

  -- Lock the user's point account
  SELECT a.*
  INTO v_account
  FROM public.user_hyg_point_accounts a
  WHERE a.auth_user_id = v_uid
     OR (v_profile.employee_id IS NOT NULL AND a.employee_id = v_profile.employee_id)
     OR (v_profile.id IS NOT NULL AND a.user_profile_id = v_profile.id)
  ORDER BY a.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Insufficient HYG points balance.';
  END IF;

  v_current_balance := COALESCE(v_account.balance, 0);
  IF v_current_balance < COALESCE(v_reward.points_value, 0) THEN
    RAISE EXCEPTION 'Insufficient HYG points balance.';
  END IF;

  v_new_balance := v_current_balance - COALESCE(v_reward.points_value, 0);

  UPDATE public.user_hyg_point_accounts
  SET balance = v_new_balance,
      updated_at = NOW()
  WHERE id = v_account.id;

  UPDATE public.rewards
  SET stocks = GREATEST(0, COALESCE(stocks, 0) - 1),
      updated_at = NOW()
  WHERE id = v_reward.id;

  INSERT INTO public.reward_redemptions (
    reward_id,
    reward_name,
    image_url,
    points_cost,
    status,
    redeemed_at,
    auth_user_id,
    user_profile_id,
    employee_id,
    employee_name,
    department
  )
  VALUES (
    v_reward.id,
    v_reward.product_name,
    v_reward.image_url,
    COALESCE(v_reward.points_value, 0),
    'pending',
    v_redeemed_at,
    v_uid,
    v_profile.id,
    v_profile.employee_id,
    v_emp_name,
    v_dept_name
  )
  RETURNING id INTO v_redemption_id;

  RETURN QUERY
  SELECT
    v_redemption_id,
    v_reward.id,
    v_reward.product_name,
    v_reward.image_url,
    COALESCE(v_reward.points_value, 0),
    'pending'::TEXT,
    v_redeemed_at,
    v_new_balance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.redeem_reward(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_reward(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';
