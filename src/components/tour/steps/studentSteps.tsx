import { useState } from "react";
import { BellRing, Copy, Link2, MapPin, ShieldCheck, Ticket } from "lucide-react";
import type { TourStep } from "@/components/tour/TourShell";
import {
  Chip,
  DEMO_BRANDS,
  DEMO_CLUBS,
  DEMO_DROPS,
  DEMO_PEOPLE,
  DEMO_SPOTS,
  DropCard,
  FakeQR,
  MiniButton,
  Note,
  Row,
  Screen,
  StarPicker,
  StarRow,
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
      <Screen label="What you get">
        <div className="space-y-2">
          {[
            { title: "One feed for every drop", body: "Clubs post food; you see it all in one place." },
            { title: "Order in a few taps", body: "Pick items, pick a pickup time, done." },
            { title: "Split with friends", body: "Share a big box, everyone pays their own share." },
            { title: "Show a QR pass", body: "Scanned at pickup. No list to find your name on." },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border border-border bg-surface-raised p-2.5">
              <p className="text-sm font-bold text-ink">{item.title}</p>
              <p className="text-xs text-ink-muted">{item.body}</p>
            </div>
          ))}
        </div>
      </Screen>
      <Note tone="warn">
        Money never moves through Cornell Craves. You pay the club directly on Venmo or Zelle,
        and the club confirms it. We are a place to find food and order it, not a payment
        processor.
      </Note>
    </>
  );
}

/* ---------------------------------- 2 ---------------------------------- */

function FeedDemo() {
  const [brand, setBrand] = useState<string | null>(null);
  const [tapped, tap] = useLatch();
  const shown = brand ? DEMO_DROPS.filter((drop) => drop.brand === brand) : DEMO_DROPS;

  return (
    <>
      <Screen label="Feed">
        <div className="flex flex-wrap gap-1.5">
          {DEMO_BRANDS.slice(0, 3).map((option) => (
            <Chip
              key={option}
              active={brand === option}
              onClick={() => {
                setBrand((current) => (current === option ? null : option));
                tap();
              }}
            >
              {option}
            </Chip>
          ))}
          {brand && (
            <Chip onClick={() => setBrand(null)}>Clear</Chip>
          )}
        </div>
        <div className="mt-3 space-y-2">
          {shown.map((drop) => (
            <DropCard key={drop.id} drop={drop} />
          ))}
          {shown.length === 0 && (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-ink-muted">
              No live drops for that brand right now.
            </p>
          )}
        </div>
      </Screen>
      <TryIt done={tapped}>
        {tapped ? "That is the whole filter. Tap it again to clear." : "Tap a brand chip to filter the feed."}
      </TryIt>
      <Note>
        Each card carries a live countdown, the star rating from real past orders, and dietary
        badges. When the countdown hits zero, ordering closes and the drop leaves the feed.
      </Note>
    </>
  );
}

/* ---------------------------------- 3 ---------------------------------- */

const LISTING_TABS = ["Items", "Reviews", "Q&A", "Pickup"] as const;

function ListingDemo() {
  const [tab, setTab] = useState<(typeof LISTING_TABS)[number]>("Items");
  const [seen, see] = useLatch();

  return (
    <>
      <Screen label={`${DEMO_DROPS[0].title} - ${DEMO_CLUBS.testing}`}>
        <Tabs
          tabs={LISTING_TABS}
          value={tab}
          onChange={(next) => {
            setTab(next);
            if (next !== "Items") see();
          }}
        />
        <div className="mt-2 min-h-[8rem]">
          {tab === "Items" && (
            <div>
              <Row left="Glazed dozen" sub="Vegetarian - contains wheat, dairy" right={<span className="text-sm font-bold">$14.99</span>} />
              <Row left="Chocolate iced dozen" sub="Vegetarian - contains wheat, dairy, soy" right={<span className="text-sm font-bold">$16.99</span>} />
              <Row left="Single glazed" sub="Contains wheat, dairy" right={<span className="text-sm font-bold">$1.75</span>} />
            </div>
          )}
          {tab === "Reviews" && (
            <div className="space-y-2">
              {[
                { who: "Sam P.", stars: 5, text: "Showed up on time, box was still warm." },
                { who: "Alex K.", stars: 4, text: "Great value. Wish there were more flavors." },
              ].map((review) => (
                <div key={review.who} className="rounded-xl border border-border bg-surface-raised p-2.5">
                  <div className="flex items-center gap-2">
                    <StarRow value={review.stars} />
                    <span className="text-xs font-bold text-ink">{review.who}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{review.text}</p>
                </div>
              ))}
              <p className="rounded-xl bg-primary/10 p-2.5 text-xs text-ink">
                <span className="font-bold">{DEMO_CLUBS.testing} replied:</span> Thank you! More
                flavors next drop.
              </p>
            </div>
          )}
          {tab === "Q&A" && (
            <div className="space-y-2">
              <div className="rounded-xl border border-border bg-surface-raised p-2.5">
                <p className="text-xs font-bold text-ink">Can someone else pick up for me?</p>
                <p className="mt-1 text-xs text-ink-muted">
                  <span className="font-semibold text-ink">Answer:</span> Yes, add their name as
                  your proxy on the order form.
                </p>
              </div>
              <MiniButton tone="quiet">Ask a question</MiniButton>
            </div>
          )}
          {tab === "Pickup" && (
            <div>
              <Row left={DEMO_SPOTS[0]} sub="Walk-up table" right={<span className="text-xs text-ink-muted">Sat</span>} />
              <Row left="12:00 - 12:30" sub="6 of 20 spots taken" />
              <Row left="12:30 - 1:00" sub="19 of 20 spots taken" />
            </div>
          )}
        </div>
      </Screen>
      <TryIt done={seen}>
        {seen ? "Reviews and Q&A are public, so questions get answered once for everyone." : "Tap through the four tabs."}
      </TryIt>
    </>
  );
}

/* ---------------------------------- 4 ---------------------------------- */

const ORDER_ITEMS = [
  { name: "Glazed dozen", price: 14.99 },
  { name: "Single glazed", price: 1.75 },
];

function OrderDemo() {
  const [qty, setQty] = useState([0, 0]);
  const [touched, touch] = useLatch();
  const total = ORDER_ITEMS.reduce((sum, item, index) => sum + item.price * qty[index], 0);

  return (
    <>
      <Screen label="Order form">
        {ORDER_ITEMS.map((item, index) => (
          <div
            key={item.name}
            className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{item.name}</p>
              <p className="text-xs text-ink-muted">${item.price.toFixed(2)}</p>
            </div>
            <Stepper
              label={item.name}
              value={qty[index]}
              onChange={(next) => {
                setQty((current) => current.map((value, i) => (i === index ? next : value)));
                touch();
              }}
            />
          </div>
        ))}
        <div className="mt-3 flex items-center justify-between rounded-xl bg-primary/15 px-3 py-2">
          <span className="text-sm font-bold text-ink">Total</span>
          <span className="font-display text-lg font-extrabold tabular-nums text-ink">
            ${total.toFixed(2)}
          </span>
        </div>
        <div className="mt-3 space-y-1.5 text-xs text-ink-muted">
          <Row left="Paying with" sub="Pre-filled from your account" right={<span className="text-xs font-bold text-ink">@{DEMO_PEOPLE.you.venmo}</span>} />
          <Row left="Someone else picking up?" sub="Add a proxy name and they can collect it" right={<span className="text-xs text-ink-muted">Optional</span>} />
        </div>
      </Screen>
      <TryIt done={touched}>
        {touched ? "The total is priced by the server, not the browser, so it cannot be tampered with." : "Use + to add a dozen and watch the total."}
      </TryIt>
    </>
  );
}

/* ---------------------------------- 5 ---------------------------------- */

const SLOTS = [
  { time: "12:00 - 12:30", left: 14, spot: DEMO_SPOTS[0] },
  { time: "12:30 - 1:00", left: 1, spot: DEMO_SPOTS[0] },
  { time: "1:00 - 1:30", left: 0, spot: DEMO_SPOTS[0] },
];

function PickupDemo() {
  const [picked, setPicked] = useState<string | null>(null);
  const [chose, choose] = useLatch();

  return (
    <>
      <Screen label="Pick a time slot">
        <div className="space-y-2">
          {SLOTS.map((slot) => {
            const full = slot.left === 0;
            return (
              <button
                key={slot.time}
                type="button"
                disabled={full}
                onClick={() => {
                  setPicked(slot.time);
                  choose();
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50",
                  picked === slot.time
                    ? "border-primary bg-primary/15"
                    : "border-border bg-surface-raised hover-fine:border-primary",
                )}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-bold text-ink">{slot.time}</span>
                  <span className="block text-xs text-ink-muted">{slot.spot}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
                    full ? "bg-border text-ink-muted" : slot.left <= 2 ? "bg-accent/15 text-accent" : "bg-tag-green/60 text-ink",
                  )}
                >
                  {full ? "Full" : `${slot.left} left`}
                </span>
              </button>
            );
          })}
        </div>
      </Screen>
      <TryIt done={chose}>
        {chose ? `Locked to ${picked}. Slots close the moment they fill, so nobody queues for nothing.` : "Pick a slot. The full one is not selectable."}
      </TryIt>
    </>
  );
}

/* ---------------------------------- 6 ---------------------------------- */

function PaymentDemo() {
  const [paid, pay] = useLatch();
  return (
    <>
      <Screen label="After you place the order">
        <div className="rounded-xl border border-border bg-surface-raised p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Pay the club</p>
          <p className="mt-1 font-display text-xl font-extrabold text-ink">$14.99</p>
          <p className="text-xs text-ink-muted">to {DEMO_CLUBS.testing}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <MiniButton onClick={pay}>Open Venmo</MiniButton>
            <MiniButton tone="quiet" onClick={pay}>
              <Copy className="size-3" aria-hidden="true" />
              Copy Zelle number
            </MiniButton>
          </div>
        </div>
        <div className="mt-3 space-y-1">
          <Row
            left="1. You pay the club"
            sub="Venmo deep link, or copy their Zelle number"
            right={<span className={cn("text-[10px] font-bold", paid ? "text-primary-dark" : "text-ink-muted")}>{paid ? "Done" : "You"}</span>}
          />
          <Row left="2. The club confirms it" sub="They check their own Venmo or Zelle" right={<span className="text-[10px] font-bold text-ink-muted">Club</span>} />
          <Row left="3. Your QR pass is emailed" sub="Automatically, the second they confirm" right={<span className="text-[10px] font-bold text-ink-muted">Auto</span>} />
        </div>
      </Screen>
      <TryIt done={paid}>
        {paid ? "Now it is the club's move. Your order sits in 'pending payment' until they confirm." : "Tap either payment button."}
      </TryIt>
      <Note tone="warn">
        Cornell Craves never holds, processes, or refunds money. If something goes wrong with a
        payment, it is between you and the club.
      </Note>
    </>
  );
}

/* ---------------------------------- 7 ---------------------------------- */

function SplitDemo() {
  const [on, setOn] = useState(false);
  const [people, setPeople] = useState(4);
  const [toggled, toggle] = useLatch();
  const share = (18.0 / people).toFixed(2);

  return (
    <>
      <Screen label="Split this order">
        <Toggle
          checked={on}
          onChange={(next) => {
            setOn(next);
            toggle();
          }}
          label="Split this order"
          hint="Share one box, everyone pays their own share"
        />
        {on && (
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2.5">
              <span className="text-sm font-semibold text-ink">People splitting</span>
              <Stepper label="person" value={people} max={4} onChange={(next) => setPeople(Math.max(2, next))} />
            </div>
            <div className="rounded-xl bg-primary/15 px-3 py-2 text-sm">
              <span className="font-bold text-ink">${share} each</span>
              <span className="text-ink-muted"> - $18.00 box, {people} ways, {12 / people} donuts per person</span>
            </div>
            <div className="rounded-xl border border-border bg-surface-raised p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-bold text-ink">
                <Link2 className="size-3.5" aria-hidden="true" />
                Invite link
              </p>
              <p className="mt-1 truncate rounded-lg bg-surface px-2 py-1 font-mono text-[10px] text-ink-muted">
                cornell-craves.example/invite/demo-token
              </p>
            </div>
            <div>
              {[
                { person: DEMO_PEOPLE.you.name, state: "Paid", tone: "ok" },
                { person: DEMO_PEOPLE.friend1.name, state: "Paid", tone: "ok" },
                { person: DEMO_PEOPLE.friend2.name, state: "5h 12m to pay", tone: "warn" },
                { person: "Open spot", state: "Waiting to join", tone: "muted" },
              ].slice(0, people).map((member) => (
                <Row
                  key={member.person}
                  left={member.person}
                  right={
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold",
                        member.tone === "ok" && "bg-tag-green/60 text-ink",
                        member.tone === "warn" && "bg-accent/15 text-accent",
                        member.tone === "muted" && "border border-dashed border-border text-ink-muted",
                      )}
                    >
                      {member.state}
                    </span>
                  }
                />
              ))}
            </div>
          </div>
        )}
      </Screen>
      <TryIt done={toggled}>
        {toggled ? "Everyone gets their own pass, so you do not have to meet up to collect." : "Turn on Split this order."}
      </TryIt>
      <Note>
        Once the group fills, everyone has 24 hours to pay. The timer turns orange under 6 hours
        and red under 2. Miss it and your spot is released to someone else. Solo? Choose a public
        group and you get matched into one automatically.
      </Note>
    </>
  );
}

/* ---------------------------------- 8 ---------------------------------- */

function PassDemo() {
  const [shown, show] = useLatch();
  return (
    <>
      <Screen label="Your pickup pass">
        {!shown ? (
          <div className="flex flex-col items-center py-6">
            <Ticket className="size-8 text-primary-dark" aria-hidden="true" />
            <p className="mt-2 text-center text-xs text-ink-muted">
              Emailed to you the moment the club confirms your payment.
            </p>
            <MiniButton className="mt-3" onClick={show}>
              Show my pass
            </MiniButton>
          </div>
        ) : (
          <div className="flex flex-col items-center py-2">
            <FakeQR />
            <p className="mt-3 text-xs text-ink-muted">Backup code</p>
            <p className="font-mono text-base font-bold tracking-[0.2em] text-ink">7K4P-2XQ9-M</p>
            <p className="mt-2 text-center text-xs text-ink-muted">
              {DEMO_DROPS[0].title} - {DEMO_SPOTS[0]} - Sat 12:00
            </p>
          </div>
        )}
      </Screen>
      <TryIt done={shown}>
        {shown ? "Single use. Once the club scans it, it is marked used." : "Tap Show my pass."}
      </TryIt>
      <Note>
        Cannot load the QR at the table? Read out the 10-character backup code instead - it does
        exactly the same job. Passes are signed by the server, so a screenshot someone forwarded
        will not check anyone else in.
      </Note>
    </>
  );
}

/* ---------------------------------- 9 ---------------------------------- */

function CravingsDemo() {
  const [subs, setSubs] = useState<string[]>([]);
  const [subbed, sub] = useLatch();

  return (
    <>
      <Screen label="Cravings">
        <p className="text-xs text-ink-muted">
          Turn on a brand and you get an email the second any club posts a drop for it.
        </p>
        <div className="mt-2">
          {DEMO_BRANDS.map((brand) => {
            const on = subs.includes(brand);
            return (
              <Row
                key={brand}
                left={brand}
                right={
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={`${on ? "Unsubscribe from" : "Subscribe to"} ${brand}`}
                    onClick={() => {
                      setSubs((current) =>
                        current.includes(brand)
                          ? current.filter((b) => b !== brand)
                          : [...current, brand],
                      );
                      sub();
                    }}
                    className={cn(
                      "flex size-8 items-center justify-center rounded-xl border transition-colors duration-150 active:scale-[0.95]",
                      on
                        ? "border-transparent bg-primary text-on-primary"
                        : "border-border bg-surface-raised text-ink-muted",
                    )}
                  >
                    <BellRing className="size-4" aria-hidden="true" fill={on ? "currentColor" : "none"} />
                  </button>
                }
              />
            );
          })}
        </div>
      </Screen>
      <TryIt done={subbed}>
        {subbed ? `Subscribed to ${subs.length} brand${subs.length === 1 ? "" : "s"}. Tap the bell again to stop.` : "Tap a bell to subscribe."}
      </TryIt>
    </>
  );
}

/* --------------------------------- 10 ---------------------------------- */

const PINS = [
  { id: "p1", top: "22%", left: "28%", spot: DEMO_SPOTS[0], drop: DEMO_DROPS[0] },
  { id: "p2", top: "58%", left: "62%", spot: DEMO_SPOTS[1], drop: DEMO_DROPS[1] },
  { id: "p3", top: "40%", left: "80%", spot: DEMO_SPOTS[2], drop: DEMO_DROPS[2] },
];

function MapDemo() {
  const [open, setOpen] = useState<string | null>(null);
  const [tapped, tap] = useLatch();
  const active = PINS.find((pin) => pin.id === open);

  return (
    <>
      <Screen label="Map">
        <div className="relative h-40 overflow-hidden rounded-xl border border-border bg-tag-green/25">
          {/* Decorative "paths" so the area reads as a map, not an empty box. */}
          <span className="absolute left-0 top-1/2 h-1 w-full -translate-y-1/2 bg-surface-raised/70" aria-hidden="true" />
          <span className="absolute left-1/2 top-0 h-full w-1 -translate-x-1/2 bg-surface-raised/70" aria-hidden="true" />
          {PINS.map((pin) => (
            <button
              key={pin.id}
              type="button"
              aria-label={`Pickup pin at ${pin.spot}`}
              style={{ top: pin.top, left: pin.left }}
              onClick={() => {
                setOpen(pin.id);
                tap();
              }}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-full p-1.5 shadow-md transition-transform duration-150 active:scale-90",
                open === pin.id ? "bg-ink text-surface-raised" : "bg-primary text-on-primary",
              )}
            >
              <MapPin className="size-4" aria-hidden="true" />
            </button>
          ))}
        </div>
        {active ? (
          <div className="mt-2">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">{active.spot}</p>
            <div className="mt-1.5">
              <DropCard drop={active.drop} compact />
            </div>
          </div>
        ) : (
          <p className="mt-2 text-center text-xs text-ink-muted">Tap a pin to see what is there.</p>
        )}
      </Screen>
      <TryIt done={tapped}>
        {tapped ? "Same drops as the feed, arranged by where you actually have to walk." : "Tap a pin."}
      </TryIt>
    </>
  );
}

/* --------------------------------- 11 ---------------------------------- */

function ReviewDemo() {
  const [stars, setStars] = useState(0);
  const [rated, rate] = useLatch();

  return (
    <>
      <Screen label="Write a review">
        <p className="text-xs text-ink-muted">{DEMO_DROPS[0].title} - {DEMO_CLUBS.testing}</p>
        <div className="mt-2">
          <StarPicker
            value={stars}
            onChange={(next) => {
              setStars(next);
              rate();
            }}
          />
        </div>
        <div className="mt-3 rounded-xl border border-border bg-surface-raised p-2.5 text-xs text-ink-muted">
          Tell other students what showed up, how it tasted, and whether pickup ran on time.
        </div>
        <MiniButton className="mt-3" disabled={stars === 0}>
          Post review
        </MiniButton>
      </Screen>
      <TryIt done={rated}>
        {rated ? "One review per person per drop, and it cannot be edited afterwards - so mean it." : "Pick a star rating."}
      </TryIt>
      <Note>
        You can only review a drop you actually ordered. Clubs can reply in public, which is how
        the ratings on the feed stay worth reading.
      </Note>
    </>
  );
}

/* --------------------------------- 12 ---------------------------------- */

const DIET = ["Vegan", "Vegetarian", "Gluten-free", "Nut-free", "Halal", "Dairy-free"];

function AccountDemo() {
  const [on, setOn] = useState<string[]>(["Vegetarian"]);
  const [changed, change] = useLatch();

  return (
    <>
      <Screen label="Account">
        <Row left="Cornell email" sub="From your Google account, not editable" right={<span className="text-xs text-ink-muted">Locked</span>} />
        <Row left="NetID" right={<span className="text-xs font-bold text-ink">{DEMO_PEOPLE.you.netid}</span>} />
        <Row left="Venmo" sub="Pre-fills every order form" right={<span className="text-xs font-bold text-ink">@{DEMO_PEOPLE.you.venmo}</span>} />
        <p className="mt-3 text-xs font-bold uppercase tracking-wide text-ink-muted">
          Dietary filters
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {DIET.map((tag) => (
            <Chip
              key={tag}
              active={on.includes(tag)}
              onClick={() => {
                setOn((current) =>
                  current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
                );
                change();
              }}
            >
              {tag}
            </Chip>
          ))}
        </div>
      </Screen>
      <TryIt done={changed}>
        {changed ? "Saved to your account and pre-applied every time you browse the feed or the map." : "Toggle a dietary filter."}
      </TryIt>
    </>
  );
}

/* --------------------------------- 13 ---------------------------------- */

function WrapDemo() {
  return (
    <>
      <Screen label="You are set">
        <div className="space-y-2">
          {[
            "Browse the Feed or the Map for live drops",
            "Set brand alerts under Cravings so you hear first",
            "Order solo, or split a box and share the invite link",
            "Pay the club on Venmo or Zelle, then wait for your pass",
            "Show the QR (or the 10-character code) at pickup",
            "Leave a review so the next person knows what to expect",
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
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          <ShieldCheck className="size-3.5" aria-hidden="true" />
          Replay this any time
        </span>
        <br />
        It lives on the About Cornell Craves page and in your account settings. Nothing you just
        tapped was saved - it was all sample data.
      </Note>
    </>
  );
}

/* ------------------------------- The tour ------------------------------- */

export const STUDENT_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "What Cornell Craves is",
    blurb:
      "Student clubs bring in food students actually want and sell it to raise money. You get one feed of everything happening on campus.",
    Demo: WelcomeDemo,
  },
  {
    id: "feed",
    title: "Find a drop",
    blurb:
      "The feed shows every live drop, newest first. Filter it down to the brand you came for.",
    Demo: FeedDemo,
  },
  {
    id: "listing",
    title: "Read the listing",
    blurb:
      "Every drop has four tabs. Items and Pickup tell you what and where; Reviews and Q&A tell you whether it is worth it.",
    Demo: ListingDemo,
  },
  {
    id: "order",
    title: "Build your order",
    blurb: "Steppers set quantities and the total updates live. Your saved payment handle fills itself in.",
    Demo: OrderDemo,
  },
  {
    id: "pickup",
    title: "Choose a pickup slot",
    blurb:
      "Slots are capacity-limited so the club knows how many people to expect in each window.",
    Demo: PickupDemo,
  },
  {
    id: "payment",
    title: "Pay the club directly",
    blurb: "This is the part people get wrong, so it is worth reading twice.",
    Demo: PaymentDemo,
  },
  {
    id: "split",
    title: "Split a box with friends",
    blurb:
      "A 12-box is cheaper per donut but too much for one person. Splitting fixes that without anyone fronting the money.",
    Demo: SplitDemo,
  },
  {
    id: "pass",
    title: "Your QR pickup pass",
    blurb: "No sign-up sheet, no shouting your name across a table.",
    Demo: PassDemo,
  },
  {
    id: "cravings",
    title: "Never miss a brand",
    blurb: "Good drops sell out in hours. Alerts mean you find out at minute one, not hour six.",
    Demo: CravingsDemo,
  },
  {
    id: "map",
    title: "See it on the map",
    blurb: "Sometimes the question is not what is available, it is what is available near you.",
    Demo: MapDemo,
  },
  {
    id: "reviews",
    title: "Reviews and Q&A",
    blurb: "The ratings on the feed come from people who actually ordered. Yours counts too.",
    Demo: ReviewDemo,
  },
  {
    id: "account",
    title: "Set it up once",
    blurb: "Two minutes in Account settings saves you typing on every order.",
    Demo: AccountDemo,
  },
  {
    id: "wrap",
    title: "That is the whole app",
    blurb: "Here is the loop, start to finish.",
    Demo: WrapDemo,
  },
];
