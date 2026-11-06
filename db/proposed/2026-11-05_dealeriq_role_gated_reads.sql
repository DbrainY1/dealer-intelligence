-- =============================================================================
-- PROPOSED — NOT APPLIED. Requires separate owner approval before running
-- against production (jrgavepbhlrltfadeuke). Apply manually in the Supabase
-- SQL editor; do not run through any automated migration runner.
-- =============================================================================
-- DealerIQ: require a DealerIQ role (not merely a session) to read market data
--
-- PROBLEM (verified read-only against production on 2026-11-05):
--   * Public sign-up is ENABLED and email auto-confirm is ON for the shared
--     project, and the anon key ships in DealerIQ's browser bundle.
--   * Every DealerIQ market table has `FOR SELECT TO authenticated USING (true)`
--     (from migration 012). So any self-registered account, or any other app's
--     user in this shared project, can read DealerIQ data directly through the
--     Supabase REST API, bypassing the app's role checks entirely.
--   * anon/authenticated still hold INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/
--     REFERENCES grants on user_roles. RLS (no write policy) blocks the DML,
--     but TRUNCATE is not subject to RLS. PostgREST does not expose TRUNCATE,
--     so this is defense in depth rather than an open hole.
--
-- CHANGE (narrow; no data is modified):
--   1. Add public.has_dealeriq_role() — SECURITY INVOKER (relies on the
--      existing user_roles_select_own policy; no privilege escalation surface).
--   2. ALTER the existing *_select_authenticated policies on the DealerIQ read
--      tables (and map_config_select_authenticated) so they also require a
--      DealerIQ role. Policy names are unchanged; dealers keeps its
--      scrape_enabled condition.
--   3. Revoke client write/TRUNCATE grants on user_roles and anon SELECT.
--      authenticated keeps SELECT (needed by the own-row policy).
--
-- NOT CHANGED: map_config_write_developer, user_roles_select_own, every
--   service-role-only table (Agent-42 deals/customers/etc., DBRAIN internals),
--   auth settings. Disabling public sign-up is an Auth setting, not SQL — see
--   the PR description.
--
-- AFFECTED APPLICATIONS (checked in source on 2026-11-05):
--   * DealerIQ   — reads these tables with the user's JWT. Users with a role row
--                  (all 4 confirmed accounts today) are unaffected. Accounts
--                  without a role lose REST read access — the intended outcome.
--   * DBRAIN     — scrapers/jobs use the service key → bypass RLS → unaffected.
--   * TIME       — src/lib/supabase.ts uses SUPABASE_SERVICE_KEY → unaffected.
--   * Agent-42   — reads these tables only via supabaseAdmin (service role) in
--                  lib/inventory-match.ts → unaffected.
--   Nothing else references user_roles: no triggers, functions or views, and the
--   only other policy using it is map_config_write_developer (verified).
--
-- ORDERING: independent of the app PR; either can ship first. Recommended:
--   deploy the app PR, verify, then apply this.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- (0) PRE-STEP SNAPSHOT — run first and SAVE the output (exact rollback source).
-- -----------------------------------------------------------------------------
-- SELECT tablename, policyname, roles, cmd, qual, with_check
-- FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2;
--
-- SELECT grantee, privilege_type FROM information_schema.role_table_grants
-- WHERE table_schema = 'public' AND table_name = 'user_roles' ORDER BY 1, 2;


BEGIN;

-- -----------------------------------------------------------------------------
-- (1) Role predicate. Keep this list in sync with DEALERIQ_ROLES in lib/authz.ts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_dealeriq_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('developer', 'dealer_principal', 'viewer')
  );
$$;

REVOKE ALL ON FUNCTION public.has_dealeriq_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_dealeriq_role() TO authenticated;


-- -----------------------------------------------------------------------------
-- (2) Gate the existing read policies. `(SELECT ...)` lets Postgres evaluate
--     the predicate once per statement instead of once per row.
-- -----------------------------------------------------------------------------
ALTER POLICY dealers_select_authenticated ON public.dealers
  USING ((scrape_enabled IS NOT FALSE) AND (SELECT public.has_dealeriq_role()));

ALTER POLICY dealer_groups_select_authenticated       ON public.dealer_groups       USING ((SELECT public.has_dealeriq_role()));
ALTER POLICY vehicles_select_authenticated            ON public.vehicles            USING ((SELECT public.has_dealeriq_role()));
ALTER POLICY vin_presence_select_authenticated        ON public.vin_presence        USING ((SELECT public.has_dealeriq_role()));
ALTER POLICY inventory_snapshots_select_authenticated ON public.inventory_snapshots USING ((SELECT public.has_dealeriq_role()));
ALTER POLICY inventory_events_select_authenticated    ON public.inventory_events    USING ((SELECT public.has_dealeriq_role()));
ALTER POLICY monthly_sales_select_authenticated       ON public.monthly_sales       USING ((SELECT public.has_dealeriq_role()));
ALTER POLICY market_signals_select_authenticated      ON public.market_signals      USING ((SELECT public.has_dealeriq_role()));
ALTER POLICY scrape_log_select_authenticated          ON public.scrape_log          USING ((SELECT public.has_dealeriq_role()));
ALTER POLICY map_config_select_authenticated          ON public.map_config          USING ((SELECT public.has_dealeriq_role()));


-- -----------------------------------------------------------------------------
-- (3) user_roles grants: clients may only SELECT (own row, via RLS).
--     Role rows are written exclusively by the service-role invite route.
-- -----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.user_roles FROM anon, authenticated;
REVOKE SELECT ON public.user_roles FROM anon;

COMMIT;


-- =============================================================================
-- (4) ALLOW / DENY TESTS — run after applying. Read-only; ends in ROLLBACK.
--     Uses existing accounts by role only; prints booleans, never user data.
-- =============================================================================
-- BEGIN;
--   -- a) An account with a DealerIQ role can read market data.
--   SELECT set_config('request.jwt.claims', json_build_object(
--     'role', 'authenticated',
--     'sub', (SELECT user_id FROM public.user_roles WHERE role = 'dealer_principal' LIMIT 1))::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT (SELECT count(*) FROM public.dealers) > 0           AS a1_role_user_reads_dealers,          -- expect true
--          (SELECT count(*) FROM public.inventory_events) > 0  AS a2_role_user_reads_events,           -- expect true
--          (SELECT count(*) FROM public.user_roles) = 1        AS a3_role_user_sees_only_own_role_row; -- expect true
--   RESET ROLE;
--
--   -- b) An authenticated account WITHOUT a role row sees nothing.
--   SELECT set_config('request.jwt.claims', json_build_object(
--     'role', 'authenticated', 'sub', gen_random_uuid())::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT (SELECT count(*) FROM public.dealers) = 0             AS b1_no_role_no_dealers,     -- expect true
--          (SELECT count(*) FROM public.inventory_snapshots) = 0 AS b2_no_role_no_snapshots,   -- expect true
--          (SELECT count(*) FROM public.map_config) = 0          AS b3_no_role_no_map_config;  -- expect true
--   RESET ROLE;
--
--   -- c) anon sees nothing and cannot read user_roles at all.
--   SET LOCAL ROLE anon;
--   SELECT (SELECT count(*) FROM public.dealers) = 0 AS c1_anon_no_dealers;                    -- expect true
--   RESET ROLE;
-- ROLLBACK;
--
-- -- d) Clients cannot write roles (each must fail with "permission denied").
-- BEGIN; SET LOCAL ROLE authenticated;
--   INSERT INTO public.user_roles (user_id, role) VALUES (gen_random_uuid(), 'developer');
-- ROLLBACK;
-- BEGIN; SET LOCAL ROLE anon; SELECT 1 FROM public.user_roles LIMIT 1; ROLLBACK;
--
-- -- e) App regression: log in to dealersintel.com as an existing dealer_principal
-- --    and open Market Intel, The Market, Market Pulse, Compare, Locations, a
-- --    dealer page and a VIN page. As the developer, save one Map Configuration
-- --    value. Confirm a DBRAIN scrape and the TIME diagnostics page still work.


-- =============================================================================
-- (5) ROLLBACK — restores the exact pre-change state verified on 2026-11-05.
-- =============================================================================
-- BEGIN;
-- ALTER POLICY dealers_select_authenticated ON public.dealers USING ((scrape_enabled IS NOT FALSE));
-- ALTER POLICY dealer_groups_select_authenticated       ON public.dealer_groups       USING (true);
-- ALTER POLICY vehicles_select_authenticated            ON public.vehicles            USING (true);
-- ALTER POLICY vin_presence_select_authenticated        ON public.vin_presence        USING (true);
-- ALTER POLICY inventory_snapshots_select_authenticated ON public.inventory_snapshots USING (true);
-- ALTER POLICY inventory_events_select_authenticated    ON public.inventory_events    USING (true);
-- ALTER POLICY monthly_sales_select_authenticated       ON public.monthly_sales       USING (true);
-- ALTER POLICY market_signals_select_authenticated      ON public.market_signals      USING (true);
-- ALTER POLICY scrape_log_select_authenticated          ON public.scrape_log          USING (true);
-- ALTER POLICY map_config_select_authenticated          ON public.map_config          USING (true);
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.user_roles TO anon, authenticated;
-- GRANT SELECT ON public.user_roles TO anon;
-- DROP FUNCTION IF EXISTS public.has_dealeriq_role();
-- COMMIT;
