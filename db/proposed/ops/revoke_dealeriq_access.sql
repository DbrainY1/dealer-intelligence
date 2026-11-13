-- =============================================================================
-- OPS PROCEDURE — revoke one account's DealerIQ access (DealerIQ only)
-- NOT APPLIED. Run only with explicit owner approval, in the Supabase SQL editor.
-- =============================================================================
-- WHY NOT "DELETE USER" IN SUPABASE AUTH:
--   The Supabase project's Auth is shared with DBRAIN, TIME and Agent-42.
--   Deleting (or banning, or signing out) the auth.users identity would affect
--   every application. DealerIQ access is exactly one thing: the account's row
--   in public.user_roles. Removing that row is the minimum change and leaves
--   the shared identity, its password and its other-app access untouched.
--
-- EFFECT, once the row is removed:
--   * DealerIQ app — denied on the very next request. Every page, the layout
--     and every API route re-read the role per request (lib/authz-server.ts,
--     memoised only within one request). No sign-out needed.
--   * Active sessions — the Supabase session stays valid until it expires
--     (Auth JWTs default to 1 hour and refresh). That is what keeps the user's
--     other applications working. It no longer grants anything in DealerIQ.
--   * Direct database API (REST/GraphQL with the public key):
--       - AFTER db/proposed/2026-11-05_dealeriq_role_gated_reads.sql is
--         applied: denied immediately (policies check the role per query).
--       - BEFORE that migration: NOT revoked. Market tables are readable by any
--         authenticated session. Revocation is only complete once the
--         migration is in place.
--   * The user cannot restore their own access: clients have no write policy
--     on user_roles (and, after the migration, no write grants).
--
-- PENDING INVITES: works the same. If a not-yet-accepted invitee's row is
--   removed, accepting the link later gives a session with no DealerIQ access.
--
-- SAFETY PROPERTIES (enforced in SQL):
--   * Requires the expected current role and a typed confirmation.
--   * Exactly one account must match; it must currently hold that role.
--   * Refuses to remove the last developer (owner lock-out protection).
--   * Exactly one row must be deleted, or the whole statement aborts.
--   * One DO block = one atomic statement; any failed check writes nothing.
--
-- LIMITATION: there is no "remove access" control in the DealerIQ UI yet. The
--   smallest future fix is a developer-only "Remove access" action on the Team
--   list that performs this same single-row delete server-side. Not built here.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 — READ-ONLY PREVIEW. Expect exactly one row. Note current_role: you
-- need it below and it is what you would restore.
-- -----------------------------------------------------------------------------
-- SELECT ur.role                            AS current_role,
--        (u.email_confirmed_at IS NOT NULL) AS accepted,
--        (SELECT count(*) FROM public.user_roles WHERE role = 'developer') AS developers_total
-- FROM auth.users u
-- LEFT JOIN public.user_roles ur ON ur.user_id = u.id
-- WHERE lower(u.email) = lower('REPLACE_WITH_EMAIL');


-- -----------------------------------------------------------------------------
-- STEP 2 — REVOKE. Fill in the three constants, then run the whole block.
-- Success prints: NOTICE: revoked DealerIQ access (removed role <role>, 1 row)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  target_email  CONSTANT text := 'REPLACE_WITH_EMAIL';
  expected_role CONSTANT text := 'REPLACE_WITH_CURRENT_ROLE';
  -- Type exactly: REVOKE <role> FROM <email>
  confirmation  CONSTANT text := 'REPLACE_WITH_CONFIRMATION';

  matches int;
  target  uuid;
  deleted int;
BEGIN
  IF confirmation IS DISTINCT FROM format('REVOKE %s FROM %s', expected_role, target_email) THEN
    RAISE EXCEPTION 'Refusing: confirmation text does not match "REVOKE % FROM <email>".', expected_role;
  END IF;

  SELECT count(*), min(id::text)::uuid INTO matches, target
  FROM auth.users WHERE lower(email) = lower(target_email);

  IF matches <> 1 THEN
    RAISE EXCEPTION 'Refusing: expected exactly 1 account for that email, found %.', matches;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target AND role = expected_role) THEN
    RAISE EXCEPTION 'Refusing: account does not currently hold role %. Re-run the preview.', expected_role;
  END IF;

  IF expected_role = 'developer'
     AND (SELECT count(*) FROM public.user_roles WHERE role = 'developer') <= 1 THEN
    RAISE EXCEPTION 'Refusing: this is the last developer. Grant another developer first.';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = target AND role = expected_role;
  GET DIAGNOSTICS deleted = ROW_COUNT;

  IF deleted <> 1 THEN
    RAISE EXCEPTION 'Aborting: expected to delete 1 row, deleted %.', deleted;
  END IF;

  RAISE NOTICE 'revoked DealerIQ access (removed role %, 1 row)', expected_role;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 3 — VERIFY.
--   * Re-run the preview: current_role must be NULL. auth.users is unchanged.
--   * Have the user (or the owner, with the user's consent) load
--     https://dealersintel.com/dashboard: it shows "Your account doesn't have
--     DealerIQ access yet" and no navigation links.
--   * After the RLS migration, the read-only JWT test (d) in
--     2026-11-05_dealeriq_role_gated_reads.sql section (4) shows what a
--     no-role session can read: nothing.
-- -----------------------------------------------------------------------------


-- -----------------------------------------------------------------------------
-- RESTORE (accidental revocation)
--   * viewer / dealer_principal: run ops/grant_dealeriq_role.sql with the role
--     noted in STEP 1. It is safe to use here: the account is accepted and
--     currently has no role.
--   * developer: grant_dealeriq_role.sql deliberately refuses developer.
--     Restore with this single owner-approved statement (expect INSERT 0 1;
--     it fails on the primary key, rather than overwriting, if a row exists):
--       INSERT INTO public.user_roles (user_id, role)
--       SELECT id, 'developer' FROM auth.users
--       WHERE lower(email) = lower('REPLACE_WITH_EMAIL');
-- -----------------------------------------------------------------------------
