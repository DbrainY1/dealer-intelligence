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
--     REFERENCES/MAINTAIN (Postgres 17) grants on user_roles. RLS (no write policy) blocks the DML,
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
-- ORDERING: compatible with PR #21 in either order (verified: the app reads
--   only with the user's JWT, and every account that uses DealerIQ today has a
--   role row). Disabling public sign-up first is the faster containment; this
--   migration then also covers any existing authenticated account without a
--   DealerIQ role (1 today: an unaccepted invite that has never signed in).
--
-- RE-VERIFIED 2026-11-05 (final check, read-only): all 10 target policies are
--   PERMISSIVE, TO {authenticated}, FOR SELECT, with the exact expressions in
--   the rollback below; no RESTRICTIVE policies; no other policy on these
--   tables except map_config_write_developer; has_dealeriq_role() does not yet
--   exist; Postgres 17.6.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- (0) PRE-STEP SNAPSHOT — run first and SAVE the output (exact rollback source).
-- -----------------------------------------------------------------------------
-- SELECT tablename, policyname, roles, cmd, qual, with_check
-- FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2;
--
-- -- information_schema omits MAINTAIN; read the ACL directly:
-- SELECT a.grantee::regrole, a.privilege_type
-- FROM pg_class c, aclexplode(c.relacl) a
-- WHERE c.oid = 'public.user_roles'::regclass ORDER BY 1, 2;


BEGIN;

-- -----------------------------------------------------------------------------
-- (0b) PRECONDITION GUARD — abort (whole transaction) if production has drifted
--      from what this migration was reviewed against. In particular, any extra
--      PERMISSIVE policy would be OR-ed with the gated one and bypass it.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(format('%s.%s (%s %s)', tablename, policyname, permissive, cmd), ', ')
    INTO bad
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('dealers','dealer_groups','vehicles','vin_presence','inventory_snapshots',
                      'inventory_events','monthly_sales','market_signals','scrape_log','map_config')
    AND policyname NOT IN ('dealers_select_authenticated','dealer_groups_select_authenticated',
                           'vehicles_select_authenticated','vin_presence_select_authenticated',
                           'inventory_snapshots_select_authenticated','inventory_events_select_authenticated',
                           'monthly_sales_select_authenticated','market_signals_select_authenticated',
                           'scrape_log_select_authenticated','map_config_select_authenticated',
                           'map_config_write_developer');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'Unexpected policies present, review before applying: %', bad;
  END IF;
END $$;

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
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON public.user_roles FROM anon, authenticated;
REVOKE SELECT ON public.user_roles FROM anon;

COMMIT;


-- =============================================================================
-- (4) ALLOW / DENY TESTS — run after applying. Every block is READ ONLY and
--     ends in ROLLBACK: no test writes, even inside a transaction. Write denial
--     is proven from privileges and policy predicates instead. JWT simulation
--     exercises RLS only; it does not prove the production login flow.
--     Prints booleans only — every value should be true.
-- =============================================================================
-- -- a) Dealer Principal (existing account) reads market data; sees only own role row.
-- BEGIN READ ONLY;
--   SELECT set_config('request.jwt.claims', json_build_object('role','authenticated',
--     'sub', (SELECT user_id FROM public.user_roles WHERE role = 'dealer_principal' LIMIT 1))::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT (SELECT count(*) FROM public.dealers) > 0             AS a1_reads_dealers,
--          (SELECT count(*) FROM public.inventory_snapshots) > 0 AS a2_reads_snapshots,
--          (SELECT count(*) FROM public.map_config) > 0          AS a3_reads_map_config,
--          (SELECT count(*) FROM public.user_roles) = 1          AS a4_only_own_role_row,
--          NOT EXISTS (SELECT 1 FROM public.user_roles ur
--                      WHERE ur.user_id = auth.uid() AND ur.role = 'developer') AS a5_cannot_write_map_config;
-- ROLLBACK;
--
-- -- b) Viewer: run once the controlled Viewer invite exists (0 viewers today).
-- --    Same as (a) with role = 'viewer'; a1–a5 must all be true.
--
-- -- c) Developer: reads, and satisfies map_config_write_developer's predicate.
-- BEGIN READ ONLY;
--   SELECT set_config('request.jwt.claims', json_build_object('role','authenticated',
--     'sub', (SELECT user_id FROM public.user_roles WHERE role = 'developer' LIMIT 1))::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT (SELECT count(*) FROM public.dealers) > 0 AS c1_reads_dealers,
--          EXISTS (SELECT 1 FROM public.user_roles ur
--                  WHERE ur.user_id = auth.uid() AND ur.role = 'developer') AS c2_map_config_write_allowed;
-- ROLLBACK;
--
-- -- d) Authenticated WITHOUT a DealerIQ role (random uuid) sees nothing.
-- BEGIN READ ONLY;
--   SELECT set_config('request.jwt.claims', json_build_object('role','authenticated','sub', gen_random_uuid())::text, true);
--   SET LOCAL ROLE authenticated;
--   SELECT (SELECT count(*) FROM public.dealers) = 0             AS d1, (SELECT count(*) FROM public.dealer_groups) = 0  AS d2,
--          (SELECT count(*) FROM public.vehicles) = 0            AS d3, (SELECT count(*) FROM public.vin_presence) = 0   AS d4,
--          (SELECT count(*) FROM public.inventory_snapshots) = 0 AS d5, (SELECT count(*) FROM public.inventory_events) = 0 AS d6,
--          (SELECT count(*) FROM public.monthly_sales) = 0       AS d7, (SELECT count(*) FROM public.market_signals) = 0 AS d8,
--          (SELECT count(*) FROM public.scrape_log) = 0          AS d9, (SELECT count(*) FROM public.map_config) = 0     AS d10,
--          (SELECT count(*) FROM public.user_roles) = 0          AS d11;
-- ROLLBACK;
--
-- -- e) anon sees nothing.
-- BEGIN READ ONLY;
--   SET LOCAL ROLE anon;
--   SELECT (SELECT count(*) FROM public.dealers) = 0 AS e1, (SELECT count(*) FROM public.inventory_events) = 0 AS e2;
-- ROLLBACK;
--
-- -- f) Clients cannot create/update/delete role assignments (privileges).
-- SELECT NOT has_table_privilege(r, 'public.user_roles', p) AS denied, r, p
-- FROM unnest(ARRAY['anon','authenticated']) r,
--      unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE','MAINTAIN']) p;
-- SELECT NOT has_table_privilege('anon', 'public.user_roles', 'SELECT') AS f_anon_no_select;
--
-- -- g) No client write path on market tables or settings except the developer
-- --    map_config policy (expect exactly one row: map_config_write_developer).
-- SELECT tablename, policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')
--   AND tablename IN ('dealers','dealer_groups','vehicles','vin_presence','inventory_snapshots',
--                     'inventory_events','monthly_sales','market_signals','scrape_log','map_config','user_roles');
--
-- -- h) App regression (normal use, not a security write test): log in to
-- --    dealersintel.com as an existing dealer_principal and open Market Intel,
-- --    The Market, Market Pulse, Compare, Locations, a dealer page and a VIN page.
-- --    Confirm the next DBRAIN scrape and the TIME diagnostics page still work.


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
-- GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, MAINTAIN ON public.user_roles TO anon, authenticated;
-- GRANT SELECT ON public.user_roles TO anon;
-- DROP FUNCTION IF EXISTS public.has_dealeriq_role();
-- COMMIT;
