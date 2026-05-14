# DealerIQ Auth Flow Implementation

**Branch:** `feat/auth-invite-flow`  
**Date:** 2026-05-14  
**Status:** Ready for testing

---

## Changes Made

### 1. New Auth Callback Handler
**File:** `app/auth/callback/page.tsx` (NEW)

- Client component that handles Supabase magic link tokens
- Parses `access_token`, `refresh_token`, and `type` from URL hash
- Establishes session via `supabase.auth.setSession()`
- Renders password creation form (email read-only, password + confirm)
- On submit:
  - Validates password (min 8 chars, not equal to email, passwords match)
  - Updates password via `supabase.auth.updateUser({ password })`
  - **For invite flow only:** Creates `user_roles` entry using role from `user_metadata.role`
  - Redirects to `/dashboard` on success
- Error handling for expired/invalid links
- Idempotent upsert: `{ user_id, role }` with `onConflict: 'user_id'`

---

### 2. Login Page Updates
**File:** `app/page.tsx` (MODIFIED)

**Added:**
- `useEffect` hook to detect magic link tokens in URL hash
- Redirects to `/auth/callback` if `access_token`, `type=invite`, or `type=recovery` detected
- "Forgot password?" link below password field
- Password reset modal with email input
- Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: '/auth/callback' })`
- Security-conscious confirmation message (doesn't reveal if email exists)

---

### 3. Invite API Security Lockdown
**File:** `app/api/invite/route.ts` (MODIFIED)

**Added:**
- Session check via `createServerSupabase().auth.getUser()`
- Role check: queries `user_roles` table for caller's role
- Rejects non-authenticated users (401)
- Rejects non-developer users (403)
- Validates role is one of: `['developer', 'dealer_principal', 'viewer']`
- Added `redirectTo` parameter: `${origin}/auth/callback`
- Stores `invited_by` in user metadata for audit trail

**Security fixes:**
- ✅ No longer publicly accessible
- ✅ Role validation enforced
- ✅ Proper HTTP status codes (401/403/400/500)

---

### 4. Dashboard Route Protection (Role Guards)
**Files Modified:**
- `app/dashboard/page.tsx`
- `app/dashboard/market/page.tsx`
- `app/dashboard/compare/page.tsx`
- `app/dashboard/locations/page.tsx`

**All 4 routes now wrapped with:**
```tsx
<RoleGuard roles={['developer', 'dealer_principal', 'viewer']}>
  {/* page content */}
</RoleGuard>
```

**Settings page** (`app/dashboard/settings/page.tsx`) remains `developer`-only (unchanged).

---

## Role Design

### Canonical Role Values
All roles stored in `public.user_roles.role` as lowercase snake_case:

| Role | Access Level |
|------|-------------|
| `developer` | Full access including /dashboard/settings; can invite users |
| `dealer_principal` | All dashboard pages except settings |
| `viewer` | Same as dealer_principal for now (will diverge when write features land) |

---

## Auth Flow Diagrams

### Invite Flow (Happy Path)
```
1. Developer sends invite via /dashboard/settings
   ↓
2. POST /api/invite (auth check passes)
   ↓
3. Supabase sends email with magic link
   Link: https://dealer-intelligence.vercel.app/#access_token=...&type=invite
   ↓
4. User clicks link → lands on login page (/)
   ↓
5. Login page detects hash tokens → redirects to /auth/callback
   ↓
6. Callback page:
   - Parses tokens
   - Establishes session
   - Shows "Create Your Password" form
   ↓
7. User sets password + submits
   ↓
8. Callback handler:
   - Updates auth.users.password
   - Creates public.user_roles row (from user_metadata.role)
   - Redirects to /dashboard
   ↓
9. Dashboard loads → RoleGuard checks user_roles → grants access
```

### Password Reset Flow (Happy Path)
```
1. User clicks "Forgot password?" on login page
   ↓
2. Enters email → calls resetPasswordForEmail(email, { redirectTo: '/auth/callback' })
   ↓
3. Supabase sends email with magic link
   Link: https://dealer-intelligence.vercel.app/#access_token=...&type=recovery
   ↓
4. User clicks link → lands on login page (/)
   ↓
5. Login page detects hash tokens → redirects to /auth/callback
   ↓
6. Callback page:
   - Parses tokens (type=recovery)
   - Establishes session
   - Shows "Reset Your Password" form
   ↓
7. User sets new password + submits
   ↓
8. Callback handler:
   - Updates auth.users.password
   - SKIPS user_roles insert (already exists)
   - Redirects to /dashboard
```

---

## Database Changes Required

### None
All changes use existing `public.user_roles` table.

**Assumed schema:**
```sql
CREATE TABLE public.user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  role TEXT NOT NULL
);
```

**Upsert uses `onConflict: 'user_id'`** — assumes `user_id` is PK or has unique constraint.

---

## Testing Checklist

### Before Merging to Main
- [ ] Test invite flow end-to-end:
  - [ ] Send invite as developer
  - [ ] Click magic link
  - [ ] Set password
  - [ ] Verify redirect to dashboard
  - [ ] Confirm `user_roles` entry created
  - [ ] Verify dashboard access works
- [ ] Test password reset flow:
  - [ ] Click "Forgot password?"
  - [ ] Enter email
  - [ ] Click magic link
  - [ ] Set new password
  - [ ] Verify login with new password
- [ ] Test auth lockdowns:
  - [ ] Confirm `/api/invite` rejects unauthenticated POST
  - [ ] Confirm `/api/invite` rejects non-developer POST
  - [ ] Confirm all 4 dashboard routes require valid role
  - [ ] Confirm `/dashboard/settings` still developer-only
- [ ] Test error cases:
  - [ ] Expired magic link
  - [ ] Invalid token
  - [ ] Password too short
  - [ ] Passwords don't match
  - [ ] Password same as email
- [ ] Verify no regressions:
  - [ ] Email/password login still works
  - [ ] Dashboard navigation works
  - [ ] Existing developer account still has full access

---

## Environment Requirements

### Supabase Dashboard Configuration
**Must be set (confirmed yesterday):**
- Site URL: `https://dealer-intelligence.vercel.app`
- Redirect URLs: `https://dealer-intelligence.vercel.app/**`

**Email templates:**
- Using Supabase defaults (no custom templates in code)
- Invite email: "Confirm signup" template
- Reset email: "Reset password" template

### Local Development
If testing locally:
- Site URL: `http://localhost:3000`
- Redirect URLs: `http://localhost:3000/**`
- Update `redirectTo` in invite route temporarily for local testing

---

## Known Limitations

1. **No rate limiting** on invite endpoint (only auth check)
2. **No email uniqueness check** before sending invite (Supabase handles this)
3. **No audit log** for invite sends (only `invited_by` in user_metadata)
4. **Default role fallback** to 'viewer' if user_metadata.role is invalid (logs warning but doesn't block)
5. **Using deprecated package** `@supabase/auth-helpers-nextjs` (future: migrate to `@supabase/ssr`)

---

## Deployment Notes

### Before Deploy
1. Verify Supabase dashboard Site URL and Redirect URLs are correct
2. Test invite flow in staging (if available)
3. Verify `user_roles` table schema matches assumptions

### After Deploy
1. Monitor for auth errors in Vercel logs
2. Test password reset with real email
3. Verify invited users can complete signup
4. Check `user_roles` table for new entries

---

## Rollback Plan

If critical issues found after deploy:
1. Revert to `main` branch
2. Redeploy
3. Invited users will be unable to set passwords until fix is deployed
4. Existing users with email/password login will be unaffected

---

## Future Enhancements

- [ ] Migrate to `@supabase/ssr` package
- [ ] Add rate limiting to invite endpoint
- [ ] Add audit log table for invite sends
- [ ] Custom email templates with branding
- [ ] Role-based feature flags (differentiate viewer vs dealer_principal)
- [ ] Invite expiration + resend functionality
- [ ] User management UI (list, edit, disable users)
