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
 * time they enable the feature (migration 044 stores the accepted version, and
 * AccountSettings re-prompts a club whose stored version has fallen behind).
 *
 * v3 (2026-08-21): the cancellation rule used to promise a refund flatly, which
 * contradicted what reactivate_group actually does - it leaves an already-paid
 * share alone, so that member is not refunded, they are carried into the
 * reopened group. Also adds the disclosures that were missing: who can see a
 * member's contact details and payment handle, that email is best-effort, and
 * that deadlines are processed by a scheduled job.
 *
 * Every line below is asserted against real behaviour by
 * supabase/tests/split-lifecycle.mjs. Keep it that way: a rule that overstates
 * what the system does is worse than no rule, because it is a representation
 * the project then fails to honour.
 */
export const SPLIT_RULES_VERSION = "2026-08-21.v3";

/** What a STUDENT agrees to when starting or joining a split. */
export const SPLIT_RULES: string[] = [
  "You are joining a group that buys ONE item together and divides it into equal shares. You are not buying your own separate item, and you cannot leave with more than your share.",
  "You owe nothing until the group is full AND ordering closes — either when the club's order deadline passes or when the club closes ordering early. Only then do you have 24 hours (Eastern time) to pay your share directly to the club by Venmo or Zelle. Cornell Craves never handles the money and has no way to charge you.",
  "Deadlines are applied by an automated job that runs on a schedule, so a status change can land shortly after the time shown. The club may also extend either deadline at its discretion.",
  "If the group does not fill by the order deadline, or anyone has not paid when the payment window closes, the entire group is canceled. You are never charged for a share you did not pay.",
  "If you already paid and the group is then canceled, one of two things happens. The club may reactivate the group — your payment still counts, you will not be asked to pay again, and you will be emailed the new deadline. Otherwise the cancellation stands and the club refunds you directly. Cornell Craves never held that money and cannot issue, guarantee, or compel a refund; you must settle it with the club.",
  "Your QR pickup pass is released only after the club has verified every member's share. Passes are personal and single-use — once one is scanned it cannot be used again — so do not share, post, or forward yours.",
  "We email you at each step as a courtesy. Email can be delayed, filtered as spam, or fail to send, and delivery is not guaranteed. Deadlines run whether or not a message reaches you, so treat your Orders page as the authoritative status and check it.",
  "The club running the drop can see your name, Cornell email, NetID, and the payment handle you enter, so it can match your payment and hand you your order. Other members of your group can see your first name, last initial, and payment handle. Do not enter anything you are not willing to share with them.",
  "Prices, quantities, availability, pickup times and locations, allergen and dietary labels, and fulfillment are set by the club, not by Cornell Craves, and are not verified by us. Any dispute, refund, allergen, or food-safety question is between you and the club.",
  "Cornell Craves is a free student-run discovery tool. It is not a seller, food vendor, or payment processor, and is not a party to your transaction. It is provided \"as is\" with no guarantee that a group fills, that anyone pays, or that an order is fulfilled, and to the fullest extent allowed by law its maintainers are not liable for payments, refunds, no-shows, missed deadlines, or the food itself. The full Terms and disclaimer apply.",
];

/** What a CLUB agrees to when turning the split feature on. */
export const CLUB_SPLIT_RULES: string[] = [
  "Split orders let students share one item and pay their share individually. A group must fill by your drop's order deadline or it cancels automatically. You can extend the order or payment deadline for one group or a whole drop, and you can close ordering early to start the payment window.",
  "When ordering closes, each member of a full group gets 24 hours (Eastern time) to pay. You verify each member as their money arrives. QR passes are emailed only once you have verified every member of that group.",
  "Only verify a member after you have actually received their payment. Verifying is your representation that the money arrived, and verifying the last member is what releases the whole group's pickup passes.",
  "You collect all money directly through your own Venmo or Zelle. Cornell Craves never touches funds, takes no fee, and does not guarantee that a group fills or that any student pays.",
  "If a group cancels after you verified someone's share, you owe that student one of two things: a refund, or a reactivation. Reactivating keeps a verified share verified — that member is not asked to pay again. Choose one and act on it promptly. Their money went straight to you; Cornell Craves never held it and cannot refund on your behalf.",
  "You receive each member's name, Cornell email, NetID, and payment handle. Use them only to run and fulfil that order — matching payments, arranging pickup, and settling refunds. Do not use them for marketing, add them to mailing lists, or share them outside your organization. You are responsible for keeping them secure and for complying with Cornell policy and applicable privacy law.",
  "Emails to members are sent on a best-effort basis and delivery is not guaranteed, while deadlines and automatic cancellations run on schedule regardless. Your Orders dashboard is the authoritative record; do not rely on an email having arrived.",
  "You are responsible for fulfilling verified orders, pickup logistics, quantities, allergen accuracy, and food safety, for complying with all applicable laws and Cornell policy, and for handling refunds and disputes with your buyers. You will honor the deadlines and rules shown to students.",
  "Cornell Craves is provided \"as is\" with no liability for payments, refunds, no-shows, missed deadlines, or the food itself, and the indemnification in the Terms and disclaimer applies to everything you run through split orders.",
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
