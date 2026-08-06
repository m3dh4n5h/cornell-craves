import { useState } from "react";
import {
  BadgeCheck,
  CameraOff,
  CheckCircle2,
  Clock,
  Hourglass,
  ScanLine,
  XCircle,
} from "lucide-react";
import type { TourStep } from "@/components/tour/TourShell";
import {
  Chip,
  DEMO_BRANDS,
  DEMO_CLUBS,
  DEMO_PEOPLE,
  DEMO_SPOTS,
  MiniBars,
  MiniButton,
  Note,
  Row,
  Screen,
  Stat,
  Stepper,
  Tabs,
  Toggle,
  TryIt,
  useLatch,
} from "@/components/tour/sandbox";
import { cn } from "@/lib/utils";

/* ---------------------------------- 1 ---------------------------------- */

function WelcomeDemo() {
  return (
    <>
      <Screen label={`${DEMO_CLUBS.testing} - dashboard`}>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Revenue" value="$482.50" sub="verified payments" />
          <Stat label="To verify" value="6" sub="orders awaiting check" />
          <Stat label="Live drops" value="2" sub="1 held for brand approval" />
          <Stat label="Reservations" value="31" sub="upcoming pickups" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {["Orders", "Analytics", "Templates", "Reservations"].map((tool) => (
            <Chip key={tool}>{tool}</Chip>
          ))}
        </div>
      </Screen>
      <Note>
        Everything a club does lives behind these four tools plus the drop form. The rest of this
        walkthrough goes through them in the order you will actually use them.
      </Note>
      <Note tone="warn">
        Students pay you directly on Venmo or Zelle. Cornell Craves never holds or forwards your
        money, and never takes a cut - which also means reconciling payments is on you.
      </Note>
    </>
  );
}

/* ---------------------------------- 2 ---------------------------------- */

function ApprovalDemo() {
  const [approved, approve] = useLatch();
  return (
    <>
      <Screen label="Registration">
        {!approved ? (
          <div className="flex flex-col items-center py-5 text-center">
            <Hourglass className="size-7 text-primary-dark" aria-hidden="true" />
            <p className="mt-2 font-display text-base font-extrabold text-ink">
              Hang tight, {DEMO_CLUBS.testing}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Waiting on admin approval. You will get a welcome email the moment you are cleared.
            </p>
            <MiniButton className="mt-3" onClick={approve}>
              Simulate the admin approving you
            </MiniButton>
          </div>
        ) : (
          <div className="flex flex-col items-center py-5 text-center">
            <BadgeCheck className="size-7 text-primary-dark" aria-hidden="true" />
            <p className="mt-2 font-display text-base font-extrabold text-ink">Dashboard unlocked</p>
            <p className="mt-1 text-xs text-ink-muted">You can post drops now.</p>
          </div>
        )}
        <div className="mt-3">
          <Row left="Club name" right={<span className="text-xs font-bold text-ink">{DEMO_CLUBS.testing}</span>} />
          <Row left="Contact email" sub="Where order notifications land" right={<span className="text-xs text-ink-muted">demo@example.com</span>} />
          <Row left="Venmo" sub="Shown to students on every listing" right={<span className="text-xs font-bold text-ink">@testing-club-demo</span>} />
          <Row left="Zelle" right={<span className="text-xs text-ink-muted">Optional</span>} />
        </div>
      </Screen>
      <TryIt done={approved}>
        {approved ? "Registration happens once. After that you go straight to the dashboard." : "Tap the button to see what approval unlocks."}
      </TryIt>
      <Note tone="warn">
        Get the Venmo and Zelle details right. Change them while a drop is live and you take sole
        responsibility for money that lands in either account.
      </Note>
    </>
  );
}

/* ---------------------------------- 3 ---------------------------------- */

function PostDropDemo() {
  const [brand, setBrand] = useState<string | null>(null);
  const [items, setItems] = useState<{ name: string; price: string }[]>([]);
  const [added, add] = useLatch();

  return (
    <>
      <Screen label="New drop">
        <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Brand</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DEMO_BRANDS.slice(0, 3).map((option) => (
            <Chip key={option} active={brand === option} onClick={() => setBrand(option)}>
              {option}
            </Chip>
          ))}
          <Chip active={brand === "Other"} onClick={() => setBrand("Other")}>
            Other...
          </Chip>
        </div>
        <div className="mt-3 space-y-1.5">
          <Row left="Title" sub="Shown on the feed card" right={<span className="text-xs text-ink-muted">Weekend donut drop</span>} />
          <Row left="Order deadline" sub="Ordering closes, drop leaves the feed" right={<span className="text-xs text-ink-muted">Sat 10:00</span>} />
          <Row left="Pickup type" right={<span className="text-xs text-ink-muted">Walk-up table</span>} />
        </div>
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-muted">Items</p>
        <div className="mt-1">
          {items.map((item) => (
            <Row key={item.name} left={item.name} right={<span className="text-xs font-bold text-ink">{item.price}</span>} />
          ))}
          {items.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-ink-muted">
              No items yet.
            </p>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <MiniButton
            tone="quiet"
            onClick={() => {
              setItems((current) =>
                current.some((i) => i.name === "Glazed dozen")
                  ? current
                  : [...current, { name: "Glazed dozen", price: "$14.99" }],
              );
              add();
            }}
          >
            + Glazed dozen
          </MiniButton>
          <MiniButton
            tone="quiet"
            onClick={() => {
              setItems((current) =>
                current.some((i) => i.name === "Single glazed")
                  ? current
                  : [...current, { name: "Single glazed", price: "$1.75" }],
              );
              add();
            }}
          >
            + Single glazed
          </MiniButton>
        </div>
        <MiniButton className="mt-3" disabled={!brand || items.length === 0}>
          Post drop
        </MiniButton>
      </Screen>
      <TryIt done={added && Boolean(brand)}>
        {added && brand
          ? "That is a postable drop. Real items also take a description and allergen tags."
          : "Pick a brand, then add at least one item."}
      </TryIt>
    </>
  );
}

/* ---------------------------------- 4 ---------------------------------- */

function BrandGateDemo() {
  const [state, setState] = useState<"draft" | "requested" | "approved">("draft");
  const [moved, move] = useLatch();

  return (
    <>
      <Screen label="Brand approval">
        <Row
          left="Weekend donut drop"
          sub={
            state === "draft"
              ? "Draft - brand not approved yet"
              : state === "requested"
                ? "Draft - request with the admin"
                : "Live on the feed"
          }
          right={
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold",
                state === "approved" ? "bg-tag-green/60 text-ink" : "border border-border text-ink-muted",
              )}
            >
              {state === "approved" ? "Live" : "Held"}
            </span>
          }
        />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {state === "draft" && (
            <MiniButton
              onClick={() => {
                setState("requested");
                move();
              }}
            >
              Request this brand
            </MiniButton>
          )}
          {state === "requested" && (
            <MiniButton
              tone="quiet"
              onClick={() => {
                setState("approved");
                move();
              }}
            >
              Simulate the admin approving it
            </MiniButton>
          )}
          {state === "approved" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-primary-dark">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              Published automatically
            </span>
          )}
        </div>
      </Screen>
      <TryIt done={moved}>
        {state === "approved"
          ? "Approval is durable: every future drop your club posts with that brand publishes straight away."
          : "Walk the draft through approval."}
      </TryIt>
      <Note>
        A brand already on the approved list posts instantly. Anything new is held as a draft
        until an admin clears it, and the database enforces that - there is no way around the
        gate, including via templates.
      </Note>
    </>
  );
}

/* ---------------------------------- 5 ---------------------------------- */

function SlotsDemo() {
  const [slots, setSlots] = useState([{ time: "12:00 - 12:30", cap: 20 }]);
  const [added, add] = useLatch();

  return (
    <>
      <Screen label="Pickup spot and slots">
        <Row left={DEMO_SPOTS[0]} sub="Walk-up table - pinned on the campus map" right={<span className="text-xs text-ink-muted">Spot</span>} />
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-muted">Time slots</p>
        <div className="mt-1">
          {slots.map((slot, index) => (
            <div
              key={slot.time}
              className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0"
            >
              <span className="text-sm font-semibold text-ink">{slot.time}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-ink-muted">Capacity</span>
                <Stepper
                  label="spot"
                  value={slot.cap}
                  max={40}
                  onChange={(next) => {
                    setSlots((current) =>
                      current.map((s, i) => (i === index ? { ...s, cap: next } : s)),
                    );
                    add();
                  }}
                />
              </span>
            </div>
          ))}
        </div>
        <MiniButton
          className="mt-2"
          tone="quiet"
          onClick={() => {
            setSlots((current) =>
              current.length >= 3
                ? current
                : [...current, { time: current.length === 1 ? "12:30 - 1:00" : "1:00 - 1:30", cap: 20 }],
            );
            add();
          }}
        >
          <Clock className="size-3" aria-hidden="true" />
          Add another slot
        </MiniButton>
      </Screen>
      <TryIt done={added}>
        {added ? "Students can only book a slot with room left, so no window gets mobbed." : "Add a slot or change a capacity."}
      </TryIt>
      <Note>
        Pickup spots come from a curated campus list, and you can add your own. Each one shows as a
        pin on the student map for as long as your drop is live.
      </Note>
    </>
  );
}

/* ---------------------------------- 6 ---------------------------------- */

type DemoOrder = {
  id: string;
  who: string;
  netid: string;
  items: string;
  total: string;
  handle: string;
  status: "pending" | "verified";
};

const START_ORDERS: DemoOrder[] = [
  { id: "o1", who: DEMO_PEOPLE.you.name, netid: DEMO_PEOPLE.you.netid, items: "1x Glazed dozen", total: "$14.99", handle: `@${DEMO_PEOPLE.you.venmo}`, status: "pending" },
  { id: "o2", who: DEMO_PEOPLE.friend1.name, netid: DEMO_PEOPLE.friend1.netid, items: "2x Single glazed", total: "$3.50", handle: `@${DEMO_PEOPLE.friend1.venmo}`, status: "pending" },
  { id: "o3", who: DEMO_PEOPLE.friend2.name, netid: DEMO_PEOPLE.friend2.netid, items: "1x Glazed dozen", total: "$14.99", handle: "Zelle (607) 555-0142", status: "verified" },
];

function OrdersDemo() {
  const [orders, setOrders] = useState(START_ORDERS);
  const [filter, setFilter] = useState<"All" | "Pending" | "Verified">("All");
  const [verified, verify] = useLatch();

  const shown = orders.filter((order) =>
    filter === "All" ? true : filter === "Pending" ? order.status === "pending" : order.status === "verified",
  );

  return (
    <>
      <Screen label="Orders - Weekend donut drop">
        <Tabs tabs={["All", "Pending", "Verified"] as const} value={filter} onChange={setFilter} />
        <div className="mt-1">
          {shown.map((order) => (
            <Row
              key={order.id}
              left={`${order.who} (${order.netid})`}
              sub={`${order.items} - ${order.total} - ${order.handle}`}
              right={
                order.status === "pending" ? (
                  <MiniButton
                    onClick={() => {
                      setOrders((current) =>
                        current.map((o) => (o.id === order.id ? { ...o, status: "verified" } : o)),
                      );
                      verify();
                    }}
                  >
                    Verify payment
                  </MiniButton>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-tag-green/60 px-2 py-0.5 text-[10px] font-bold text-ink">
                    <CheckCircle2 className="size-3" aria-hidden="true" />
                    Pass sent
                  </span>
                )
              }
            />
          ))}
          {shown.length === 0 && (
            <p className="py-4 text-center text-xs text-ink-muted">Nothing in this filter.</p>
          )}
        </div>
        <MiniButton className="mt-2" tone="quiet">
          Export CSV
        </MiniButton>
      </Screen>
      <TryIt done={verified}>
        {verified
          ? "Verifying emails that student their QR pass instantly. Only do it after you see the money."
          : "Check your Venmo, then tap Verify payment on an order."}
      </TryIt>
      <Note tone="warn">
        Verify means "I have been paid". Nothing checks this for you - Cornell Craves cannot see
        your Venmo. Verify by mistake and you have handed out food for free.
      </Note>
    </>
  );
}

/* ---------------------------------- 7 ---------------------------------- */

function ScannerDemo() {
  const [result, setResult] = useState<"idle" | "ok" | "used" | "code">("idle");
  const [scanned, scan] = useLatch();

  return (
    <>
      <Screen label="Scan passes">
        <div
          className={cn(
            "flex h-32 flex-col items-center justify-center rounded-xl border-2 border-dashed transition-colors duration-200",
            result === "ok" || result === "code"
              ? "border-primary bg-tag-green/25"
              : result === "used"
                ? "border-accent bg-accent/10"
                : "border-border bg-surface-raised",
          )}
        >
          {result === "idle" && (
            <>
              <ScanLine className="size-7 text-ink-muted" aria-hidden="true" />
              <p className="mt-1 text-xs text-ink-muted">Point the camera at a pass</p>
            </>
          )}
          {(result === "ok" || result === "code") && (
            <>
              <CheckCircle2 className="size-7 text-primary-dark" aria-hidden="true" />
              <p className="mt-1 text-sm font-bold text-ink">{DEMO_PEOPLE.you.name}</p>
              <p className="text-xs text-ink-muted">
                1x Glazed dozen - marked picked up{result === "code" ? " (backup code)" : ""}
              </p>
            </>
          )}
          {result === "used" && (
            <>
              <XCircle className="size-7 text-accent" aria-hidden="true" />
              <p className="mt-1 text-sm font-bold text-accent">Already used</p>
              <p className="text-xs text-ink-muted">This pass was scanned 4 minutes ago.</p>
            </>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <MiniButton
            onClick={() => {
              setResult("ok");
              scan();
            }}
          >
            Scan a valid pass
          </MiniButton>
          <MiniButton
            tone="danger"
            onClick={() => {
              setResult("used");
              scan();
            }}
          >
            Scan a used pass
          </MiniButton>
          <MiniButton
            tone="quiet"
            onClick={() => {
              setResult("code");
              scan();
            }}
          >
            <CameraOff className="size-3" aria-hidden="true" />
            Enter backup code
          </MiniButton>
        </div>
      </Screen>
      <TryIt done={scanned}>
        {scanned ? "Every pass is single-use, so a forwarded screenshot checks nobody in twice." : "Try all three outcomes."}
      </TryIt>
      <Note>
        The scanner works in Safari and Chrome on iOS. If a phone will not cooperate at the table,
        take their 10-character backup code instead - it does the same thing.
      </Note>
    </>
  );
}

/* ---------------------------------- 8 ---------------------------------- */

function ReservationsDemo() {
  const [done, setDone] = useState<string[]>([]);
  const [reminded, setReminded] = useState(false);
  const [acted, act] = useLatch();

  const roster = [DEMO_PEOPLE.you, DEMO_PEOPLE.friend1, DEMO_PEOPLE.friend3];

  return (
    <>
      <Screen label="Pickup manager">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-ink">12:00 - 12:30</p>
            <p className="text-xs text-ink-muted">
              {DEMO_SPOTS[0]} - {roster.length} booked
            </p>
          </div>
          <MiniButton
            tone="quiet"
            onClick={() => {
              setReminded(true);
              act();
            }}
          >
            {reminded ? "Reminder sent" : "Remind this slot"}
          </MiniButton>
        </div>
        <div className="mt-2">
          {roster.map((person) => (
            <Row
              key={person.netid}
              left={person.name}
              sub={person.netid}
              right={
                done.includes(person.netid) ? (
                  <span className="rounded-full bg-tag-green/60 px-2 py-0.5 text-[10px] font-bold text-ink">
                    Picked up
                  </span>
                ) : (
                  <MiniButton
                    tone="quiet"
                    onClick={() => {
                      setDone((current) => [...current, person.netid]);
                      act();
                    }}
                  >
                    Mark picked up
                  </MiniButton>
                )
              }
            />
          ))}
        </div>
      </Screen>
      <TryIt done={acted}>
        {acted ? "Same result as scanning, for when the line is moving faster than the camera." : "Send a reminder, or mark someone picked up."}
      </TryIt>
    </>
  );
}

/* ---------------------------------- 9 ---------------------------------- */

function SplitClubDemo() {
  const [on, setOn] = useState(false);
  const [verifiedMembers, setVerifiedMembers] = useState<string[]>([]);
  const [acted, act] = useLatch();

  const members = [
    { name: DEMO_PEOPLE.you.name, how: `Venmo @${DEMO_PEOPLE.you.venmo}`, share: "$4.50" },
    { name: DEMO_PEOPLE.friend1.name, how: `Venmo @${DEMO_PEOPLE.friend1.venmo}`, share: "$4.50" },
    { name: DEMO_PEOPLE.friend2.name, how: "Zelle (607) 555-0188", share: "$4.50" },
    { name: DEMO_PEOPLE.friend3.name, how: `Venmo @${DEMO_PEOPLE.friend3.venmo}`, share: "$4.50" },
  ];

  return (
    <>
      <Screen label="Split orders">
        <Toggle
          checked={on}
          onChange={(next) => {
            setOn(next);
            act();
          }}
          label="Allow split orders"
          hint="Students can share one box, each paying their own share"
        />
        {on && (
          <div className="mt-3">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
              Group on Weekend donut drop - $18.00 box, 4 ways
            </p>
            <div className="mt-1">
              {members.map((member) => (
                <Row
                  key={member.name}
                  left={member.name}
                  sub={`${member.how} - ${member.share}`}
                  right={
                    verifiedMembers.includes(member.name) ? (
                      <span className="rounded-full bg-tag-green/60 px-2 py-0.5 text-[10px] font-bold text-ink">
                        Verified
                      </span>
                    ) : (
                      <MiniButton
                        onClick={() => {
                          setVerifiedMembers((current) => [...current, member.name]);
                          act();
                        }}
                      >
                        Verify share
                      </MiniButton>
                    )
                  }
                />
              ))}
            </div>
            <p className="mt-2 rounded-xl bg-primary/15 px-3 py-2 text-xs text-ink">
              {verifiedMembers.length === members.length
                ? "All four verified - passes just went out to everyone."
                : `${verifiedMembers.length} of ${members.length} verified. Passes go out once everyone has paid.`}
            </p>
          </div>
        )}
      </Screen>
      <TryIt done={acted}>
        {acted ? "You verify each person separately, because each person pays you separately." : "Turn splitting on, then verify a share."}
      </TryIt>
      <Note>
        Members get 24 hours to pay. Anyone who misses it is auto-cancelled and their spot opens
        back up - and you can reactivate a group that fell apart if you would rather not lose the
        sale.
      </Note>
    </>
  );
}

/* --------------------------------- 10 ---------------------------------- */

function AnalyticsDemo() {
  return (
    <>
      <Screen label="Analytics">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Revenue" value="$482.50" />
          <Stat label="Units" value="76" />
          <Stat label="Orders" value="41" />
        </div>
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
          Orders by hour
        </p>
        <div className="mt-1.5">
          <MiniBars
            data={[
              { label: "9a", value: 2 },
              { label: "11a", value: 6 },
              { label: "1p", value: 4 },
              { label: "3p", value: 3 },
              { label: "6p", value: 11 },
              { label: "9p", value: 15 },
              { label: "11p", value: 7 },
            ]}
          />
        </div>
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
          Best and worst
        </p>
        <div className="mt-1">
          <Row left="Glazed dozen" sub="38 sold" right={<span className="text-xs font-bold text-ink">$569.62</span>} />
          <Row left="Single glazed" sub="21 sold" right={<span className="text-xs font-bold text-ink">$36.75</span>} />
          <Row left="Chocolate iced dozen" sub="3 sold - consider cutting" right={<span className="text-xs text-ink-muted">$50.97</span>} />
        </div>
      </Screen>
      <Note>
        The peak-hour chart is the useful one: post your next drop just before the spike, not
        after it. The dietary mix tells you which options are actually pulling their weight.
      </Note>
    </>
  );
}

/* --------------------------------- 11 ---------------------------------- */

function TemplatesDemo() {
  const [launched, launch] = useLatch();
  return (
    <>
      <Screen label="Templates">
        <Row
          left="Weekend donut drop"
          sub="3 items - 2 slots - walk-up at North Quad Lawn"
          right={
            <MiniButton onClick={launch}>{launched ? "Form pre-filled" : "Use template"}</MiniButton>
          }
        />
        <Row left="Cookie finals run" sub="1 item - 3 slots - table pickup" right={<MiniButton tone="quiet" onClick={launch}>Use template</MiniButton>} />
        {launched && (
          <p className="mt-2 rounded-xl bg-primary/15 px-3 py-2 text-xs text-ink">
            Items, prices, pickup spot, and slots all copied. Set a new deadline and post.
          </p>
        )}
      </Screen>
      <TryIt done={launched}>
        {launched ? "Two clicks instead of re-typing a whole drop. Templates are private to your club." : "Tap Use template."}
      </TryIt>
    </>
  );
}

/* --------------------------------- 12 ---------------------------------- */

function EngageDemo() {
  const [replied, reply] = useLatch();
  return (
    <>
      <Screen label="Reviews and Q&A">
        <div className="rounded-xl border border-border bg-surface-raised p-2.5">
          <p className="text-xs font-bold text-ink">Alex K. - 4 stars</p>
          <p className="mt-0.5 text-xs text-ink-muted">Great value. Wish there were more flavors.</p>
          {replied ? (
            <p className="mt-2 rounded-lg bg-primary/10 p-2 text-xs text-ink">
              <span className="font-bold">{DEMO_CLUBS.testing} replied:</span> Thank you! More
              flavors on the next drop.
            </p>
          ) : (
            <MiniButton className="mt-2" tone="quiet" onClick={reply}>
              Reply
            </MiniButton>
          )}
        </div>
        <div className="mt-2 rounded-xl border border-accent/40 bg-accent/10 p-2.5">
          <p className="text-xs font-bold text-ink">Unanswered question</p>
          <p className="mt-0.5 text-xs text-ink-muted">Is the 12-box nut-free?</p>
          <MiniButton className="mt-2" tone="quiet" onClick={reply}>
            Answer publicly
          </MiniButton>
        </div>
      </Screen>
      <TryIt done={replied}>
        {replied ? "Answers are public, so one reply saves you the same question ten times." : "Reply to the review or the question."}
      </TryIt>
      <Note>
        Unanswered questions show a badge on your dashboard. Clearing them is the cheapest thing
        you can do for your rating.
      </Note>
    </>
  );
}

/* --------------------------------- 13 ---------------------------------- */

function WrapDemo() {
  return (
    <>
      <Screen label="Your run of show">
        <div className="space-y-2">
          {[
            "Post the drop (or relaunch a template)",
            "Wait for brand approval if it is a new brand",
            "Orders come in - students pay you on Venmo or Zelle",
            "Verify each payment; passes go out automatically",
            "At pickup, scan passes or mark people off the roster",
            "Read analytics, save the winner as a template, run it again",
          ].map((line, index) => (
            <div key={line} className="flex items-start gap-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/25 text-[10px] font-extrabold text-ink">
                {index + 1}
              </span>
              <span className="text-sm text-ink">{line}</span>
            </div>
          ))}
        </div>
      </Screen>
      <Note>
        Replay this any time from your dashboard, from account settings, or from the About
        Cornell Craves page. Nothing you tapped here was saved - it was all sample data.
      </Note>
    </>
  );
}

/* ------------------------------- The tour ------------------------------- */

export const CLUB_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Running a fundraiser here",
    blurb:
      "A drop is a storefront, not a group chat. This is the whole toolset, in the order you will use it.",
    Demo: WelcomeDemo,
  },
  {
    id: "approval",
    title: "Registration and approval",
    blurb: "Every club is checked by an admin before it can post anything.",
    Demo: ApprovalDemo,
  },
  {
    id: "post",
    title: "Post a drop",
    blurb: "Brand, title, deadline, items, pickup. It goes live on the student feed immediately.",
    Demo: PostDropDemo,
  },
  {
    id: "brand",
    title: "Why a drop can be held",
    blurb: "New brands need an admin to clear them once. After that, they are yours.",
    Demo: BrandGateDemo,
  },
  {
    id: "slots",
    title: "Pickup spot and time slots",
    blurb: "Capacity per window is how you avoid forty people at once and nobody after.",
    Demo: SlotsDemo,
  },
  {
    id: "orders",
    title: "Verify payments",
    blurb: "The most important screen you will use. Read the warning under it.",
    Demo: OrdersDemo,
  },
  {
    id: "scan",
    title: "Scan passes at pickup",
    blurb: "Three outcomes, all of which you will see on a busy table.",
    Demo: ScannerDemo,
  },
  {
    id: "reservations",
    title: "Work the pickup roster",
    blurb: "Who is coming, in which window, and who has already collected.",
    Demo: ReservationsDemo,
  },
  {
    id: "split",
    title: "Split orders",
    blurb: "Optional, off by default. Turn it on and a big box stops being a barrier.",
    Demo: SplitClubDemo,
  },
  {
    id: "analytics",
    title: "Read your numbers",
    blurb: "What sold, what did not, and when people actually order.",
    Demo: AnalyticsDemo,
  },
  {
    id: "templates",
    title: "Relaunch a winner",
    blurb: "The drop that worked should not cost you the same setup time twice.",
    Demo: TemplatesDemo,
  },
  {
    id: "engage",
    title: "Reviews and Q&A",
    blurb: "Your rating rides on the feed next to your name. Reply to it.",
    Demo: EngageDemo,
  },
  {
    id: "wrap",
    title: "The full loop",
    blurb: "Start to finish, every drop follows the same six beats.",
    Demo: WrapDemo,
  },
];
