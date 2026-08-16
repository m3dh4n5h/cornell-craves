import type { GroupMemberStatus, GroupStatus } from "@/types/database";

type BadgeVariant = "default" | "urgent" | "neutral" | "success";

export const GROUP_STATUS_META: Record<GroupStatus, { label: string; variant: BadgeVariant }> = {
  filling: { label: "Filling up", variant: "default" },
  // A full group owes nothing yet: payment opens only when the club closes orders.
  full: { label: "Full, awaiting order close", variant: "success" },
  payment_in_progress: { label: "Payment open, pay now", variant: "default" },
  paid: { label: "All paid", variant: "success" },
  canceled: { label: "Canceled", variant: "urgent" },
  reactivated: { label: "Reopened, pay now", variant: "default" },
};

export const MEMBER_STATUS_META: Record<GroupMemberStatus, { label: string; variant: BadgeVariant }> = {
  invited: { label: "Invited", variant: "neutral" },
  accepted: { label: "In", variant: "default" },
  pending_payment: { label: "Owes payment", variant: "default" },
  paid: { label: "Paid", variant: "success" },
};

/** Group states where members can or should be paying (payment window open). */
export const PAYABLE_GROUP_STATUSES: GroupStatus[] = ["payment_in_progress", "reactivated"];

/**
 * Rules version. Bump this string whenever SPLIT_RULES or CLUB_SPLIT_RULES
 * changes: students re-accept on their next split, and clubs re-accept the next
 * time they enable the feature (migration 044 stores the accepted version).
 */
export const SPLIT_RULES_VERSION = "2026-08-17.v2";

/** What a STUDENT agrees to when starting or joining a split. */
export const SPLIT_RULES: string[] = [
  "You are joining a group to split one item. You only pay once the group is full AND the club closes ordering — not before. Watch your Orders page and email for the status.",
  "Once ordering closes on a full group, you have 24 hours (Eastern time) to pay your share directly to the club over Venmo or Zelle. Cornell Craves never handles the money.",
  "If the group does not fill by the order deadline, or anyone does not pay within the 24-hour window, the whole group is canceled. Nobody who has not yet paid is charged. If you already paid your share before the cancellation, the club refunds you directly — Cornell Craves never held that money. The club may extend a deadline at its discretion.",
  "Your QR pickup pass is released only after every member of the group has paid and the club has verified everyone.",
  "Prices, availability, pickup times and locations are set by the club, not Cornell Craves. Any dispute, refund, allergen, or food-safety question is between you and the club.",
  "Cornell Craves is a discovery tool that connects students and clubs. It is provided \"as is,\" makes no guarantee that a group fills or an order is fulfilled, and is not liable for payments, no-shows, or the food itself.",
];

/** What a CLUB agrees to when turning the split feature on. */
export const CLUB_SPLIT_RULES: string[] = [
  "Split orders let students share one item and pay their share individually. A group must fill by your drop's order deadline or it cancels automatically; you can extend the order or payment deadline per group or for a whole drop.",
  "When you close ordering (or the order deadline passes), each full group's members get 24 hours (Eastern time) to pay. You verify each member; QR passes are emailed only after everyone in the group is verified.",
  "You collect all money directly via your Venmo or Zelle. Cornell Craves never touches funds and does not guarantee that groups fill or that students pay.",
  "You are responsible for fulfilling verified orders, pickup logistics, allergens, and food safety, and for handling refunds or disputes with your buyers. If a group cancels after you already verified someone's share, refunding that student is your responsibility — Cornell Craves never held their money.",
  "You will honor the deadlines and rules shown to students, and you accept that Cornell Craves is provided \"as is\" with no liability for payments, no-shows, or the food itself.",
];

export interface DeadlineInfo {
  label: string;
  /** normal > 6h, soon <= 6h (saffron), urgent <= 2h (chili). */
  tone: "normal" | "soon" | "urgent";
  expired: boolean;
}

export function deadlineInfo(deadline: string): DeadlineInfo {
  const ms = new Date(deadline).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) {
    return { label: "Deadline passed", tone: "urgent", expired: true };
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const label =
    days > 0
      ? `${days}d ${hours}h left`
      : hours > 0
        ? `${hours}h ${minutes}m left`
        : `${minutes}m left`;
  const tone = ms <= 2 * 3_600_000 ? "urgent" : ms <= 6 * 3_600_000 ? "soon" : "normal";
  return { label, tone, expired: false };
}

export function inviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}
