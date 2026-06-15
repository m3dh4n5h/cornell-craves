<div align="center">

# Cornell Craves

### The food you actually crave, brought to campus by clubs, for students.

Built with React, Vite, Tailwind v4, and Supabase. Money goes straight to clubs over Venmo and Zelle. Cornell Craves never touches a cent of it.

</div>

---

## Why it exists

Ithaca is not a food city. The stuff students actually crave (an In-N-Out run, Texas Roadhouse rolls, the bakery drop everyone's posting about) is either not in Ithaca at all, or it's a cross-town trip nobody's making between a 10:10 and an 11:15. So the craving just sits there.

At the same time, the people who could bring that food to campus, student clubs trying to raise money, have no good way to reach hungry students at the exact moment they're hungry.

Cornell Craves connects the two. Clubs run food fundraisers like real storefronts: bring in a sought-after brand, post a drop, take orders, confirm payment, and hand the food over with a scannable pass at pickup. Students get one feed (and a campus map) of every drop happening nearby, set alerts for the brands they want so they hear the second one goes live, order solo or split a box with friends, and get everything by email.

Clubs raise real money. Students finally get the food they wanted without leaving campus.

> Money never flows through the app. Students pay clubs directly over Venmo or Zelle. Cornell Craves is a place to find food and order it, not a payment processor.

---

## For students

Crave it, find it, grab it, all from your phone. Scroll a live feed or a campus map of every drop, follow the brands you love so you get pinged the moment one lands, read real reviews, and order in a few taps. Splitting a 12-box with friends? Start a group, share the link, and everyone gets their own pass.

| Feed | Listing | Reviews |
|---|---|---|
| ![Feed](docs/screenshots/student-feed.png) | ![Listing detail](docs/screenshots/student-listing.png) | ![Reviews](docs/screenshots/student-reviews.png) |
| Brand chips, live ratings, dietary icons, countdown badges. | Tabbed Items, Reviews, Q&A, and Pickup with allergen icons. | Star ratings, helpful votes, club replies. |

| Q&A | Pickup scheduling | Order form |
|---|---|---|
| ![Q&A](docs/screenshots/student-qa.png) | ![Pickup](docs/screenshots/student-pickup.png) | ![Order form](docs/screenshots/student-order.png) |
| Ask a question, the club answers in public. | Pick a day and time slot, capacity aware. | Quantity steppers, running total, split toggle. |

| My orders and groups | QR pickup passes | Split invite |
|---|---|---|
| ![My orders](docs/screenshots/student-orders.png) | ![QR passes](docs/screenshots/student-qr.png) | ![Invite](docs/screenshots/student-invite.png) |
| Solo orders, group orders, invites, deadline timers. | Per-person passes plus a 10-character backup code. | Join-link page for split orders. |

| Campus map | My pickups | Account and cravings |
|---|---|---|
| ![Map](docs/screenshots/student-map.png) | ![Pickups](docs/screenshots/student-reservations.png) | ![Account](docs/screenshots/student-account.png) |
| Labeled campus map, pickup-type badges, dietary filters. | Upcoming and past pickups, confirm attendance. | Profile, saved payment handles, brand and dietary prefs. |

## For clubs

Run the fundraiser like a real shop, not a group chat and a spreadsheet. Post a drop, take orders, confirm Venmo or Zelle payments, scan passes at pickup, and see exactly what's selling in your analytics. Save a winning drop as a template and relaunch it in two clicks.

| Sign in (Student or Club) | Club dashboard | Orders and scanner |
|---|---|---|
| ![Login](docs/screenshots/login.png) | ![Dashboard](docs/screenshots/club-dashboard.png) | ![Club orders](docs/screenshots/club-orders.png) |
| Google sign-in, Student or Club portal. | Post and manage drops, jump to your tools. | Confirm payments, filter, export CSV, scan passes. |

| Analytics | Templates | Pickup manager | Admin |
|---|---|---|---|
| ![Analytics](docs/screenshots/club-analytics.png) | ![Templates](docs/screenshots/club-templates.png) | ![Reservations](docs/screenshots/club-reservations.png) | ![Admin](docs/screenshots/admin.png) |
| Revenue, units sold, best sellers, peak hours. | Save once, relaunch in two clicks. | Per-slot rosters, mark picked up, send reminders. | Approve or reject new clubs and brands. |

> Screenshots are from a local demo with seeded data. Student screens are mobile-first (bottom tab bar); club tools are built for desktop.

---

## Everything it does

**Discovery and alerts**

- [x] Live feed with brand filtering, skeletons, staggered cards, and virtualization past 50 items
- [x] Listing pages with Venmo deep links and Zelle copy-to-clipboard
- [x] Club registration, admin approval, and a full club dashboard
- [x] Craving alerts by email, so students hear about a brand the second it drops

**Marketplace and scheduling**

- [x] Pickup scheduling with capacity-limited time slots
- [x] Reviews (one per person, immutable, with club replies) and public Q&A
- [x] Labeled campus map with per-location pins and dietary filtering
- [x] Club analytics: revenue, units sold, best and worst sellers, peak-order heatmap, dietary mix
- [x] Reusable fundraiser templates

**Orders and QR pickup**

- [x] Google sign-in, NetID onboarding, saved payment details
- [x] Order flow with server-priced totals, proxy pickup, and a review step
- [x] HMAC-signed QR passes emailed once the club confirms payment, plus a 10-character backup code
- [x] Club orders dashboard grouped by listing: confirm, filter, export CSV, and a camera scanner that works on Safari
- [x] Mobile app shell with bottom tabs and allergen icons

**Order splitting**

- [x] Split a box across friends, with invite links, email invites, and live member status
- [x] Private and public groups, with solo students auto-matched into open public groups
- [x] 24-hour payment windows with color-shifting timers
- [x] Per-member passes, auto-cancel past the deadline, and club reactivation

**Security and hardening**

- [x] Every personal-data lookup locked to the signed-in owner (see `SECURITY_AUDIT.md`)
- [x] Orders and pickups require a signed-in Google account
- [x] OWASP security headers and a strict CSP (`public/_headers` for Cloudflare, `vercel.json` for Vercel)
- [x] Terms and liability disclaimer, with money-goes-to-clubs messaging throughout
- [x] Hot-path indexes and caching for event-day traffic

---

## Tech stack

React 18, Vite, and TypeScript. Tailwind v4 with CSS-first tokens, customized shadcn-style components, and Framer Motion. MapLibre GL on a labeled OpenStreetMap basemap, Recharts, and qrcode. Supabase for Postgres, Auth, and Edge Functions. Brevo for email. Hosted on Cloudflare Pages.

## Quick start

```bash
git clone <this repo>
cd cornell-craves
npm install
cp .env.example .env.local   # fill in Supabase URL, anon key, admin email
npm run dev                  # http://localhost:5173
```

Full backend setup (Supabase project, SQL migrations, Google OAuth, Brevo, edge-function secrets, webhooks, cron, security headers, scaling) is a step-by-step checklist in `NEXT_STEPS.md`. Security details live in [`SECURITY_AUDIT.md`](SECURITY_AUDIT.md), [`SECURITY.md`](SECURITY.md), and [`docs/RLS_POLICIES.md`](docs/RLS_POLICIES.md).

## Project structure

```
src/
  components/   UI primitives, cards, filters, QR view and scanner,
                split-order components, allergen icons, bottom nav
  pages/        Feed, ListingDetail, OrderForm, MyOrders, OrderDetail, InvitePage,
                MapPage, MyReservations, Cravings, Onboarding, Preferences,
                AccountSettings, Login, Register, Terms, Dashboard, ClubOrders,
                ClubAnalytics, ClubTemplates, ClubReservations, Admin
  hooks/        useAuth, useProfile, useClub, useListings, useCountdown, and more
  lib/          supabase, orders, groups, dietary, brands, analytics, geocode, and more
  types/        database.ts (full typed schema plus RPC signatures)
supabase/
  migrations/   numbered SQL migrations, applied in order
  functions/    notify-cravings (email, QR signing, scanning, group lifecycle)
```

## Security model (summary)

- RLS on every table. Anonymous writes flow only through narrow `SECURITY DEFINER` RPCs.
- Order totals and group shares are priced server-side from the listing, never trusted from the client.
- QR passes are HMAC-SHA256 signed server-side with `QR_SECRET`. Scans are validated, single-use, and logged.
- Reading your own orders, pickups, and passes is bound to your signed-in identity, never a guessable email.
- Q&A asker emails are SHA-256 hashed in the browser before they ever leave it.

## License

MIT. See [`LICENSE`](LICENSE). Cornell Craves is an independent student project and is not affiliated with Cornell University.
