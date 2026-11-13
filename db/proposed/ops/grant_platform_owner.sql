-- =============================================================================
-- OPS PROCEDURE — grant Platform Owner (also used for the initial seed)
-- NOT APPLIED. Run only with explicit owner approval, in the Supabase SQL editor,
-- after 2026-11-13_dealeriq_platform_owner_and_activity.sql is applied.
-- =============================================================================
-- Platform Owner is NOT a user_roles value. This procedure never touches
-- user_roles, the account's password, sessions or metadata.
--
-- SAFETY PROPERTIES (enforced in SQL):
--   * Keyed by the immutable auth.users.id. The email is a cross-check only:
--     the id must belong to an account with exactly that email.
--   * The account must be confirmed and must already hold the developer role
--     (owners keep their ordinary DealerIQ access through user_roles).
--   * expected_existing_owners must equal the current number of owners
--     (0 for the initial seed), so an accidental second grant fails.
--   * Typed confirmation; exactly one row inserted; one atomic DO block.
--
-- Initial seed: the owner id for the intended account was resolved read-only on
-- 2026-11-13 and saved OUTSIDE git, already filled in, at
--   ~/DBRAIN-backups/dealeriq/owner-seed/grant_platform_owner.FILLED.sql
-- Review that file, then run it. It is this block with the constants set.
-- =============================================================================


-- STEP 1 — READ-ONLY PREVIEW (expect: 1 row, confirmed = true, role = developer,
-- already_owner = false, owners_now = expected_existing_owners).
-- SELECT (u.email_confirmed_at IS NOT NULL) AS confirmed, ur.role,
--        EXISTS (SELECT 1 FROM public.platform_owners p WHERE p.user_id = u.id) AS already_owner,
--        (SELECT count(*) FROM public.platform_owners) AS owners_now
-- FROM auth.users u LEFT JOIN public.user_roles ur ON ur.user_id = u.id
-- WHERE u.id = 'REPLACE_WITH_USER_ID'::uuid;


-- STEP 2 — GRANT. Success prints: NOTICE: platform owner granted (1 row; owners now N)
DO $$
DECLARE
  target_id                CONSTANT uuid := 'REPLACE_WITH_USER_ID';
  expected_email           CONSTANT text := 'REPLACE_WITH_EMAIL';
  expected_existing_owners CONSTANT int  := REPLACE_WITH_CURRENT_OWNER_COUNT;
  granted_by               CONSTANT text := 'REPLACE_WITH_WHO_APPROVED';
  -- Type exactly: GRANT PLATFORM OWNER TO <email>
  confirmation             CONSTANT text := 'REPLACE_WITH_CONFIRMATION';
  inserted int;
BEGIN
  IF confirmation IS DISTINCT FROM format('GRANT PLATFORM OWNER TO %s', expected_email) THEN
    RAISE EXCEPTION 'Refusing: confirmation text does not match "GRANT PLATFORM OWNER TO <email>".';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users
                 WHERE id = target_id AND lower(email) = lower(expected_email)) THEN
    RAISE EXCEPTION 'Refusing: the user id and email do not identify the same account.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target_id AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing: account is not confirmed.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target_id AND role = 'developer') THEN
    RAISE EXCEPTION 'Refusing: account does not hold the developer role.';
  END IF;

  IF (SELECT count(*) FROM public.platform_owners) <> expected_existing_owners THEN
    RAISE EXCEPTION 'Refusing: expected % existing owner(s), found %.',
      expected_existing_owners, (SELECT count(*) FROM public.platform_owners);
  END IF;

  INSERT INTO public.platform_owners (user_id, granted_by, note)
  VALUES (target_id, granted_by, 'granted via ops/grant_platform_owner.sql');
  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF inserted <> 1 THEN
    RAISE EXCEPTION 'Aborting: expected to insert 1 row, inserted %.', inserted;
  END IF;

  RAISE NOTICE 'platform owner granted (1 row; owners now %)', (SELECT count(*) FROM public.platform_owners);
END $$;


-- STEP 3 — VERIFY: run test (a) in section (6) of the migration file, then sign
-- in as the owner: the "Super Admin" tab appears; other accounts do not see it.
-- ROLLBACK: ops/revoke_platform_owner.sql (refuses to remove the last owner —
-- for an erroneous initial seed, use the migration's section (7) rollback).
