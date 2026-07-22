import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { brandInitials, brandTint } from "@/lib/brands";
import { formatPrice } from "@/lib/format";
import { SplitRulesDialog } from "@/components/SplitRulesDialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupDetails } from "@/types/database";

interface GroupInvitationCardProps {
  invite: GroupDetails & { invite_token: string };
  onResponded: () => void;
}

/** A pending split-order invitation with accept and decline. */
export function GroupInvitationCard({ invite, onResponded }: GroupInvitationCardProps) {
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  const accept = async (ackVersion: string) => {
    setBusy("accept");
    const { error } = await supabase.rpc("accept_group_invite", {
      p_token: invite.invite_token,
      p_ack_version: ackVersion,
    });
    setBusy(null);
    setRulesOpen(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("You joined the group");
    onResponded();
  };

  const decline = async () => {
    setBusy("decline");
    const { error } = await supabase.rpc("decline_group_invite", { p_token: invite.invite_token });
    setBusy(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Invitation declined");
    onResponded();
  };

  return (
    <div className="rounded-2xl border border-primary-dark/40 bg-primary/10 p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-base font-extrabold text-ink/80",
            brandTint(invite.brand),
          )}
          aria-hidden="true"
        >
          {brandInitials(invite.brand)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold">Split order invitation</h3>
          <p className="mt-0.5 text-sm text-ink-muted">
            {invite.members[0]?.name ?? "A student"} wants to split {invite.item_name} from{" "}
            {invite.listing_title}, {formatPrice(Number(invite.share_amount))} each between{" "}
            {invite.total_people} people.
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" loading={busy === "accept"} disabled={busy === "decline"} onClick={() => setRulesOpen(true)}>
          Accept
        </Button>
        <Button
          variant="ghost"
          size="sm"
          loading={busy === "decline"}
          disabled={busy === "accept"}
          onClick={() => void decline()}
        >
          Decline
        </Button>
      </div>

      <SplitRulesDialog
        open={rulesOpen}
        audience="student"
        confirmLabel="Agree & join"
        busy={busy === "accept"}
        onAccept={(version) => void accept(version)}
        onClose={() => setRulesOpen(false)}
      />
    </div>
  );
}
