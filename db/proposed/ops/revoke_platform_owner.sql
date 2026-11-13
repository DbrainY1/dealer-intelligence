-- =============================================================================
-- OPS PROCEDURE — revoke Platform Owner from one account
-- NOT APPLIED. Run only with explicit owner approval, in the Supabase SQL editor.
-- =============================================================================
-- Removes only the platform_owners row. The account keeps its login, password,
-- sessions and its ordinary DealerIQ role in user_roles. Effect is immediate:
-- the Super Admin tab, page and owner APIs deny it on the next request, and RLS
-- stops its activity reads on the next query.
--
-- The database refuses to remove the last owner (trigger), and this block
-- refuses it too, with a clearer message. Grant another owner first
-- (ops/grant_platform_owner.sql).
-- =============================================================================

DO $$
DECLARE
  target_id      CONSTANT uuid := 'REPLACE_WITH_USER_ID';
  expected_email CONSTANT text := 'REPLACE_WITH_EMAIL';
  -- Type exactly: REVOKE PLATFORM OWNER FROM <email>
  confirmation   CONSTANT text := 'REPLACE_WITH_CONFIRMATION';
  deleted int;
BEGIN
  IF confirmation IS DISTINCT FROM format('REVOKE PLATFORM OWNER FROM %s', expected_email) THEN
    RAISE EXCEPTION 'Refusing: confirmation text does not match "REVOKE PLATFORM OWNER FROM <email>".';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users
                 WHERE id = target_id AND lower(email) = lower(expected_email)) THEN
    RAISE EXCEPTION 'Refusing: the user id and email do not identify the same account.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.platform_owners WHERE user_id = target_id) THEN
    RAISE EXCEPTION 'Refusing: account is not a platform owner.';
  END IF;

  IF (SELECT count(*) FROM public.platform_owners) <= 1 THEN
    RAISE EXCEPTION 'Refusing: this is the last platform owner.';
  END IF;

  DELETE FROM public.platform_owners WHERE user_id = target_id;
  GET DIAGNOSTICS deleted = ROW_COUNT;

  IF deleted <> 1 THEN
    RAISE EXCEPTION 'Aborting: expected to delete 1 row, deleted %.', deleted;
  END IF;

  RAISE NOTICE 'platform owner revoked (1 row)';
END $$;
