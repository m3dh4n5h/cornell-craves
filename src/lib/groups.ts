import type { GroupMemberStatus, GroupStatus } from "@/types/database";

type BadgeVariant = "default" | "urgent" | "neutral" | "success";

export const GROUP_STATUS_META: Record<GroupStatus, { label: string; variant: BadgeVariant }> = {
  filling: { label: "Filling up", variant: "default" },
  full: { label: "Full, payment open", variant: "success" },
  payment_in_progress: { label: "Payment in progress", variant: "default" },
  paid: { label: "All paid", variant: "success" },
  canceled: { label: "Canceled", variant: "urgent" },
  reactivated: { label: "Reactivated, pay now", variant: "default" },
};

export const MEMBER_STATUS_META: Record<GroupMemberStatus, { label: string; variant: BadgeVariant }> = {
  invited: { label: "Invited", variant: "neutral" },
  accepted: { label: "In", variant: "default" },
  pending_payment: { label: "Owes payment", variant: "default" },
  paid: { label: "Paid", variant: "success" },
};

/** Group states where members can or should be paying. */
export const PAYABLE_GROUP_STATUSES: GroupStatus[] = ["full", "payment_in_progress", "reactivated"];

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
