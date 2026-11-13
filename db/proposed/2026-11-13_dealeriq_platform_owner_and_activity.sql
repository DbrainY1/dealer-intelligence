-- =============================================================================
-- PROPOSED — NOT APPLIED. Requires separate owner approval before running
-- against production (jrgavepbhlrltfadeuke). Apply manually in the Supabase
-- SQL editor; do not run through any automated migration runner.
-- =============================================================================
-- DealerIQ: owner-only Super Admin — platform owners + activity tracking
--
-- ADDS (purely additive; no existing table, policy, role or grant is changed):
--   public.platform_owners     who is a Platform Owner, keyed by auth.users.id.
--                              Independent of user_roles. Clients may read only
--                              their own row; nobody can write it from the API.
--   public.is_platform_owner() true when the caller has a platform_owners row.
--   public.dealeriq_activity   page views / admin events / security events.
--   public.dealeriq_presence   one row per user: last seen time and page.
--   public.record_dealeriq_activity(...)  the ONLY write path for activity;
--                              executable by service_role only. Coalesces page
--                              views (same page within 5 min), caps each user at
--                              120 events/hour, and enforces 90-day retention on
--                              every event it writes.
--   public.purge_dealeriq_activity(...)   90-day retention (service_role only).
--
-- SECURITY MODEL
--   * Owner status comes from platform_owners, never from user_roles values,
--     user_metadata or an email comparison at runtime.
--   * platform_owners: RLS on; clients get SELECT on their own row only; no
--     client INSERT/UPDATE/DELETE grants or policies. Rows are immutable
--     (UPDATE blocked); the last owner cannot be deleted; TRUNCATE is blocked.
--   * Activity/presence: readable only when is_platform_owner(); clients hold no
--     write grants. The app writes through the service-role function with the
--     user id taken from the verified server session, never from the client.
--   * Supabase's default privileges grant anon/authenticated ALL on new public
--     tables; every new table below revokes that explicitly.
--
-- WHAT CAN STILL BYPASS THIS (infrastructure, not the website):
--   the service-role key, the postgres/supabase_admin database roles, Supabase
--   dashboard access to this project, and anyone who can deploy code with those
--   credentials. Protect them per the PR description; no website role can.
--
-- AFFECTED APPLICATIONS: DealerIQ only. DBRAIN, TIME and Agent-42 do not use
--   these new objects. Shared-project impact: none on existing tables.
--
-- PREREQUISITE: 2026-11-05_dealeriq_role_gated_reads.sql (applied 2026-11-13).
-- ORDERING: the app code tolerates this migration being absent (Super Admin is
--   hidden and activity writes are skipped), so either order is safe. Recommended:
--   apply this, seed the owner (ops/grant_platform_owner.sql), then deploy.
-- =============================================================================


BEGIN;

-- -----------------------------------------------------------------------------
-- (0) PRECONDITION GUARD — abort if objects already exist or the prerequisite
--     migration is missing.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.platform_owners') IS NOT NULL
     OR to_regclass('public.dealeriq_activity') IS NOT NULL
     OR to_regclass('public.dealeriq_presence') IS NOT NULL THEN
    RAISE EXCEPTION 'Super Admin objects already exist; review before applying.';
  END IF;
  IF to_regprocedure('public.has_dealeriq_role()') IS NULL THEN
    RAISE EXCEPTION 'Prerequisite migration 2026-11-05_dealeriq_role_gated_reads.sql is not applied.';
  END IF;
END $$;


-- -----------------------------------------------------------------------------
-- (1) Platform owners
-- -----------------------------------------------------------------------------
CREATE TABLE public.platform_owners (
  user_id    uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by text NOT NULL CHECK (length(granted_by) BETWEEN 1 AND 200),
  note       text CHECK (note IS NULL OR length(note) <= 500)
);

ALTER TABLE public.platform_owners ENABLE ROW LEVEL SECURITY;
-- service_role (the key the website holds) may only READ owners: even a leaked
-- or misused app key cannot grant ownership. Grants/revocations run as the
-- database owner via ops/grant_platform_owner.sql / ops/revoke_platform_owner.sql.
REVOKE ALL ON public.platform_owners FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.platform_owners TO authenticated, service_role;

CREATE POLICY platform_owners_select_own
  ON public.platform_owners FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Immutable rows, last-owner protection, no TRUNCATE. Applies to every role,
-- including service_role, unless the table owner disables triggers.
CREATE FUNCTION public.platform_owners_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'platform_owners cannot be truncated';
  ELSIF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'platform_owners rows are immutable; revoke and grant instead';
  ELSIF TG_OP = 'DELETE' AND (SELECT count(*) FROM public.platform_owners) <= 1 THEN
    RAISE EXCEPTION 'cannot remove the last platform owner';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.platform_owners_guard() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER platform_owners_guard_rows
  BEFORE UPDATE OR DELETE ON public.platform_owners
  FOR EACH ROW EXECUTE FUNCTION public.platform_owners_guard();

CREATE TRIGGER platform_owners_guard_truncate
  BEFORE TRUNCATE ON public.platform_owners
  FOR EACH STATEMENT EXECUTE FUNCTION public.platform_owners_guard();

CREATE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_owners WHERE user_id = (SELECT auth.uid()));
$$;

REVOKE ALL ON FUNCTION public.is_platform_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated;


-- -----------------------------------------------------------------------------
-- (2) Activity and presence. Values are short allowlisted keys from the app
--     (lib/activity.ts); the CHECKs keep free text, URLs and query strings out.
-- -----------------------------------------------------------------------------
CREATE TABLE public.dealeriq_activity (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type  text NOT NULL CHECK (event_type IN ('page_view', 'admin_event', 'security_event')),
  page        text CHECK (page ~ '^[a-z][a-z0-9_]{0,47}$'),
  action      text CHECK (action ~ '^[a-z][a-z0-9_.]{0,63}$'),
  -- A page view has a page and no action; every other event has an action and no page.
  CHECK (
    (event_type = 'page_view' AND page IS NOT NULL AND action IS NULL)
    OR (event_type <> 'page_view' AND page IS NULL AND action IS NOT NULL)
  )
);

CREATE INDEX dealeriq_activity_occurred_at_idx ON public.dealeriq_activity (occurred_at DESC);
CREATE INDEX dealeriq_activity_user_time_idx   ON public.dealeriq_activity (user_id, occurred_at DESC);

CREATE TABLE public.dealeriq_presence (
  user_id      uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  last_seen_at timestamptz NOT NULL,
  last_page    text CHECK (last_page ~ '^[a-z][a-z0-9_]{0,47}$')
);

ALTER TABLE public.dealeriq_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dealeriq_presence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dealeriq_activity, public.dealeriq_presence FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.dealeriq_activity, public.dealeriq_presence TO authenticated;
-- Explicit (not relying on Supabase default privileges): exactly what the
-- service-role write/retention functions need.
GRANT SELECT, INSERT, DELETE ON public.dealeriq_activity TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealeriq_presence TO service_role;
REVOKE ALL ON SEQUENCE public.dealeriq_activity_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.dealeriq_activity_id_seq TO service_role;

CREATE POLICY dealeriq_activity_select_owner
  ON public.dealeriq_activity FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_owner()));

CREATE POLICY dealeriq_presence_select_owner
  ON public.dealeriq_presence FOR SELECT TO authenticated
  USING ((SELECT public.is_platform_owner()));


-- -----------------------------------------------------------------------------
-- (3) Retention (default 90 days; floor of 30 days to prevent accidents).
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.purge_dealeriq_activity(p_keep interval DEFAULT interval '90 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  removed integer;
BEGIN
  IF p_keep < interval '30 days' THEN
    RAISE EXCEPTION 'retention below 30 days is not allowed';
  END IF;
  DELETE FROM public.dealeriq_activity WHERE occurred_at < now() - p_keep;
  GET DIAGNOSTICS removed = ROW_COUNT;
  DELETE FROM public.dealeriq_presence WHERE last_seen_at < now() - p_keep;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_dealeriq_activity(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_dealeriq_activity(interval) TO service_role;


-- -----------------------------------------------------------------------------
-- (4) The only write path. p_user_id comes from the verified server session.
--     Returns true when an activity row was written.
--       heartbeat      → presence only
--       page_view      → presence; event unless the same page was recorded
--                        for this user in the last 5 minutes
--       admin_event /
--       security_event → event
--     Every event is subject to a 120-events-per-user-per-hour cap.
-- -----------------------------------------------------------------------------
CREATE FUNCTION public.record_dealeriq_activity(
  p_user_id    uuid,
  p_event_type text,
  p_page       text DEFAULT NULL,
  p_action     text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user id required';
  END IF;

  IF p_event_type IN ('heartbeat', 'page_view') THEN
    INSERT INTO public.dealeriq_presence (user_id, last_seen_at, last_page)
    VALUES (p_user_id, now(), p_page)
    ON CONFLICT (user_id) DO UPDATE
      SET last_seen_at = excluded.last_seen_at,
          last_page    = coalesce(excluded.last_page, public.dealeriq_presence.last_page);
  END IF;

  IF p_event_type = 'heartbeat' THEN
    RETURN false;
  END IF;

  IF p_event_type = 'page_view' AND EXISTS (
    SELECT 1 FROM public.dealeriq_activity
    WHERE user_id = p_user_id AND event_type = 'page_view' AND page = p_page
      AND occurred_at > now() - interval '5 minutes'
  ) THEN
    RETURN false;
  END IF;

  IF (SELECT count(*) FROM public.dealeriq_activity
      WHERE user_id = p_user_id AND occurred_at > now() - interval '1 hour') >= 120 THEN
    RETURN false;
  END IF;

  INSERT INTO public.dealeriq_activity (user_id, event_type, page, action)
  VALUES (p_user_id, p_event_type, p_page, p_action);

  -- Retention on every written event: an indexed range delete that is nearly
  -- free when nothing has expired. No scheduler or extension required. Data
  -- can outlive 90 days only while DealerIQ records no new events at all;
  -- section (5) adds a daily schedule if a strict calendar guarantee is wanted.
  PERFORM public.purge_dealeriq_activity();

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_dealeriq_activity(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_dealeriq_activity(uuid, text, text, text) TO service_role;

COMMIT;


-- =============================================================================
-- (5) OPTIONAL — scheduled retention in addition to the per-event purge, for
--     a strict guarantee even when DealerIQ is idle. Requires enabling pg_cron (available, not installed
--     on 2026-11-13) — a separate approval.
-- =============================================================================
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule('dealeriq-activity-retention', '17 3 * * *',
--                      $$SELECT public.purge_dealeriq_activity()$$);


-- =============================================================================
-- (6) ALLOW / DENY TESTS — run after applying (and after seeding the owner).
--     Every block is READ ONLY; prints booleans only — all must be true.
-- =============================================================================
-- -- a) The Platform Owner can read activity and is recognised as owner.
-- BEGIN READ ONLY;
--   SELECT set_config('test.activity_rows', (SELECT count(*) FROM public.dealeriq_activity)::text, true);
--   SELECT set_config('request.jwt.claims', json_build_object('role','authenticated',
--     'sub', (SELECT user_id FROM public.platform_owners LIMIT 1))::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT public.is_platform_owner()                         AS a1_is_owner,
--          (SELECT count(*) FROM public.platform_owners) = 1  AS a2_sees_only_own_owner_row,
--          (SELECT count(*) FROM public.dealeriq_activity)
--            = current_setting('test.activity_rows')::bigint  AS a3_reads_all_activity;
-- ROLLBACK;
--
-- -- b) A developer who is NOT an owner sees no owner rows, activity or presence.
-- BEGIN READ ONLY;
--   SELECT set_config('request.jwt.claims', json_build_object('role','authenticated',
--     'sub', (SELECT ur.user_id FROM public.user_roles ur
--             WHERE ur.role = 'developer'
--               AND NOT EXISTS (SELECT 1 FROM public.platform_owners po WHERE po.user_id = ur.user_id)
--             LIMIT 1))::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT NOT public.is_platform_owner()                      AS b1_not_owner,
--          (SELECT count(*) FROM public.platform_owners) = 0   AS b2_no_owner_rows,
--          (SELECT count(*) FROM public.dealeriq_activity) = 0 AS b3_no_activity,
--          (SELECT count(*) FROM public.dealeriq_presence) = 0 AS b4_no_presence,
--          (SELECT count(*) FROM public.dealers) > 0           AS b5_market_access_unchanged;
-- ROLLBACK;
--
-- -- c) Same as (b) for role = 'viewer' and role = 'dealer_principal'
-- --    (replace the role filter); b1–b5 must all be true.
--
-- -- d) anon has no access at all (no SELECT privilege on any new table).
-- SELECT NOT has_table_privilege('anon', 'public.dealeriq_activity', 'SELECT') AS d1,
--        NOT has_table_privilege('anon', 'public.dealeriq_presence', 'SELECT') AS d2,
--        NOT has_table_privilege('anon', 'public.platform_owners',  'SELECT') AS d3;
--
-- -- e) Clients cannot write owners or activity, or call the write functions.
-- SELECT NOT has_table_privilege(r, t, p) AS denied, r, t, p
-- FROM unnest(ARRAY['anon','authenticated']) r,
--      unnest(ARRAY['public.platform_owners','public.dealeriq_activity','public.dealeriq_presence']) t,
--      unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p;
-- SELECT NOT has_function_privilege(r, f, 'EXECUTE') AS denied, r, f
-- FROM unnest(ARRAY['anon','authenticated']) r,
--      unnest(ARRAY['public.record_dealeriq_activity(uuid,text,text,text)',
--                   'public.purge_dealeriq_activity(interval)']) f;
--
-- -- e2) The website's service-role key cannot write owners.
-- SELECT NOT has_table_privilege('service_role', 'public.platform_owners', p) AS denied, p
-- FROM unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p;
--
-- -- f) No write policies exist on the new tables (expect zero rows).
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND cmd <> 'SELECT'
--   AND tablename IN ('platform_owners','dealeriq_activity','dealeriq_presence');


-- =============================================================================
-- (7) ROLLBACK — removes everything this migration created. Activity history
--     and the owner record are deleted with it; the Super Admin tab disappears
--     (fails closed). Existing DealerIQ access is unaffected.
-- =============================================================================
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.record_dealeriq_activity(uuid, text, text, text);
-- DROP FUNCTION IF EXISTS public.purge_dealeriq_activity(interval);
-- DROP TABLE IF EXISTS public.dealeriq_activity;
-- DROP TABLE IF EXISTS public.dealeriq_presence;
-- DROP TABLE IF EXISTS public.platform_owners;          -- drops its triggers and policy
-- DROP FUNCTION IF EXISTS public.is_platform_owner();
-- DROP FUNCTION IF EXISTS public.platform_owners_guard();
-- COMMIT;
