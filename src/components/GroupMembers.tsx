import { BadgeCheck } from "lucide-react";
import { brandTint } from "@/lib/brands";
import { MEMBER_STATUS_META } from "@/lib/groups";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { GroupDetails } from "@/types/database";

interface GroupMembersProps {
  group: GroupDetails;
  /** Highlight which member is the viewer. */
  currentUserId?: string | null;
}

/**
 * Member list: avatar + name + status. Stacks on mobile, rows on desktop.
 * The container is a live region so screen readers hear fills and payments.
 */
export function GroupMembers({ group, currentUserId }: GroupMembersProps) {
  const openSlots = Math.max(0, group.total_people - group.members.length);

  return (
    <div aria-live="polite">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {group.filled_count} of {group.total_people} in
      </p>
      <ul className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {group.members.map((member) => {
          const meta = MEMBER_STATUS_META[member.status];
          const isMe = member.user_id === currentUserId;
          return (
            <li
              key={member.id}
              className="flex items-center gap-2.5 rounded-xl border border-border bg-surface-raised px-3 py-2 sm:min-w-44"
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full font-display text-sm font-extrabold text-ink/80",
                  brandTint(member.name),
                )}
                aria-hidden="true"
              >
                {member.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {member.name}
                  {isMe && <span className="text-ink-muted"> (you)</span>}
                  {member.is_creator && (
                    <span className="ml-1 text-xs font-normal text-ink-muted">started it</span>
                  )}
                </span>
              </span>
              {member.scanned_at ? (
                <Badge variant="success">
                  <BadgeCheck className="size-3" aria-hidden="true" />
                  Picked up
                </Badge>
              ) : (
                <Badge variant={meta.variant}>{meta.label}</Badge>
              )}
            </li>
          );
        })}
        {Array.from({ length: openSlots }, (_, index) => (
          <li
            key={`open-${index}`}
            className="flex items-center gap-2.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-ink-muted sm:min-w-44"
          >
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border"
              aria-hidden="true"
            />
            Open spot
          </li>
        ))}
      </ul>
    </div>
  );
}
