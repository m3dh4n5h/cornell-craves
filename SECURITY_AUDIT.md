# Security audit and remediation

Date: June 2026. Scope: full Cornell Craves codebase (frontend, Supabase migrations, edge function). This records the findings from the security review and the fixes applied in migration `005_security_hardening.sql` and related frontend changes.

## Summary

A focused review found one real, high-confidence vulnerability class and two related issues, all sharing a single root cause: several `SECURITY DEFINER` Postgres RPCs were granted to the anonymous (`anon`) role and trusted a client-supplied `p_email` argument as proof of identity. Because Cornell emails are predictable (`netid@cornell.edu`), that was effectively no authorization. Everything else reviewed (server-authoritative pricing, HMAC-signed QR passes, club-ownership checks on privileged edge actions, RLS on PII tables, client-side email hashing for anonymous Q&A, absence of `dangerouslySetInnerHTML`) was already sound.

All three findings are now fixed. Identity comes only from the authenticated session.

---

## Finding 1 (High): Order + QR token exposure via `get_my_orders`

* **Category:** broken access control / data exposure
* **Where:** `supabase/migrations/003_orders.sql` `get_my_orders(p_email)`
* **Problem:** `SECURITY DEFINER`, granted to `anon`, returned every order (and its live HMAC-signed `qr_encrypted` pickup token, plus name, NetID, and payment handles) for any email passed in, with no ownership check. Combined with the scan endpoint accepting any valid, payment-verified token, an attacker who knew a victim's email could read their active QR token and collect their food before they did.
* **Fix:** Rewrote the function to ignore `p_email` and scope rows to the authenticated caller (`o.user_id = auth.uid()` or a verified email from `current_user_emails()`). Revoked the `anon` grant; authenticated-only now. `qr_encrypted` is only ever returned to the owner.

## Finding 2 (High): Reservation + PII enumeration via `get_my_reservations`

* **Category:** broken access control / PII exposure
* **Where:** `supabase/migrations/002_marketplace.sql` `get_my_reservations(p_email)`
* **Problem:** Same pattern. Anyone could enumerate any email's reservations, including dietary notes (which can imply allergy/medical/religious information) and exact pickup time and campus location.
* **Fix:** Same remediation: authenticated-only, scoped to the caller's verified emails. `anon` grant revoked.

## Finding 3 (Medium): Unauthorized state changes via email-keyed mutations

* **Category:** broken access control
* **Where:** `cancel_order`, `set_proxy_qr_active` (`003`), `cancel_reservation`, `confirm_reservation` (`002`)
* **Problem:** Same `anon` + unverified-email pattern, allowing an attacker (chaining the UUIDs leaked by Findings 1 and 2) to cancel a victim's pending orders, free their reservation slots, or re-enable a proxy pickup pass the orderer had deliberately disabled.
* **Fix:** All four now require `auth.uid()` and authorize against the caller's own `user_id` / verified emails. `anon` grants revoked.

---

## Defense-in-depth changes applied alongside the fixes

- **Orders and reservations now require a signed-in Google account.** `create_order` and `create_reservation` reject anonymous callers; the order form and pickup calendar show a sign-in prompt instead of failing at the server. Every order and reservation now ties to a real, auditable identity.
- **`current_user_emails()` helper** returns only the caller's own auth email plus saved `cornell_email`, and is itself authenticated-only. All ownership checks fail closed for anonymous callers.
- **OWASP security headers + strict Content-Security-Policy** added in `vercel.json` (`script-src 'self'`, scoped `connect-src`/`img-src`, `X-Frame-Options: DENY`, HSTS, `Permissions-Policy`). Vite's inline module-preload polyfill is disabled so the strict script CSP holds.
- **Terms and liability page** (`/terms`) plus a payment disclaimer on the order review step and a persistent footer notice: payments go directly to clubs, Cornell Craves is not a payment processor, and the project is not affiliated with Cornell University.

## Verified secure (no change needed)

- QR tokens are HMAC-SHA256 signed with a server-only `QR_SECRET`; they cannot be forged, only replayed (the replay path was the leak in Finding 1, now closed).
- `create_order` / `create_order_group` recompute every price and total server-side from the listing. Client-supplied prices are ignored.
- Group payloads expose only first name + last initial, never member emails.
- Privileged edge actions (`verify_payment`, `scan_qr`, `verify_group_payment`, `reactivate_group`, `send_reminders`) validate the caller's JWT and enforce `listing.club_id = auth.uid()`.
- PII tables (`cravings`, `users_extended`, `orders`, `reservations`, unapproved `clubs`) are not world-readable; `cravings` has no SELECT policy at all.
- No `dangerouslySetInnerHTML` / `innerHTML` / `eval` anywhere in `src`. Edge-function email HTML escapes every user-controlled value.
- Q&A asker emails are SHA-256 hashed in the browser before insert.

## Residual risk and follow-ups

These are not vulnerabilities but are worth scheduling. They are tracked in `NEXT_STEPS.md`:

- Rate limiting on the edge function (email/invite spam) is not implemented in code; enable it at the gateway (see NEXT_STEPS).
- The CSP must be verified against the first Vercel preview deploy; relax `connect-src`/`img-src` only if a legitimate host is missing.
- Rotate `QR_SECRET` and the Resend key on a schedule; never commit them (they live in Supabase secrets only).
