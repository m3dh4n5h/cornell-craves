import { useState } from "react";
import { CheckCircle2, Eye, EyeOff, ShieldX } from "lucide-react";
import type { TourStep } from "@/components/tour/TourShell";
import {
  Chip,
  DEMO_BRANDS,
  DEMO_CLUBS,
  MiniBars,
  MiniButton,
  Note,
  Row,
  Screen,
  Stat,
  Tabs,
  TryIt,
  useLatch,
} from "@/components/tour/sandbox";
import { cn } from "@/lib/utils";

/* ---------------------------------- 1 ---------------------------------- */

const ADMIN_TABS = ["Insights", "Approvals", "Requests", "Listings", "Clubs", "Revenue", "Brands"] as const;

function WelcomeDemo() {
  const [tab, setTab] = useState<(typeof ADMIN_TABS)[number]>("Approvals");
  const [moved, move] = useLatch();

  const COPY: Record<(typeof ADMIN_TABS)[number], string> = {
    Insights: "Platform-wide trends: revenue over time, peak ordering hours, what is growing.",
    Approvals: "Clubs waiting to be let in. Nothing they do is visible until you clear them.",
    Requests: "Brands a club wants to sell that are not on the approved list yet.",
    Listings: "Every drop on the platform, with hide and restore for moderation.",
    Clubs: "The full club roster, searchable, with their revenue and status.",
    Revenue: "Money raised broken down by brand, so you can see what is actually working.",
    Brands: "The global approved-brand list plus per-club grants you can revoke.",
  };

  return (
    <>
      <Screen label="Admin console">
        <Tabs tabs={ADMIN_TABS} value={tab} onChange={(next) => { setTab(next); move(); }} />
        <p className="mt-2 min-h-[3rem] rounded-xl border border-border bg-surface-raised p-2.5 text-xs text-ink-muted">
          {COPY[tab]}
        </p>
      </Screen>
      <TryIt done={moved}>
        {moved ? "Seven tabs, two of which you will live in: Approvals and Requests." : "Tap through the tabs to see what each one holds."}
      </TryIt>
      <Note tone="warn">
        Admin is defined by an email in the <span className="font-mono">admin_emails</span> table,
        seeded by hand - never in the codebase. If the console looks empty, that row is missing.
      </Note>
    </>
  );
}

/* ---------------------------------- 2 ---------------------------------- */

function OverviewDemo() {
  return (
    <>
      <Screen label="Overview">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Revenue" value="$3,140" sub="verified payments" />
          <Stat label="Orders" value="212" sub="18 awaiting verify" />
          <Stat label="Clubs" value="9" sub="2 pending" />
          <Stat label="Live drops" value="6" sub="3 drafts" />
          <Stat label="Students" value="418" />
          <Stat label="Craving subs" value="271" />
          <Stat label="Reservations" value="96" />
          <Stat label="Brand requests" value="2" sub="pending" />
        </div>
      </Screen>
      <Note>
        These eight tiles are the fastest read on whether the platform is healthy. "Orders awaiting
        verify" climbing without revenue moving usually means a club has gone quiet on its
        students.
      </Note>
    </>
  );
}

/* ---------------------------------- 3 ---------------------------------- */

type PendingClub = { name: string; email: string; state: "pending" | "approved" | "rejected" };

function ApprovalsDemo() {
  const [clubs, setClubs] = useState<PendingClub[]>([
    { name: DEMO_CLUBS.testing, email: "demo@example.com", state: "pending" },
    { name: DEMO_CLUBS.example, email: "sample@example.com", state: "pending" },
  ]);
  const [decided, decide] = useLatch();

  const set = (name: string, state: PendingClub["state"]) => {
    setClubs((current) => current.map((club) => (club.name === name ? { ...club, state } : club)));
    decide();
  };

  return (
    <>
      <Screen label="Club approvals">
        {clubs.map((club) => (
          <Row
            key={club.name}
            left={club.name}
            sub={club.email}
            right={
              club.state === "pending" ? (
                <span className="flex gap-1.5">
                  <MiniButton onClick={() => set(club.name, "approved")}>Approve</MiniButton>
                  <MiniButton tone="danger" onClick={() => set(club.name, "rejected")}>
                    Reject
                  </MiniButton>
                </span>
              ) : (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold",
                    club.state === "approved" ? "bg-tag-green/60 text-ink" : "bg-accent/15 text-accent",
                  )}
                >
                  {club.state === "approved" ? "Approved" : "Rejected"}
                </span>
              )
            }
          />
        ))}
      </Screen>
      <TryIt done={decided}>
        {decided
          ? "Approving sends a welcome email and unlocks their dashboard. Until then they cannot post anything."
          : "Approve one and reject the other."}
      </TryIt>
      <Note>
        This is the only gate between "someone signed up" and "a club is selling food under your
        platform's name". Check the contact email and the club is real before you clear it.
      </Note>
    </>
  );
}

/* ---------------------------------- 4 ---------------------------------- */

type Decision = "none" | "one_time" | "global" | "reject";

function BrandRequestDemo() {
  const [decision, setDecision] = useState<Decision>("none");
  const [decided, decide] = useLatch();

  const EXPLAIN: Record<Exclude<Decision, "none">, string> = {
    one_time: `Only ${DEMO_CLUBS.testing} can use this brand, and they keep it for every future drop. Their held drafts publish now.`,
    global: "The brand joins the approved list for every club. Use this for things anyone should be able to sell.",
    reject: "Nothing publishes. The club is told, and can request something else instead.",
  };

  return (
    <>
      <Screen label="Brand requests">
        <Row
          left={DEMO_BRANDS[3]}
          sub={`Requested by ${DEMO_CLUBS.testing} - 2 drops held`}
          right={<span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-bold text-ink-muted">Pending</span>}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Chip active={decision === "one_time"} onClick={() => { setDecision("one_time"); decide(); }}>
            Approve for this club
          </Chip>
          <Chip active={decision === "global"} onClick={() => { setDecision("global"); decide(); }}>
            Add to global list
          </Chip>
          <Chip active={decision === "reject"} onClick={() => { setDecision("reject"); decide(); }}>
            Reject
          </Chip>
        </div>
        {decision !== "none" && (
          <p className="mt-2 rounded-xl bg-primary/15 px-3 py-2 text-xs text-ink">
            {EXPLAIN[decision]}
          </p>
        )}
      </Screen>
      <TryIt done={decided}>
        {decided ? "Try the other two - the difference between them matters." : "Pick a decision."}
      </TryIt>
      <Note>
        Approvals are durable: a club never has to re-request a brand you already cleared for
        them. Already-expired drops become one-click postable drafts instead of publishing into
        the void.
      </Note>
    </>
  );
}

/* ---------------------------------- 5 ---------------------------------- */

function GrantsDemo() {
  const [revoked, setRevoked] = useState<string[]>([]);
  const [acted, act] = useLatch();

  const grants = [
    { club: DEMO_CLUBS.testing, brand: DEMO_BRANDS[0] },
    { club: DEMO_CLUBS.sample, brand: DEMO_BRANDS[1] },
    { club: DEMO_CLUBS.demo, brand: DEMO_BRANDS[2] },
  ];

  return (
    <>
      <Screen label="Per-club brand grants">
        {grants.map((grant) => {
          const key = `${grant.club}-${grant.brand}`;
          return (
            <Row
              key={key}
              left={grant.brand}
              sub={grant.club}
              right={
                revoked.includes(key) ? (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent">
                    Revoked
                  </span>
                ) : (
                  <MiniButton
                    tone="danger"
                    onClick={() => {
                      setRevoked((current) => [...current, key]);
                      act();
                    }}
                  >
                    <ShieldX className="size-3" aria-hidden="true" />
                    Revoke
                  </MiniButton>
                )
              }
            />
          );
        })}
      </Screen>
      <TryIt done={acted}>
        {acted ? "Revoking stops future drops with that brand. Drops already live are unaffected." : "Revoke a grant."}
      </TryIt>
    </>
  );
}

/* ---------------------------------- 6 ---------------------------------- */

function ModerationDemo() {
  const [hidden, setHidden] = useState<string[]>([]);
  const [acted, act] = useLatch();

  const listings = [
    { id: "l1", title: "Weekend donut drop", club: DEMO_CLUBS.testing },
    { id: "l2", title: "Late-night 12-box", club: DEMO_CLUBS.sample },
  ];

  return (
    <>
      <Screen label="Listings moderation">
        {listings.map((listing) => {
          const isHidden = hidden.includes(listing.id);
          return (
            <Row
              key={listing.id}
              left={listing.title}
              sub={`${listing.club}${isHidden ? " - hidden from the feed" : ""}`}
              right={
                <MiniButton
                  tone={isHidden ? "primary" : "quiet"}
                  onClick={() => {
                    setHidden((current) =>
                      current.includes(listing.id)
                        ? current.filter((id) => id !== listing.id)
                        : [...current, listing.id],
                    );
                    act();
                  }}
                >
                  {isHidden ? (
                    <>
                      <Eye className="size-3" aria-hidden="true" />
                      Restore
                    </>
                  ) : (
                    <>
                      <EyeOff className="size-3" aria-hidden="true" />
                      Hide
                    </>
                  )}
                </MiniButton>
              }
            />
          );
        })}
      </Screen>
      <TryIt done={acted}>
        {acted ? "Hiding is reversible and does not delete anything - existing orders still stand." : "Hide a drop, then restore it."}
      </TryIt>
      <Note tone="warn">
        Hiding pulls a drop off the feed but does not cancel orders already placed. If a drop has
        to stop entirely, contact the club as well.
      </Note>
    </>
  );
}

/* ---------------------------------- 7 ---------------------------------- */

function InsightsDemo() {
  return (
    <>
      <Screen label="Insights and revenue">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Revenue by day</p>
        <div className="mt-1.5">
          <MiniBars
            data={[
              { label: "Mon", value: 120 },
              { label: "Tue", value: 90 },
              { label: "Wed", value: 210 },
              { label: "Thu", value: 160 },
              { label: "Fri", value: 380 },
              { label: "Sat", value: 420 },
              { label: "Sun", value: 190 },
            ]}
          />
        </div>
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-muted">By brand</p>
        <div className="mt-1">
          <Row left={DEMO_BRANDS[0]} sub="4 clubs selling it" right={<span className="text-xs font-bold text-ink">$1,420</span>} />
          <Row left={DEMO_BRANDS[1]} sub="2 clubs selling it" right={<span className="text-xs font-bold text-ink">$980</span>} />
          <Row left={DEMO_BRANDS[2]} sub="1 club selling it" right={<span className="text-xs font-bold text-ink">$310</span>} />
        </div>
      </Screen>
      <Note>
        The Insights tab degrades on its own if its migration has not been applied - the rest of
        the console keeps working. If it is empty and everything else is not, that is why.
      </Note>
    </>
  );
}

/* ---------------------------------- 8 ---------------------------------- */

function WrapDemo() {
  return (
    <>
      <Screen label="Your routine">
        <div className="space-y-2">
          {[
            "Clear the Approvals tab so no club is stuck waiting",
            "Decide brand requests - per-club or global, and mean it",
            "Skim Listings for anything that should not be on the feed",
            "Check Insights weekly for where the money is actually coming from",
          ].map((line, index) => (
            <div key={line} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/25 text-[10px] font-extrabold text-ink">
                {index + 1}
              </span>
              <span className="text-sm text-ink">{line}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-1.5 rounded-xl border border-border bg-surface-raised p-2.5 text-xs text-ink-muted">
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary-dark" aria-hidden="true" />
          <span>
            Everything you just tapped was sample data. No club was approved, no brand was
            granted, and no drop was hidden.
          </span>
        </p>
      </Screen>
      <Note>
        Replay this from the admin console header, from account settings, or from the About
        Cornell Craves page.
      </Note>
    </>
  );
}

/* ------------------------------- The tour ------------------------------- */

export const ADMIN_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "What the console governs",
    blurb:
      "Admin is the trust layer: who gets to sell, under which brand, and what stays on the feed.",
    Demo: WelcomeDemo,
  },
  {
    id: "overview",
    title: "The eight-tile read",
    blurb: "Top of the page, always visible, on every tab.",
    Demo: OverviewDemo,
  },
  {
    id: "approvals",
    title: "Approve clubs",
    blurb: "The single most consequential button in the app.",
    Demo: ApprovalsDemo,
  },
  {
    id: "requests",
    title: "Decide brand requests",
    blurb: "Three outcomes, and they are not interchangeable.",
    Demo: BrandRequestDemo,
  },
  {
    id: "grants",
    title: "Revoke a grant",
    blurb: "Approvals are durable, which means you need a way to take one back.",
    Demo: GrantsDemo,
  },
  {
    id: "moderation",
    title: "Moderate listings",
    blurb: "Hide anything that should not be on the feed. It is reversible.",
    Demo: ModerationDemo,
  },
  {
    id: "insights",
    title: "Insights and revenue",
    blurb: "Where the money is coming from, and when.",
    Demo: InsightsDemo,
  },
  {
    id: "wrap",
    title: "The weekly loop",
    blurb: "Four habits keep the platform from silting up.",
    Demo: WrapDemo,
  },
];
