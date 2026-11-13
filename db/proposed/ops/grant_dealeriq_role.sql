-- =============================================================================
-- OPS PROCEDURE — grant a DealerIQ role to an ACCEPTED account that has none
-- NOT APPLIED. Run only with explicit owner approval, in the Supabase SQL editor.
-- =============================================================================
-- USE THIS ONLY AS A LAST RESORT. The preferred, tested recovery is in the app:
--   Settings → Add Member → re-send the invite to the same email with the
--   intended role. For an account that has NOT accepted yet, /api/invite
--   re-sends the email and assigns the role server-side (lib/invite.ts).
--   Use this file only when the app reports "That email already has an account"
--   AND the account has no DealerIQ role (it accepted before PR #21 shipped).
--
-- SAFETY PROPERTIES (enforced in SQL, not by the operator):
--   * Grants viewer or dealer_principal only. developer is never granted here.
--   * Requires a typed confirmation that repeats the role and the email.
--   * Exactly one auth.users row must match the email.
--   * The account must have been created by an invitation (auth.users.invited_at,
--     set by Supabase Auth, not user-editable) and must have accepted it.
--   * Never overwrites: aborts if the account already has any user_roles row.
--     Uses a plain INSERT, so even a race fails on the primary key instead of
--     updating.
--   * Exactly one row must be inserted, or the whole statement aborts.
--   * One DO block = one atomic statement. Any failed check raises an error and
--     nothing is written. There is no separate COMMIT to get wrong.
--
-- The intended role must come from the owner's own knowledge of who was
-- invited and why. user_metadata (including "role" and "invited_by") is
-- user-editable and is NOT evidence. If in doubt, use viewer.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 — READ-ONLY PREVIEW. Replace the email, run, and check the result
-- is exactly one row with: invited = true, accepted = true, current_role = NULL.
-- Anything else: STOP (if accepted = false, re-send from Settings instead).
-- -----------------------------------------------------------------------------
-- SELECT (u.invited_at IS NOT NULL)          AS invited,
--        (u.email_confirmed_at IS NOT NULL)  AS accepted,
--        (u.last_sign_in_at IS NOT NULL)     AS ever_signed_in,
--        (u.banned_until > now())            AS banned,
--        ur.role                             AS current_role
-- FROM auth.users u
-- LEFT JOIN public.user_roles ur ON ur.user_id = u.id
-- WHERE lower(u.email) = lower('REPLACE_WITH_EMAIL');


-- -----------------------------------------------------------------------------
-- STEP 2 — GRANT. Fill in the three constants, then run the whole block.
-- Success prints: NOTICE: granted <role> (1 row)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  target_email  CONSTANT text := 'REPLACE_WITH_EMAIL';
  intended_role CONSTANT text := 'REPLACE_WITH_viewer_OR_dealer_principal';
  -- Type exactly: GRANT <role> TO <email>   e.g. GRANT viewer TO name@example.com
  confirmation  CONSTANT text := 'REPLACE_WITH_CONFIRMATION';

  matches  int;
  target   uuid;
  inserted int;
BEGIN
  IF intended_role NOT IN ('viewer', 'dealer_principal') THEN
    RAISE EXCEPTION 'Refusing: role must be viewer or dealer_principal (got %). developer is never granted by this procedure.', intended_role;
  END IF;

  IF confirmation IS DISTINCT FROM format('GRANT %s TO %s', intended_role, target_email) THEN
    RAISE EXCEPTION 'Refusing: confirmation text does not match "GRANT % TO <email>".', intended_role;
  END IF;

  SELECT count(*), min(id::text)::uuid INTO matches, target
  FROM auth.users WHERE lower(email) = lower(target_email);

  IF matches <> 1 THEN
    RAISE EXCEPTION 'Refusing: expected exactly 1 account for that email, found %.', matches;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target AND invited_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing: account was not created by an invitation.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = target AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Refusing: account has not accepted its invitation. Re-send the invite from Settings instead.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = target) THEN
    RAISE EXCEPTION 'Refusing: account already has a DealerIQ role. This procedure never overwrites roles.';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (target, intended_role);
  GET DIAGNOSTICS inserted = ROW_COUNT;

  IF inserted <> 1 THEN
    RAISE EXCEPTION 'Aborting: expected to insert 1 row, inserted %.', inserted;
  END IF;

  RAISE NOTICE 'granted % (1 row)', intended_role;
END $$;


-- -----------------------------------------------------------------------------
-- STEP 3 — VERIFY (read-only). Expect current_role = the intended role.
-- Then have the user sign in: dashboards load, Settings shows "no access".
-- -----------------------------------------------------------------------------
-- (re-run the STEP 1 preview query)
-- SELECT role, count(*) FROM public.user_roles GROUP BY role ORDER BY role;  -- one count rose by 1


-- -----------------------------------------------------------------------------
-- ROLLBACK — undo a grant made in error with ops/revoke_dealeriq_access.sql,
-- giving the same email and the role granted above as the expected role.
-- -----------------------------------------------------------------------------
