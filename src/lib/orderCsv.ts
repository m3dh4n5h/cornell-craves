import { csvEscape } from "@/lib/csv";
import type { GroupDetails, Order } from "@/types/database";

/**
 * The club's orders export.
 *
 * The sheet has to answer two different questions without either one corrupting
 * the other:
 *
 *   1. "Who owes me money, and who has paid?"  -> sum the amount columns
 *   2. "How many boxes do I buy?"              -> sum the per-item columns
 *
 * Split orders are what make that hard. A split group is several students each
 * paying a share of ONE physical box, so counting the box on every member's row
 * would inflate the purchase count, and counting the group's full price
 * alongside the members' shares would double-count the money. The export
 * therefore emits three kinds of row, tagged in `line_kind`:
 *
 *   order        one solo order: its money AND its boxes
 *   split_box    the one box a group buys: boxes only, no money
 *   split_share  one member's share: money only, no boxes
 *
 * With that split, both `amount_due` and `amount_paid` sum to real totals and
 * the item columns sum to the real number of boxes to buy. `group_ref` ties a
 * box row to its share rows. `group_item_price` is reference only - it is the
 * same money as that group's shares, so it deliberately sits outside the two
 * summable amount columns.
 */

type OrderRowish = Pick<
  Order,
  | "id"
  | "listing_id"
  | "orderer_name"
  | "orderer_email"
  | "orderer_netid"
  | "items_json"
  | "total"
  | "payment_method"
  | "payment_details_json"
  | "payment_verified"
  | "status"
  | "proxy_name"
  | "picked_up_by_name"
  | "picked_up_by_email"
  | "picked_up_at"
  | "recommended_by"
  | "created_at"
>;

/** Money as a bare number: a `$` prefix turns the column into text in Sheets. */
function money(value: number): string {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

/** Enough of a uuid to link a box row to its shares without dominating the row. */
function groupRef(id: string): string {
  return id.slice(0, 8);
}

const COLUMNS = [
  "line_kind",
  "listing",
  "name",
  "email",
  "netid",
  "group_ref",
  "group_item",
  "group_item_price",
  "split_ways",
  "share_position",
  "units_for_this_person",
  "amount_due",
  "amount_paid",
  "payment_status",
  "payment_method",
  "payment_details",
  "pickup_status",
  "proxy_name",
  "picked_up_by",
  "ordered_at",
  "picked_up_at",
  "recommended_by",
] as const;

/** Group states, spelled out and prefixed so a box row never reads like a
 *  person's payment state. */
const GROUP_STATUS_CSV: Record<string, string> = {
  filling: "group_filling",
  full: "group_full_awaiting_close",
  payment_in_progress: "group_collecting_payment",
  reactivated: "group_collecting_payment",
  paid: "group_fully_paid",
  canceled: "group_canceled",
};

type Column = (typeof COLUMNS)[number];
type Cells = Partial<Record<Column, string>>;

/** One emitted line: the fixed columns plus this row's per-item box counts. */
interface Line {
  cells: Cells;
  /** Item name -> boxes. Empty for split_share rows, which carry no boxes. */
  boxes: Map<string, number>;
}

function paymentDetails(details: { venmo?: string; zelle?: string }): string {
  return [
    details.venmo ? `venmo @${details.venmo.replace(/^@/, "")}` : "",
    details.zelle ? `zelle ${details.zelle}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function orderLine(order: OrderRowish, listingTitle: string): Line {
  const cancelled = order.status === "cancelled";
  const boxes = new Map<string, number>();
  if (!cancelled) {
    for (const item of order.items_json ?? []) {
      boxes.set(item.name, (boxes.get(item.name) ?? 0) + Number(item.qty));
    }
  }
  return {
    cells: {
      line_kind: "order",
      listing: listingTitle,
      name: order.orderer_name,
      email: order.orderer_email,
      netid: order.orderer_netid ?? "",
      amount_due: cancelled ? "0.00" : money(Number(order.total)),
      amount_paid: order.payment_verified && !cancelled ? money(Number(order.total)) : "0.00",
      payment_status: cancelled
        ? "cancelled"
        : order.payment_verified
          ? "verified"
          : "awaiting_verification",
      payment_method: order.payment_method,
      payment_details: paymentDetails(order.payment_details_json),
      pickup_status: cancelled
        ? "cancelled"
        : order.picked_up_at
          ? "picked_up"
          : order.payment_verified
            ? "qr_sent"
            : "no_qr_yet",
      proxy_name: order.proxy_name ?? "",
      picked_up_by: order.picked_up_by_name
        ? `${order.picked_up_by_name} (${order.picked_up_by_email ?? ""})`
        : "",
      ordered_at: order.created_at,
      picked_up_at: order.picked_up_at ?? "",
      recommended_by: order.recommended_by ?? "",
    },
    boxes,
  };
}

/** The single box a group is buying. Carries the boxes; carries no money. */
function splitBoxLine(group: GroupDetails, listingTitle: string): Line {
  const canceled = group.status === "canceled";
  return {
    cells: {
      line_kind: "split_box",
      listing: listingTitle,
      name: `Split group — ${group.item_name}`,
      group_ref: groupRef(group.id),
      group_item: group.item_name,
      group_item_price: money(Number(group.item_price)),
      split_ways: String(group.total_people),
      // Both amount columns stay at zero on purpose. The box's cost is the same
      // money as the shares below it, so charging it here too would double it
      // in any sum over the sheet; `group_item_price` carries it for reference.
      amount_due: "0.00",
      amount_paid: "0.00",
      payment_status: GROUP_STATUS_CSV[group.status] ?? group.status,
      ordered_at: group.created_at,
      // Pre-048 groups carry a single creator-set recommender at the group
      // level. It belongs here, not smeared across members who never picked one.
      recommended_by: group.recommended_by ?? "",
    },
    // A canceled group is not bought.
    boxes: canceled ? new Map() : new Map([[group.item_name, 1]]),
  };
}

/** One member's share. Carries the money; carries no boxes. */
function splitShareLine(
  group: GroupDetails,
  member: GroupDetails["members"][number],
  index: number,
  listingTitle: string,
): Line {
  const paid = member.status === "paid";
  const canceled = group.status === "canceled";
  const unitsPerPerson =
    group.units_per_person ??
    Math.floor(Number(group.item_quantity) / Math.max(group.total_people, 1));
  const handle = member.payment_handle?.trim() ?? "";
  return {
    cells: {
      line_kind: "split_share",
      listing: listingTitle,
      name: member.name,
      // Present since migration 053, which adds contact details to
      // get_club_groups only. Older payloads (or a member who never filled in a
      // NetID) fall back to blank rather than inventing a value.
      email: member.email ?? "",
      netid: member.netid ?? "",
      group_ref: groupRef(group.id),
      group_item: group.item_name,
      group_item_price: money(Number(group.item_price)),
      split_ways: String(group.total_people),
      share_position: `${index + 1} of ${group.total_people}`,
      units_for_this_person: String(unitsPerPerson),
      // A canceled group collects nothing further, so nobody still owes. Money
      // that already came in stays in amount_paid - it is real money the club
      // received - and `paid_refund_or_reactivate` flags the two ways that ends:
      // refund the member, or reopen the group, in which case their share stays
      // verified and they are not asked again (reactivate_group leaves a 'paid'
      // row alone). Saying "refund owed" here would name only one of them.
      amount_due: canceled ? "0.00" : money(Number(group.share_amount)),
      amount_paid: paid ? money(Number(group.share_amount)) : "0.00",
      payment_status: canceled
        ? paid
          ? "paid_refund_or_reactivate"
          : "group_canceled"
        : paid
          ? "paid"
          : member.status === "pending_payment"
            ? "owes_payment"
            : member.status === "invited"
              ? "invited"
              : "in_group_not_due_yet",
      payment_method: member.payment_method ?? "",
      payment_details: handle
        ? member.payment_method === "venmo"
          ? `venmo @${handle.replace(/^@/, "")}`
          : `${member.payment_method ?? "handle"} ${handle}`
        : "",
      pickup_status: member.scanned_at
        ? "picked_up"
        : canceled
          ? "cancelled"
          : group.status === "paid"
            ? "qr_sent"
            : "no_qr_yet",
      // Passes are group-gated, so the member who scans is the member who holds.
      picked_up_by: member.scanned_at ? member.name : "",
      // The group's creation time. The RPC does not expose when each member
      // joined, and this is the closest honest stamp for the share.
      ordered_at: group.created_at,
      picked_up_at: member.scanned_at ?? "",
      // This member's own pick only. Falling back to the group-level legacy
      // field would credit a recommender to members who never named one, and
      // would disagree with the leaderboard on the analytics page.
      recommended_by: member.recommended_by ?? "",
    },
    boxes: new Map(),
  };
}

export interface OrdersCsvResult {
  csv: string;
  /** People rows: solo orders + split shares. What the club counts as "orders". */
  peopleCount: number;
  splitShareCount: number;
}

export function buildOrdersCsv({
  listings,
  orders,
  groups,
  scopeListingId,
}: {
  listings: { id: string; title: string }[];
  orders: OrderRowish[];
  groups: GroupDetails[];
  scopeListingId: string | null;
}): OrdersCsvResult {
  const inScope = (listingId: string) => !scopeListingId || listingId === scopeListingId;
  const titleOf = (id: string) => listings.find((listing) => listing.id === id)?.title ?? "";

  const scopedOrders = orders.filter((order) => inScope(order.listing_id));
  const scopedGroups = groups.filter((group) => inScope(group.listing_id));

  // Group everything under its listing so an all-fundraisers export reads as
  // one drop after another instead of an interleaved jumble, and so a group's
  // box row is immediately followed by the shares that pay for it.
  const listingOrder = [
    ...listings.map((listing) => listing.id).filter(inScope),
    // Defensive: anything whose listing is no longer in the club's list still
    // gets exported rather than silently dropped.
    ...new Set(
      [...scopedOrders.map((order) => order.listing_id), ...scopedGroups.map((g) => g.listing_id)].filter(
        (id) => !listings.some((listing) => listing.id === id),
      ),
    ),
  ];

  const lines: Line[] = [];
  for (const listingId of listingOrder) {
    const title = titleOf(listingId);
    for (const order of scopedOrders.filter((o) => o.listing_id === listingId)) {
      lines.push(orderLine(order, title));
    }
    for (const group of scopedGroups.filter((g) => g.listing_id === listingId)) {
      lines.push(splitBoxLine(group, title));
      group.members.forEach((member, index) => {
        lines.push(splitShareLine(group, member, index, title));
      });
    }
  }

  // One column per distinct item across everything exported, including the box
  // names on split groups so a split-only drop still gets its item column.
  const itemNames = [...new Set(lines.flatMap((line) => [...line.boxes.keys()]))].sort((a, b) =>
    a.localeCompare(b),
  );

  const header = [...COLUMNS, ...itemNames].map(csvEscape).join(",");
  const body = lines.map((line) =>
    [
      ...COLUMNS.map((column) => csvEscape(line.cells[column] ?? "")),
      ...itemNames.map((name) => String(line.boxes.get(name) ?? 0)),
    ].join(","),
  );

  const splitShareCount = lines.filter((line) => line.cells.line_kind === "split_share").length;
  return {
    csv: [header, ...body].join("\n"),
    peopleCount: scopedOrders.length + splitShareCount,
    splitShareCount,
  };
}
