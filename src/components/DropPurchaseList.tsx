import { useRef, useState } from "react";
import { Check, ClipboardList, Copy, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { demandToText, type DropDemand } from "@/lib/orders";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";

type Scope = "all" | "confirmed";

const SCOPES: { id: Scope; label: string; hint: string }[] = [
  {
    id: "all",
    label: "All orders",
    hint: "Counts every order on this drop, including ones you have not verified yet.",
  },
  {
    id: "confirmed",
    label: "Verified only",
    hint: "Counts only orders whose payment you already verified.",
  },
];

/** Copy to clipboard with a graceful fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * "What to buy" for one drop: how many of each item students actually ordered,
 * so the club can walk into the restaurant with an exact count instead of
 * adding up order cards by hand.
 *
 * Always reflects the whole drop, never the status filter above it — a filtered
 * shopping list is a wrong shopping list. Split orders count as one physical
 * item each, however many people are sharing it.
 */
export function DropPurchaseList({
  title,
  demand,
  defaultOpen = false,
}: {
  title: string;
  demand: DropDemand;
  defaultOpen?: boolean;
}) {
  const [scope, setScope] = useState<Scope>("all");
  const [open, setOpen] = useState(defaultOpen);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLElement>(null);

  /** Print this card alone: the club carries it to the counter, and the rest of
   *  the orders dashboard on paper is just noise. */
  const handlePrint = () => {
    const card = cardRef.current;
    if (!card) return;
    card.setAttribute("data-print-target", "");
    document.body.setAttribute("data-print", "purchase-list");
    const cleanup = () => {
      card.removeAttribute("data-print-target");
      document.body.removeAttribute("data-print");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
    // Safari never fires afterprint from a synchronous print(); the listener
    // above wins where it exists and this is the belt for where it does not.
    window.setTimeout(cleanup, 1000);
  };

  const qtyOf = (row: DropDemand["rows"][number]) =>
    scope === "confirmed" ? row.confirmed : row.total;
  const rows = demand.rows.filter((row) => qtyOf(row) > 0);
  const totalUnits = scope === "confirmed" ? demand.confirmedUnits : demand.totalUnits;
  const money = scope === "confirmed" ? demand.confirmedRevenue : demand.confirmedRevenue + demand.pendingRevenue;
  const activeScope = SCOPES.find((entry) => entry.id === scope)!;

  const handleCopy = async () => {
    const ok = await copyText(demandToText(title, demand, scope));
    if (!ok) {
      toast.error("Could not copy. Select the list and copy it manually.");
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
    toast.success("Purchase list copied.");
  };

  return (
    <section ref={cardRef} className="rounded-2xl border border-primary/40 bg-primary/[0.07]">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left sm:px-4"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/30 text-ink">
          <ClipboardList className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          {/* On screen the drop's name is already the section heading right
              above; on paper that heading is gone, so the printout carries it. */}
          <span className="hidden text-sm font-bold print:block">{title}</span>
          <span className="block text-sm font-bold">What to buy</span>
          <span className="block text-xs text-ink-muted">
            {demand.totalUnits} {demand.totalUnits === 1 ? "item" : "items"} across{" "}
            {demand.rows.length} {demand.rows.length === 1 ? "kind" : "kinds"}
            {demand.pendingUnits > 0 && `, ${demand.pendingUnits} not verified yet`}
          </span>
        </span>
        <span data-print-hide className="shrink-0 text-xs font-semibold text-ink-muted">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
          <div
            data-print-hide
            className="flex flex-wrap gap-1 rounded-full border border-border bg-surface-raised p-1"
            role="radiogroup"
            aria-label="What counts toward the purchase list"
          >
            {SCOPES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={scope === entry.id}
                onClick={() => setScope(entry.id)}
                className={cn(
                  "flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                  scope === entry.id
                    ? "bg-ink text-surface-raised"
                    : "text-ink-muted hover-fine:text-ink",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-muted">{activeScope.hint}</p>

          {rows.length === 0 ? (
            <p className="mt-3 rounded-xl bg-surface-raised px-3 py-3 text-sm text-ink-muted">
              {scope === "confirmed"
                ? "Nothing verified yet on this drop. Verify a payment and it lands here."
                : "No items ordered on this drop yet."}
            </p>
          ) : (
            <>
              <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-surface-raised">
                {rows.map((row) => (
                  <li
                    key={row.name}
                    className="flex items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0"
                  >
                    {/* The number leads: it is the one thing being read off at
                        the counter. Tabular figures keep the column straight. */}
                    <span className="w-12 shrink-0 text-right font-mono text-xl font-extrabold tabular-nums sm:w-14 sm:text-2xl">
                      {qtyOf(row)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-semibold">{row.name}</span>
                      {scope === "all" && row.pending > 0 && (
                        <span className="block text-xs text-ink-muted">
                          {row.confirmed} verified
                          {" · "}
                          <span className="text-accent">{row.pending} awaiting payment</span>
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Figure label="Items to buy" value={String(totalUnits)} />
                <Figure label="Distinct items" value={String(rows.length)} />
                <Figure
                  label="Orders"
                  value={String(demand.orderCount + demand.splitCount)}
                  sub={demand.splitCount > 0 ? `incl. ${demand.splitCount} split` : undefined}
                />
                <Figure
                  label={scope === "confirmed" ? "Collected" : "Order value"}
                  value={formatPrice(money)}
                />
              </dl>

              <div data-print-hide className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopy()}>
                  {copied ? (
                    <Check className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                  {copied ? "Copied" : "Copy list"}
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={handlePrint}>
                  <Printer className="size-3.5" aria-hidden="true" />
                  Print
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-raised px-3 py-2">
      <dt className="truncate text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-base font-extrabold tabular-nums">{value}</dd>
      {sub && <dd className="text-[11px] text-ink-muted">{sub}</dd>}
    </div>
  );
}
