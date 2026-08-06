import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  BellRing,
  CalendarClock,
  Compass,
  Flame,
  HandCoins,
  LayoutTemplate,
  Lock,
  MapPinned,
  MessagesSquare,
  QrCode,
  ReceiptText,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Store,
  Users,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTour } from "@/hooks/useTour";
import { TOUR_META, type TourKey } from "@/lib/tour";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

type Feature = { Icon: LucideIcon; title: string; body: string };

const STUDENT_FEATURES: Feature[] = [
  {
    Icon: Flame,
    title: "One live feed",
    body: "Every active drop on campus, newest first, with a countdown that closes ordering the moment it runs out. Filter by brand with a single tap. Dietary and allergen badges sit on every card, and the star rating is a live average from people who actually ordered.",
  },
  {
    Icon: MapPinned,
    title: "Campus map",
    body: "The same drops arranged by where you have to walk. Each pin shows what is picking up there, the pickup type (walk-up, table, or delivery), and what dietary options are available. Filter the map down to your saved preferences. If your connection drops, it falls back to the last-known feed.",
  },
  {
    Icon: BellRing,
    title: "Craving alerts",
    body: "Subscribe to a brand and you get an email the second any club posts a drop for it. Good drops sell out in hours, so this is the difference between hearing at minute one and hearing at hour six.",
  },
  {
    Icon: ReceiptText,
    title: "Ordering",
    body: "Quantity steppers with a running total, priced by the server rather than the browser. Your saved Venmo or Zelle handle pre-fills. Add a proxy if someone else is collecting for you, then review everything before you commit.",
  },
  {
    Icon: CalendarClock,
    title: "Pickup scheduling",
    body: "Pick a day and a time window. Slots are capacity-limited and show how many spots are left, so a full window is not selectable and nobody queues for nothing.",
  },
  {
    Icon: Users,
    title: "Split orders",
    body: "A 12-box is cheaper per unit but too much for one person. Start a split, share the invite link, and each person pays their own share directly to the club. Private groups for your friends, or public groups that match solo students automatically. Everyone has 24 hours to pay; the timer turns orange under six hours and red under two. Miss it and the spot is released.",
  },
  {
    Icon: QrCode,
    title: "QR pickup passes",
    body: "Once the club confirms your payment, your pass is emailed and appears in the app. Show the QR at the table, or read out the 10-character backup code if the screen will not cooperate. Passes are signed server-side and single-use, so a forwarded screenshot checks nobody in.",
  },
  {
    Icon: MessagesSquare,
    title: "Reviews and public Q&A",
    body: "Ask a question and the club answers in public, so the next person does not have to ask again. After pickup you can leave one review per drop, with a star rating. Reviews cannot be edited after submission, which is exactly why the ratings are worth reading.",
  },
  {
    Icon: UserRound,
    title: "Your account",
    body: "Cornell Google sign-in, your NetID once, and optional Venmo and Zelle handles that pre-fill every order. Dietary filters save to your account and pre-apply everywhere you browse. Orders, upcoming pickups, and past pickups all live in one place.",
  },
];

const CLUB_FEATURES: Feature[] = [
  {
    Icon: Store,
    title: "Register and get approved",
    body: "Sign in with the account your club will use, fill in your name, description, contact email, and the Venmo or Zelle where students will pay you. An admin reviews it; you get a welcome email and an unlocked dashboard once you are cleared.",
  },
  {
    Icon: Flame,
    title: "Post a drop",
    body: "Brand, title, description, items with prices and allergen tags, an order deadline, a pickup type, a pickup location, and one or more capacity-limited time slots. It goes live on the student feed immediately. Edit or take it down at any point; students with existing orders are notified.",
  },
  {
    Icon: ShieldCheck,
    title: "Brand approval",
    body: "Brands already on the approved list post instantly. Anything new is held as a draft until an admin clears it once, after which every future drop your club posts with that brand publishes straight away. The database enforces this, so there is no path around the gate, including through templates.",
  },
  {
    Icon: HandCoins,
    title: "Verify payments",
    body: "Orders arrive grouped by listing with the student's name, NetID, items, total, and the payment handle they gave. Filter by status, search by name or NetID, and export any listing to CSV. When you see the money land in your own Venmo or Zelle, tap Verify and the student's QR pass is emailed instantly.",
  },
  {
    Icon: ScanLine,
    title: "Scan passes at pickup",
    body: "A built-in camera scanner that works in Safari and Chrome on iOS. Green means valid and the student is marked picked up; red means the pass was already used or is invalid. If a phone will not load, take the 10-character backup code instead.",
  },
  {
    Icon: CalendarClock,
    title: "Pickup manager",
    body: "A slot-by-slot roster of exactly who is coming when, with their order details. Mark someone picked up without scanning, or send an email reminder to everyone booked into a window.",
  },
  {
    Icon: Users,
    title: "Split orders, per member",
    body: "Off by default; turn it on and students can share a box. Each member tells you how they are paying and with which handle, and you verify each share separately, because each person pays you separately. Passes go out once the whole group has paid. Groups that fall apart can be reactivated rather than lost.",
  },
  {
    Icon: BarChart3,
    title: "Analytics",
    body: "Revenue per listing and overall, units sold item by item, best and worst sellers, an hour-by-hour heatmap of when orders actually come in, and your dietary mix. The peak-hour chart is the one that changes behaviour: post just before the spike, not after it.",
  },
  {
    Icon: LayoutTemplate,
    title: "Templates",
    body: "Save a drop that worked and relaunch it in two clicks with the items, prices, pickup spot, and slots already filled in. Templates are private to your club.",
  },
  {
    Icon: MessagesSquare,
    title: "Reviews and Q&A replies",
    body: "Reply publicly to any review, and answer questions once so everyone sees the answer. Unanswered questions show a badge on your dashboard.",
  },
];

const ADMIN_FEATURES: Feature[] = [
  {
    Icon: ShieldCheck,
    title: "Club approvals",
    body: "The gate between someone signing up and a club selling food on the platform. Nothing a club does is visible until an admin clears it. Approving sends a welcome email and unlocks the dashboard.",
  },
  {
    Icon: Sparkles,
    title: "Brand requests",
    body: "Three outcomes, and they are not interchangeable: approve for this club only (durable, so they never re-request), add to the global approved list for everyone, or reject. Approving releases the drafts the club had held.",
  },
  {
    Icon: Lock,
    title: "Per-club grants and moderation",
    body: "Every durable grant is listed and revocable. Every listing on the platform can be hidden and restored, which pulls a drop off the feed without deleting anything or cancelling existing orders.",
  },
  {
    Icon: BarChart3,
    title: "Platform insights",
    body: "Revenue over time, revenue by brand, peak ordering hours, and the eight-tile overview of clubs, students, orders, drops, reservations, and pending requests.",
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Does Cornell Craves take a cut of what clubs raise?",
    a: "No. Not a cent. Money never flows through the app at all - students pay clubs directly over Venmo or Zelle, and the club confirms it manually. There is no fee, no processing, and no escrow.",
  },
  {
    q: "So what happens if a payment goes wrong?",
    a: (
      <>
        It is between you and the club, because Cornell Craves is not a party to the transaction
        and has no ability to issue refunds or chargebacks. That trade-off is what keeps the
        service free. The full position is in the{" "}
        <Link to="/terms" className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline">
          terms and disclaimer
        </Link>
        .
      </>
    ),
  },
  {
    q: "Who can order?",
    a: "Current Cornell students, signed in with an @cornell.edu Google account. Browsing the feed and the map is open to anyone; ordering, reserving a pickup, and craving alerts are not.",
  },
  {
    q: "Can a club order as a student?",
    a: "No. A club account manages its own drops and can browse the feed and map, but cannot place orders, set craving alerts, or reserve pickups. If you signed up as the wrong type, account settings lets you remove the account and start again.",
  },
  {
    q: "Are the allergen labels reliable?",
    a: "They are entered by clubs and are not verified by Cornell Craves. Treat them as a convenience, not a guarantee. If you have an allergy, confirm with the club before you eat anything.",
  },
  {
    q: "What happens if I lose my QR pass?",
    a: "Open the order in the app - the pass is always there, along with a 10-character backup code that works exactly the same way at the table. Passes are single-use, so once you have been scanned it is spent.",
  },
  {
    q: "Is Cornell Craves run by Cornell University?",
    a: "No. It is an independent student project, not affiliated with, endorsed by, or operated by Cornell University. The name describes the community it serves, nothing more.",
  },
];

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function TourCard({ tour, Icon }: { tour: TourKey; Icon: LucideIcon }) {
  const { open, seen, reset } = useTour();
  const meta = TOUR_META[tour];
  const done = seen.has(tour);

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-surface-raised p-5">
      <span className="flex size-11 items-center justify-center rounded-2xl bg-primary/20">
        <Icon className="size-5 text-primary-dark" aria-hidden="true" />
      </span>
      <h3 className="mt-4 font-display text-base font-extrabold text-ink">{meta.label}</h3>
      <p className="mt-1.5 flex-1 text-sm text-ink-muted">{meta.blurb}</p>
      <Button
        className="mt-4 w-full"
        variant={done ? "secondary" : "primary"}
        onClick={() => {
          // Replaying should also clear the "seen" flag, so a person who wants
          // the tour back gets it offered again on their next device too.
          if (done) reset(tour);
          open(tour);
        }}
      >
        <Compass className="size-4" aria-hidden="true" />
        {done ? "Replay" : "Start"} - {meta.minutes}
      </Button>
    </div>
  );
}

function FeatureList({ features }: { features: Feature[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {features.map(({ Icon, title, body }) => (
        <div key={title} className="rounded-2xl border border-border bg-surface-raised p-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/20">
              <Icon className="size-4 text-primary-dark" aria-hidden="true" />
            </span>
            <h3 className="font-display text-sm font-extrabold text-ink">{title}</h3>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{body}</p>
        </div>
      ))}
    </div>
  );
}

const AUDIENCES = [
  { id: "students", label: "For students", features: STUDENT_FEATURES },
  { id: "clubs", label: "For clubs", features: CLUB_FEATURES },
  { id: "admins", label: "For admins", features: ADMIN_FEATURES },
] as const;

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function About() {
  const [audience, setAudience] = useState<(typeof AUDIENCES)[number]["id"]>("students");
  const active = AUDIENCES.find((entry) => entry.id === audience) ?? AUDIENCES[0];

  return (
    <div className="pb-16">
      {/* Hero */}
      <section className="bg-primary">
        <div className="mx-auto w-full max-w-4xl px-4 py-12 md:py-16">
          <p className="text-xs font-bold uppercase tracking-wide text-on-primary/70">
            About Cornell Craves
          </p>
          <h1 className="mt-2 max-w-[20ch] font-display text-3xl font-extrabold tracking-tight text-on-primary">
            The food you actually crave, brought to campus by clubs.
          </h1>
          <p className="mt-4 max-w-[60ch] text-on-primary/85">
            Student clubs bring in sought-after food and sell it to fund what they do. Students
            get one feed of every drop on campus, order in a few taps, and collect with a QR
            pass. Clubs raise real money. Nobody drives across town.
          </p>
        </div>
      </section>

      <div className="mx-auto w-full max-w-4xl px-4">
        {/* Walkthroughs - first, because doing beats reading */}
        <section className="mt-10">
          <h2 className="font-display text-xl font-extrabold tracking-tight">
            Take a walkthrough
          </h2>
          <p className="mt-1.5 max-w-[60ch] text-sm text-ink-muted">
            Interactive, and entirely simulated. You tap through fake screens with sample clubs
            and sample students, so nothing you do here touches a real drop, order, or account.
            Leave at any point.
          </p>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <TourCard tour="student" Icon={UserRound} />
            <TourCard tour="club" Icon={Store} />
            <TourCard tour="admin" Icon={ShieldCheck} />
          </div>
        </section>

        {/* Why */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-extrabold tracking-tight">Why it exists</h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-muted">
            <p>
              Ithaca is not a food city. The stuff students actually crave is either not here at
              all, or it is a cross-town trip nobody is making between a 10:10 and an 11:15. So
              the craving just sits there.
            </p>
            <p>
              Meanwhile the people who could bring that food to campus - clubs trying to raise
              money - have no good way to reach hungry students at the exact moment they are
              hungry. A group chat and a spreadsheet is not a storefront.
            </p>
            <p>
              Cornell Craves connects the two. Clubs run food fundraisers like real shops: bring
              in a brand, post a drop, take orders, confirm payment, and hand the food over
              against a scannable pass. Students get one place to find all of it.
            </p>
          </div>
        </section>

        {/* The money rule - deliberately loud */}
        <section className="mt-12">
          <div className="rounded-2xl border border-accent/40 bg-accent/10 p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15">
                <HandCoins className="size-5 text-accent" aria-hidden="true" />
              </span>
              <h2 className="font-display text-lg font-extrabold tracking-tight">
                Money never touches this app
              </h2>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-muted">
              Cornell Craves is a place to find food and order it. It is not a payment processor.
              You pay the club directly on Venmo or Zelle, using the details that club published,
              and the club confirms the payment by hand before your pass is issued. No fees, no
              cut, no escrow - and no refunds or chargebacks, because there is nothing in the
              middle to reverse. Every payment dispute is between you and the club.
            </p>
            <Link
              to="/terms"
              className="mt-3 inline-block text-sm font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
            >
              Read the full terms and disclaimer
            </Link>
          </div>
        </section>

        {/* How it works */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-extrabold tracking-tight">How it works</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            {[
              {
                who: "If you are a student",
                Icon: UserRound,
                steps: [
                  "Sign in with your Cornell Google account and add your NetID once.",
                  "Browse the feed or the map, or set alerts for the brands you want.",
                  "Order solo, or split a box and share the invite link with friends.",
                  "Pay the club on Venmo or Zelle. They confirm it.",
                  "Your QR pass arrives by email. Show it at pickup.",
                  "Leave a review so the next person knows what to expect.",
                ],
              },
              {
                who: "If you are a club",
                Icon: Store,
                steps: [
                  "Register your club and wait for admin approval.",
                  "Post a drop: brand, items, deadline, pickup spot, time slots.",
                  "Orders come in. Students pay you directly.",
                  "Verify each payment - passes go out automatically.",
                  "Scan passes at pickup, or work the roster by hand.",
                  "Read your analytics, save the winner as a template, run it again.",
                ],
              },
            ].map(({ who, Icon, steps }) => (
              <div key={who} className="rounded-2xl border border-border bg-surface-raised p-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/20">
                    <Icon className="size-4.5 text-primary-dark" aria-hidden="true" />
                  </span>
                  <h3 className="font-display text-base font-extrabold text-ink">{who}</h3>
                </div>
                <ol className="mt-4 space-y-2.5">
                  {steps.map((step, index) => (
                    <li key={step} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/25 text-[10px] font-extrabold text-ink">
                        {index + 1}
                      </span>
                      <span className="text-sm text-ink-muted">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>

        {/* Everything it does */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-extrabold tracking-tight">
            Everything it does
          </h2>
          <div
            className="mt-4 flex flex-wrap gap-2"
            role="tablist"
            aria-label="Feature audience"
          >
            {AUDIENCES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={audience === id}
                onClick={() => setAudience(id)}
                className={cn(
                  "rounded-full px-4 py-1.5 text-sm font-bold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                  audience === id
                    ? "bg-ink text-surface-raised"
                    : "border border-border text-ink-muted hover-fine:border-primary hover-fine:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-4">
            <FeatureList features={active.features} />
          </div>
        </section>

        {/* Security */}
        <section className="mt-12">
          <div className="rounded-2xl border border-border bg-surface-raised p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/20">
                <Lock className="size-4.5 text-primary-dark" aria-hidden="true" />
              </span>
              <h2 className="font-display text-lg font-extrabold tracking-tight">
                How your data is handled
              </h2>
            </div>
            <ul className="mt-4 space-y-2.5">
              {[
                "Every personal-data lookup is locked to the signed-in owner. Your orders, pickups, and passes are readable by you, not by anyone who guesses an email address.",
                "Order totals and split shares are priced server-side from the listing, never trusted from the browser.",
                "QR passes are signed server-side, validated on scan, single-use, and logged.",
                "Questions you ask in Q&A are hashed in your browser before the email ever leaves it.",
                "We store only what the service needs, and we do not sell your data. Deleting your account in settings removes it.",
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <ShieldCheck
                    className="mt-0.5 size-4 shrink-0 text-primary-dark"
                    aria-hidden="true"
                  />
                  <span className="text-sm leading-relaxed text-ink-muted">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section className="mt-12">
          <h2 className="font-display text-xl font-extrabold tracking-tight">
            Questions people actually ask
          </h2>
          <div className="mt-4 space-y-2">
            {FAQ.map(({ q, a }) => (
              <details
                key={q}
                className="group rounded-2xl border border-border bg-surface-raised px-4 py-3 [&_summary::-webkit-details-marker]:hidden"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-ink">
                  {q}
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-lg font-normal text-ink-muted transition-transform duration-200 group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="mt-12 text-xs leading-relaxed text-ink-muted">
          Cornell Craves is an independent student project and is not affiliated with, endorsed
          by, or operated by Cornell University. Club and student names shown inside the
          walkthroughs are invented sample data and do not refer to any real organization.
        </p>
      </div>
    </div>
  );
}
