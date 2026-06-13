# Security guidelines

How to report a problem and how to write Cornell Craves code without introducing one. If you only read one thing: **the backend is the only place authorization is real. Never trust the client.**

## Reporting a vulnerability

Report it privately: open a GitHub private security advisory on this repository (Security tab, "Report a vulnerability"), or contact the maintainer at the address listed on the repository's GitHub profile. Do not open a public issue for a security bug. We aim to acknowledge within a few days.

## The threat model in one paragraph

Cornell Craves stores PII (names, NetIDs, Cornell emails, phone numbers, payment handles), and its QR passes are bearer tokens for picking up paid food. The anon Supabase key is public and shipped in the browser, so anyone can call any RPC with any arguments. Cornell emails are guessable. Therefore: identity must come from the authenticated session, never from a parameter; and anything sensitive must be gated by RLS or an in-function `auth.uid()` check.

## Rules for backend code (SQL migrations + edge function)

1. **Never authorize on a client-supplied value.** Do not gate a query or mutation on a `p_email`, `p_user_id`, or similar argument. Use `auth.uid()` and derive emails with `current_user_emails()`. This is the exact bug fixed in `005_security_hardening.sql` do not reintroduce it.
2. **`SECURITY DEFINER` functions bypass RLS.** Treat every line as if it runs as a superuser. Add an explicit `if auth.uid() is null then raise exception` for anything identity-bearing, and `revoke ... from anon` unless the function genuinely must be public and returns no sensitive data.
3. **Price on the server.** Never store or trust a total/price sent from the client. Recompute it from the listing (see `create_order`).
4. **Keep RLS on.** Every new table gets `enable row level security` plus explicit policies. A table with no policy is unreadable, which is the safe default; do not add `using (true)` to a table that holds emails or other PII.
5. **Secrets stay in Supabase.** `RESEND_API_KEY`, `QR_SECRET`, and the service role key live in `supabase secrets`, never in the repo, never in a `VITE_` variable (those ship to the browser). Only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_ADMIN_EMAIL` are safe to expose.
6. **Sign and validate QR tokens.** Pickup passes are HMAC-SHA256 over `{order/group id, type, timestamp}` with `QR_SECRET`. Verify the signature before honoring a scan; never decode-and-trust.

## Rules for frontend code

1. **Client checks are UX, not security.** A redirect or a disabled button is a convenience; the server must independently reject the action.
2. **No `dangerouslySetInnerHTML`** (or `innerHTML`, `eval`, `new Function`). React escapes by default; keep it that way. If you ever must render HTML, sanitize with a vetted library first and justify it in review.
3. **Do not log secrets or tokens.** No `console.log` of auth tokens, QR token strings, or payment details.
4. **Hash before sending when anonymity is promised.** Q&A emails are SHA-256 hashed client-side (`src/lib/hash.ts`) before insert. Preserve that.
5. **Keep the CSP working.** If you add a new external host (an image CDN, an API), update `connect-src`/`img-src` in `vercel.json`. Do not add `'unsafe-inline'` to `script-src`.

## Before you merge

- [ ] No new RPC authorizes on a client-supplied identity argument
- [ ] New tables have RLS enabled with explicit policies
- [ ] No secret added to a `VITE_` var or committed to the repo
- [ ] No `dangerouslySetInnerHTML` / `eval`
- [ ] Prices/totals for any money flow are computed server-side
- [ ] New external hosts added to the CSP in `vercel.json`
