<div align="center">

# Cornell Craves

### The food you're craving, brought to campus — by clubs, for students.

Built with React + Vite + Tailwind v4 + Supabase. Payments go directly to clubs over Venmo and Zelle; Cornell Craves never touches money.

</div>

---

## Why Cornell Craves exists

Ithaca isn't a big food town. The options near campus are limited, and the brands students actually crave — an In-N-Out run, Texas Roadhouse rolls, a viral bakery drop — either aren't in Ithaca at all, or they're a cross-town trek nobody wants to make between classes. Getting there is a hassle, so the craving just goes unanswered.

Meanwhile, the people who *could* bring that food to campus — student clubs raising money — have no good way to reach hungry students at the exact moment they're hungry.

**Cornell Craves closes that gap.** Clubs run food fundraisers like real storefronts: they bring in sought-after brands, post a "drop," take orders, verify payment, and hand food off with a scannable QR pass at pickup. Students get one feed (and a campus map) of every drop happening around them, set alerts for the brands they crave so they hear about new drops the moment they land, order solo or split an item with friends, and get everything confirmed by email.

Clubs raise money. Students finally get the food they actually want — without leaving campus.

> **Money never flows through the app.** Students pay clubs directly over Venmo or Zelle. Cornell Craves is a discovery and ordering layer, not a payment processor.

---

## For students

Crave it, find it, grab it — all from your phone. Browse a live feed or campus map of every drop, follow your favorite brands for instant alerts, read real reviews, and order in a few taps. Split a pricey item with friends, then show your QR pass at pickup.

| Feed | Listing | Reviews |
|---|---|---|
| ![Feed](docs/screenshots/student-feed.png) | ![Listing detail](docs/screenshots/student-listing.png) | ![Reviews](docs/screenshots/student-reviews.png) |
| Brand filter chips, live ratings, dietary icons, countdown badges. | Tabbed Items / Reviews / Q&A / Pickup with allergen icons. | Star ratings, helpful votes, club responses. |

| Q&A | Pickup scheduling | Order form |
|---|---|---|
| ![Q&A](docs/screenshots/student-qa.png) | ![Pickup](docs/screenshots/student-pickup.png) | ![Order form](docs/screenshots/student-order.png) |
| Anonymous questions, public club answers. | Inline day + slot picker, capacity aware. | Quantity steppers, running total, split toggle. |

| My orders + groups | QR pickup passes | Split invite |
|---|---|---|
| ![My orders](docs/screenshots/student-orders.png) | ![QR passes](docs/screenshots/student-qr.png) | ![Invite](docs/screenshots/student-invite.png) |
| Solo orders, group orders, invitations, deadline timers. | Per-person QR passes, proxy pass toggle. | Join-link page for split orders. |

| Campus map | My pickups | Account + cravings |
|---|---|---|
| ![Map](docs/screenshots/student-map.png) | ![Pickups](docs/screenshots/student-reservations.png) | ![Account](docs/screenshots/student-account.png) |
| Saffron pins, pickup-type badges, dietary filters. | Upcoming and past reservations, confirm attendance. | Profile, saved payment handles, brand + dietary prefs. |

## For clubs

Run your fundraiser like a real storefront — no spreadsheets, no DMs. Post a drop, take orders, verify Venmo/Zelle payments, scan passes at pickup, and watch what's working with built-in analytics. Save a winning fundraiser as a template and repost it in two clicks.

| Sign in (Student / Club) | Club dashboard | Orders + scanner |
|---|---|---|
| ![Login](docs/screenshots/login.png) | ![Dashboard](docs/screenshots/club-dashboard.png) | ![Club orders](docs/screenshots/club-orders.png) |
| Google-only, portal toggle. | Post and manage drops, jump to tools. | Verify payments, filter, export CSV, scan passes. |

| Analytics | Recurring templates | Reservations manager | Admin |
|---|---|---|---|
| ![Analytics](docs/screenshots/club-analytics.png) | ![Templates](docs/screenshots/club-templates.png) | ![Reservations](docs/screenshots/club-reservations.png) | ![Admin](docs/screenshots/admin.png) |
| Views, CTR, fill rate, ratings, heatmap. | Save once, repost in two clicks. | Per-slot rosters, mark picked up, reminders. | Approve or reject new clubs. |

> Screenshots are from a local demo with seeded data. Student screens are mobile (the app is mobile-first with a bottom tab bar); club tools are desktop.

---

## Everything it does

**Discovery & alerts**
- [x] Live feed with debounced brand filter, skeletons, staggered cards, virtualization past 50 items
- [x] Listing pages with Venmo deep links and Zelle copy
- [x] Club registration, admin approval, club dashboard
- [x] Craving brand alerts by email — students hear about new drops the moment they land

**Marketplace & scheduling**
- [x] Pickup scheduling with capacity-limited slots
- [x] Reviews (immutable, one per person, club responses) and anonymous Q&A
- [x] Campus map (Leaflet + CARTO tiles, custom pins)
- [x] Club analytics (trend, CTR, fill rate, ratings, peak-hours heatmap, dietary mix)
- [x] Recurring fundraiser templates

**Orders & QR pickup**
- [x] Google sign-in, NetID onboarding, saved payment details
- [x] Order flow with server-authoritative pricing, proxy pickup, review modal
- [x] HMAC-signed QR passes emailed after the club verifies payment
- [x] Club orders dashboard: verify, filter, CSV export, camera QR scanner
- [x] Mobile app shell with bottom tabs, allergen icons

**Order splitting & sign-in**
- [x] Split an item 2 to 4 ways: invite links, email invites, live member status
- [x] 24-hour payment deadlines with color-shifting timers
- [x] Per-member QR passes, auto-cancel past deadline, club reactivation
- [x] Student / Club portal toggle, passwordless club onboarding
- [x] Light-locked theme, refreshed brand list, pickup-type map badges

**Security & production hardening**
- [x] All email-keyed RPCs locked to the authenticated owner (see `SECURITY_AUDIT.md`)
- [x] Orders and reservations require a signed-in Google account
- [x] OWASP security headers + strict CSP (`public/_headers` for Cloudflare, `vercel.json` for Vercel)
- [x] Terms and liability disclaimer, payments-direct-to-clubs messaging
- [x] Hot-path indexes and caching for high traffic

---

## Tech stack

React 18 + Vite + TypeScript, Tailwind v4 (CSS-first tokens), customized shadcn-style components, Framer Motion, Leaflet + OpenStreetMap, Recharts, qrcode, Supabase (Postgres + Auth + Edge Functions), Resend, Cloudflare Pages.

## Quick start

```bash
git clone <this repo>
cd cornell-craves
npm install
cp .env.example .env.local   # fill in Supabase URL, anon key, admin email
npm run dev                  # http://localhost:5173
```

Full backend setup (Supabase project, five SQL migrations, Google OAuth, Resend, edge-function secrets, webhooks, cron, security headers, scaling) is a step-by-step checklist in [`NEXT_STEPS.md`](NEXT_STEPS.md). Security details are in [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md), [`SECURITY.md`](SECURITY.md), and [`docs/RLS_POLICIES.md`](docs/RLS_POLICIES.md).

## Project structure

```
src/
  components/   UI primitives, cards, filters, QR view + scanner,
                split-order components, allergen icons, bottom nav
  pages/        Feed, ListingDetail, OrderForm, MyOrders, OrderDetail, InvitePage,
                MapPage, MyReservations, Cravings, Onboarding, Preferences,
                AccountSettings, Login, Register, Terms, Dashboard, ClubOrders,
                ClubAnalytics, ClubTemplates, ClubReservations, Admin
  hooks/        useAuth, useProfile, useClub, useListings, useCountdown, ...
  lib/          supabase, orders, groups, dietary, brands, venmo, analytics, ...
  types/        database.ts (full typed schema + RPC signatures)
supabase/
  migrations/   001_init, 002_marketplace, 003_orders, 004_order_splitting,
                005_security_hardening
  functions/    notify-cravings/ (email + QR signing + scanning + group lifecycle)
```

## Security model (summary)

- RLS on every table; anonymous writes flow through narrow `SECURITY DEFINER` RPCs.
- Order totals and group shares are priced server-side from the listing, never trusted from the client.
- QR passes are HMAC-SHA256 signed server-side (`QR_SECRET`); scans are validated, single-use, and logged.
- Reading your own orders, reservations, and QR passes is bound to your authenticated identity, never a guessable email.
- Q&A asker emails are SHA-256 hashed in the browser before they leave it.

## License

MIT. See [`LICENSE`](LICENSE). Cornell Craves is an independent student project and is not affiliated with Cornell University.
