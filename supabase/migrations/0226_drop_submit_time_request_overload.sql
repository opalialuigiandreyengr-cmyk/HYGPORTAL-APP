-- Migration 0226: Drop obsolete overloads of submit_time_request
-- ============================================================================
-- Fixes ambiguity error "Could not choose the best candidate function between: public.submit_time_request..."
-- caused when migration 0224 introduced the 16-parameter overload (with break_from and break_to)
-- without dropping the previous 14-parameter overload.
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as func_sig
    from pg_proc
    where proname = 'submit_time_request'
      and pronamespace = 'public'::regnamespace
      and pronargs < 16
  loop
    execute 'drop function if exists ' || r.func_sig || ' cascade';
  end loop;
end;
$$;

notify pgrst, 'reload schema';

