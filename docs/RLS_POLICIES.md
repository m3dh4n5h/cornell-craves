# Row Level Security policies

Every table in `public` has RLS enabled. This is the authoritative list of who can do what. "Owner" means `auth.uid()` matches the row's user; "club owns listing" means the row links to a listing whose `club_id = auth.uid()`.

## Public-read tables (no PII in readable columns)

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `listings` | public | owning club | owning club | owning club (cascade) |
| `campus_locations` | public | admin | admin | admin |
| `pickup_slots` | public | owning club | owning club | owning club |
| `reviews` | public | anyone (content immutable via trigger) | owning club (response only) | none |
| `qa` | public | anyone (email pre-hashed) | owning club (answer only) | none |
| `order_groups` | public (invite page reads pre-auth; no emails exposed) | signed-in creator | creator or owning club | none |

`reviews`/`qa` are public-read but contain no raw emails (Q&A emails are SHA-256 hashed client-side; reviews show first name only). `order_groups` exposes only group metadata; member emails are never in it.

## Owner-scoped / private tables

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `clubs` | own row; admin sees pending | via signup/onboarding | own row; `approved` flip is admin-only (trigger) | none |
| `users_extended` | own row only | own row | own row | own row |
| `cravings` | **no SELECT policy** (unreadable from the client; edge function uses service role) | upsert by email | by email | none |
| `orders` | owner (`user_id`) or owning club | via `create_order` RPC (auth required) | owning club | none |
| `order_qr_codes` | follows order access (owner or owning club) | via RPC | service role (verify/scan) | cascade with order |
| `reservations` | owning club; the reserver reads via `get_my_reservations` RPC (auth, own email) | via `create_reservation` RPC (auth required) | owning club (mark attended) | via `cancel_reservation` RPC (auth, own email) |
| `recurring_templates` | owning club | owning club | owning club | owning club |
| `analytics_events` | owning club or admin | via `track_event` RPC | none | none |
| `order_group_members` | own membership; fellow members; creator; owning club | via `accept_group_invite` RPC | service role | cascade |
| `order_group_invitations` | the inviter (sender); recipients read via `get_my_group_invites` RPC | via `create_order_group` RPC | RPC | cascade |

## SECURITY DEFINER RPC access (after `005_security_hardening.sql`)

These functions run as owner and bypass RLS, so their internal checks are the authorization. All identity-bearing reads/mutations are **authenticated-only** and scoped to the caller; the `anon` grant was revoked on every function below.

| Function | Callable by | Identity check |
|---|---|---|
| `get_my_orders` | authenticated | `user_id = auth.uid()` or verified email |
| `get_my_reservations` | authenticated | verified email of caller |
| `cancel_order` | authenticated | `user_id = auth.uid()` or verified email; pending only |
| `cancel_reservation` | authenticated | verified email of caller |
| `confirm_reservation` | authenticated | verified email of caller; 24h window |
| `set_proxy_qr_active` | authenticated | `user_id = auth.uid()` or verified email |
| `create_order` | authenticated | `auth.uid()` required; prices recomputed server-side |
| `create_reservation` | authenticated | `auth.uid()` required |
| `create_order_group` / `accept_group_invite` / `decline_group_invite` | authenticated | `auth.uid()` required |
| `get_my_groups` / `get_my_group_invites` / `get_club_groups` | authenticated | scoped to `auth.uid()` |
| `current_user_emails` | authenticated | returns only the caller's own emails |
| `track_event` / `vote_review_helpful` / `vote_qa_helpful` | anon + authenticated | low-sensitivity counters; no data returned |
| `get_group_by_token` | anon + authenticated | invite page needs pre-auth read; returns no emails |

Privileged actions in the `notify-cravings` edge function (`verify_payment`, `scan_qr`, `verify_group_payment`, `reactivate_group`, `send_reminders`) validate the caller's JWT and require `listing.club_id = auth.uid()`.
