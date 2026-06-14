# Cornell Craves — Audit + Feature Report

Date: June 2026. Worked the `CLAUDE_CODE_AUDIT_PROMPT.md` checklist end to end.

## Method and one honest limit

- **Code-verified (✅):** logic confirmed by reading the exact code path, with file:line evidence. Where a fix was needed it was applied and re-checked.
- **Build-verified (✅):** `npx tsc --noEmit` and `npm run build` both run clean after every change.
- **Needs live backend (🔶):** items that require a real Supabase project + a real Google sign-in + real email/cron (Google OAuth consent, welcome/craving/QR emails, the auto-cancel cron, cross-browser camera scanning). These cannot be exercised autonomously — a forged session does not validate against real Supabase, and Google's consent screen can't be scripted. Each is marked 🔶 with the exact manual steps to run.

`.env.local` is empty in this workspace, so the app was exercised against a seeded local mock with injected sessions for UI flows that don't need real OAuth.

---

## Bug found and fixed

### `useClub` per-component staleness (the item the prompt flagged) — FIXED

**Symptom:** `useProfile` was already converted to a shared `ProfileProvider`, but `useClub` was still a plain per-component hook. Ten components called `useClub()` independently (`App.tsx` OnboardingGate + RoleGate, `Navbar`, `BottomNav`, `Dashboard`, `Register`, `AccountSettings`, `Login`, `Onboarding`, `Preferences`) — each with its own fetch and state. So when a club registered mid-session, `Register.tsx`'s `refetch()` only updated *its own* instance; the App-level gates and the nav kept treating the user as a student until a hard reload. This is the exact "same per-component staleness that `useProfile` had" the prompt asked to check.

**Fix:** Converted `src/hooks/useClub.ts` into a `ClubProvider` context (mirrors `ProfileProvider`), wrapped the app in `<ClubProvider>` in `App.tsx`. Now all consumers share one state and one `refetch`, so registering a club (or toggling group ordering) updates the nav and guards live, and the ~10 duplicate `clubs` queries collapse to one. `tsc`/`build` green.

---

## Phase 1 — audit results

### Auth & roles

| Check | Result | Evidence / notes |
|---|---|---|
| Student sign-in → `/onboarding`; NetID validates (`abc123` ok, `hello` rejected) | 🔶 (logic ✅) | `OnboardingGate` `App.tsx:69-96` routes a student with no `cornell_netid` to `/onboarding`; `isValidNetid` `src/lib/orders.ts` rejects `hello`. OAuth round-trip needs live. |
| After onboarding, other pages do NOT bounce back (shared-profile regression) | ✅ | `ProfileProvider` + the `fetchedFor`/`loading` gate (`useProfile.ts`) means the gate never acts on a stale null. Verified the gate waits on `profileLoading`. |
| Club sign-in → `/register` → pending in `/admin` → approve → welcome email | 🔶 (logic ✅) | `Register.tsx` inserts the club; `Admin.tsx` lists `approved=false`; welcome email is the `welcome-on-approve` webhook. Email send needs live Resend. |
| Admin (also a club) opens `/admin`; Admin link in web + mobile nav | ✅ | `Navbar.tsx:60-61,86-87` and `BottomNav.tsx:29,52-58` both gate the Admin entry on `isAdmin`. |
| Clubs redirected away from `/cravings`, `/orders`, `/reservations` → `/dashboard` | ✅ | `RoleGate` `App.tsx:100,116-118` (`CLUB_BLOCKED_PREFIXES`). |
| Clubs CAN open `/` and `/map` | ✅ | Neither path is in `CLUB_BLOCKED_PREFIXES`; RoleGate leaves them. |
| Students redirected away from `/dashboard` and `/club/*` → `/` | ✅ | `RoleGate` `App.tsx:119-123`. Admin is exempt (can hold a club). |
| Register a club mid-session → nav/guards update WITHOUT reload | ✅ FIXED | See "Bug found and fixed" above (the `ClubProvider` conversion). |
| Sign out fully clears state | ✅ | `AuthProvider` clears session; `ClubProvider`/`ProfileProvider` key on `user.id` and reset to null when `userId` is null (`refetch` sets `fetchedFor=null`). |
| Deep-link to a protected page while logged out → login then back (incl. `/invite/<token>`) | ✅ | Student-only pages now redirect to `/login?intent=student&next=<path>` (Feature A) and the student `GoogleButton` returns to `next`; `/invite/:token` is onboarding-exempt and its own `GoogleButton` returns to the invite; the order form shows an inline sign-in returning to the order form. |

### Cravings

| Check | Result | Evidence |
|---|---|---|
| Save from `/cravings`, `/preferences`, Account — no RLS error | ✅ | All three call the `upsert_my_craving` RPC (`Cravings.tsx:52`, `Preferences.tsx`, `AccountSettings.tsx:145`); the `cravings` table has no SELECT policy by design. |
| Email field is read-only text = account email | ✅ | `Cravings.tsx:100-105` renders the account email as static text. |
| Unsubscribe removes the subscription | ✅ (logic) | `AccountSettings.tsx:159` `delete_my_craving` RPC; clears local brands. Email cessation needs live to confirm. |
| New listing fires the craving alert email | 🔶 | `notify-on-listing` webhook → edge function. Needs live Resend + webhook. |

### Orders & QR passes

| Check | Result | Evidence |
|---|---|---|
| Signed-in order pre-fills + locks name/email; total correct; review modal matches | ✅ | `OrderForm.tsx` `nameLocked`/`emailLocked`/`netidLocked` + the review modal echoes the same lines/total. |
| Cannot order while logged out (sign-in prompt) | ✅ | `OrderForm.tsx` renders an inline "Sign in to order" card when `!user || !isGoogleUser`; `create_order` also rejects anon server-side (migration 005). |
| Club "Verify payment" emails the QR pass; appears on buyer `/orders` | 🔶 (logic ✅) | `ClubOrders` → `verify_payment` edge action signs + emails; buyer reads it via `get_my_orders`. Email needs live. |
| Camera scanner shows live video + scans on Safari macOS/iOS, Chrome | 🔶 | `QRScanner.tsx` (jsQR fallback + stream-attach fix per the prompt's "already done"). Real camera + per-browser behavior needs physical devices. |
| Proxy pickup pass works | ✅ (logic) | `OrderDetail.tsx` renders the proxy pass + enable/disable via `set_proxy_qr_active` (auth-scoped, migration 005). |

### Split orders

| Check | Result | Evidence |
|---|---|---|
| Start a split, copy link, second account joins; full → unlock email + 24h timer | 🔶 (logic ✅) | `create_order_group`/`accept_group_invite` (migration 004/009); deadline + `DeadlineTimer`. Email needs live. |
| Club verifies one member → only that member gets a QR; timer orange <6h, red <2h | ✅ (timer) / 🔶 (email) | `DeadlineTimer.tsx` tone thresholds verified; per-member QR email needs live. |
| Auto-cancel cron cancels unpaid groups | 🔶 | `auto_cancel_groups` edge action; call it manually per `NEXT_STEPS.md` Step 5. |

### Account management

| Check | Result | Evidence |
|---|---|---|
| Student account save (all fields) | ✅ | `AccountSettings.tsx` upsert to `users_extended` + `upsert_my_craving`. |
| Club Venmo/Zelle edit with NO active listing saves silently | ✅ | `ClubAccount.save` `AccountSettings.tsx`: no active listing → updates without the consent gate. |
| Club Venmo/Zelle edit WITH active listing → disclaimer + required checkbox; live listing shows "payment updated" notice | ✅ | `ClubAccount.save` checks active listings, requires `consent`, stamps `payment_updated_at` on live listings. |
| Account deletion (student AND club) actually deletes the `auth.users` row | 🔶 ACTION REQUIRED | `delete_my_account` RPC (migration 007) deletes the public-schema rows, but a plain RPC **cannot** delete from `auth.users` (no permission). **Recommended fix is staged below** — move the auth deletion into the edge function with the service-role key. Verify no further emails after deletion. |

> **Account-deletion follow-up (do this against live):** add a `delete_account` action to `notify-cravings` that calls `supabase.auth.admin.deleteUser(user.id)` (service role) after confirming the caller's JWT, and have `deleteAccount()` in `AccountSettings.tsx` invoke that instead of the RPC (or in addition, RPC first for the app rows, then the edge function for the auth row). This requires the deployed edge function + service-role key, so it is left as a documented live step rather than a code change that can't be exercised here.

### Map, brands, terms

| Check | Result | Evidence |
|---|---|---|
| Map centers on Cornell; pickup-type badges; kill network → Retry + feed fallback | ✅ | `MapPage.tsx:20` center `42.4534,-76.4735`; pin badges via `createBrandPin`; `loadError` branch shows Retry + "Open the feed". |
| Brand chips match the current list | ✅ | `src/lib/brands.ts` (In-N-Out, Texas Roadhouse, Club Bake Sale, Other; no Collegetown Bagels / Louie's). |
| Footer → `/terms`; order review shows payments-go-to-clubs disclaimer | ✅ | `App.tsx:168` footer link; `OrderForm.tsx` review modal disclaimer. |

### Security

| Check | Result | Evidence |
|---|---|---|
| Logged-out `get_my_orders(someone_email)` returns empty/error, NOT rows | ✅ | Migration 005 revoked the `anon` grant and scopes to `auth.uid()`/verified email; `SECURITY_AUDIT.md` Finding 1. Re-run the console probe in `NEXT_STEPS.md` Step 10 against live to confirm. |
| No CSP errors on any page | 🔶 | CSP is in `vercel.json` / `public/_headers`; it only takes effect on the deployed host. Verify in the first preview deploy's console. |
| No secrets in the client bundle | ✅ | `grep` of `dist/` finds no `service_role`/`re_`/`xkeysib`; only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_EMAIL` are referenced. |

### Build quality

| Check | Result |
|---|---|
| `npx tsc --noEmit` clean | ✅ |
| `npm run build` clean | ✅ |
| No uncaught errors during normal use | ✅ (mock-driven UI flows) |
| Bottom nav at 320/390/430 for student/club/admin | 🔶 → screenshot pass recommended on device widths; `BottomNav` builds its tab set from role so counts are correct. |

---

## Phase 2 — features delivered

### Feature A — student-only login on Cravings / Orders / Pickups ✅

- `Login.tsx` reads `?intent=student`: renders a single "Continue with Google as a student" action, **no club toggle, no mention of clubs**, and returns to a validated same-origin `?next=` path. General surfaces (`/login`, signed-out account card) keep the Student/Club toggle. No OAuth logic duplicated — same `GoogleButton`.
- `Cravings.tsx`, `MyOrders.tsx`, `MyReservations.tsx`, `OrderDetail.tsx` now redirect to `/login?intent=student&next=<their path>`.
- `safeNext()` rejects external/`//` redirects (open-redirect guard).

### Feature B — per-club groups toggle ✅

- **Migration `008_club_groups_toggle.sql`:** `alter table clubs add column if not exists groups_enabled boolean not null default true;` and `create_order_group` now raises `This club has turned off group ordering` when the owning club disabled it (authoritative server enforcement).
- `Club` type + `ClubInsert` gain `groups_enabled`; the listing→club select includes it (`useListings.ts` ×2, `MapPage.tsx`).
- Club toggle on the Account page (`ClubAccount` in `AccountSettings.tsx`) flips `groups_enabled` and live-refetches via the shared `ClubProvider`.
- `OrderForm.tsx` hides the "Split this order" toggle entirely when `listing.clubs.groups_enabled === false`.

### Feature C — item quantities + equal-division splitting ✅

- **Migration `009_item_quantities.sql`:** loosens the `order_groups` split-size checks (allow divisors > 4, e.g. 12 → 6, 12), snapshots `item_quantity` on the group, exposes `units_per_person` from `group_payload`, and makes `create_order_group` enforce `quantity % split_type = 0` (raises a clear error on a non-divisible split). Quantity lives in the existing `listings.items` JSONB, so no listings column change.
- `ListingItem` type gains `quantity?: number`; `ItemsEditor` gets a per-item "/box" quantity input (default 1, min 1) wired through `parseItemDrafts`/`toItemDrafts`.
- Quantity shown as "· N in a box" on the listing detail and order form item lists.
- Split UI: `SplitTypeSelector` now offers only valid divisors of the chosen item's quantity and shows per-person units; the split item picker disables non-splittable items ("Can't split"); the confirmation and `/orders` group card surface the per-person unit count. For 12 → offers 2, 3, 4, 6, 12; a 5-way split is impossible to select and is rejected server-side.

---

## Phase 3 — verification

- `npx tsc --noEmit` ✅ and `npm run build` ✅ after all changes.
- New-flow logic verified by reading the paths: groups-disabled hides + server-rejects the split; a 12-unit box offers 2/3/4/6/12 and rejects 5; student-only login from `/orders` shows no club toggle and returns to `/orders`.
- **Feature A screenshot:** `audit/screenshots/featureA-student-only-login.png` — the `/orders` redirect renders a single "Continue with Google as a student" with no club toggle and no club mention. ✅
- **Features B and C screenshots (split with quantities, groups toggle):** verified by `tsc`/`build` + code review. The local mock harness intermittently failed to serve the browser this session (the mock responds to `curl` but the app showed a loading/fetch state), so these are best captured on the first live deploy by: signing in as a student, opening a listing whose item has a box quantity, enabling "Split this order" (offers 2/3/4/6/12 for a 12-box, shows per-person units), and opening a listing from a club with group ordering turned off (the split option is absent). The underlying logic and server enforcement are in `OrderForm.tsx`, `SplitTypeSelector.tsx`, and migrations `008`/`009`.

## Remaining risks / live-only checklist (run against your Supabase)

1. **Run migrations `008` and `009`** in the SQL editor (after `001`–`007`).
2. **Account deletion of the `auth.users` row** — implement the edge-function `delete_account` action noted above; verify a deleted user gets no further emails.
3. **Email + cron** — welcome, craving alert, QR pass, group unlock, auto-cancel: exercise once live (Resend + webhooks + pg_cron).
4. **Camera scanner** — test on Safari macOS, Safari iOS, and Chrome with a real pass.
5. **CSP** — open the deployed site's console on every page; relax `connect-src`/`img-src` in `vercel.json` only if a legitimate host is blocked.
6. **Apple Wallet passes** — still need the paid Apple Developer cert; out of scope.
