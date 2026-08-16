import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SearchX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { brandInitials, brandTint } from "@/lib/brands";
import { formatPrice } from "@/lib/format";
import { GROUP_STATUS_META } from "@/lib/groups";
import { GroupMembers } from "@/components/GroupMembers";
import { SplitRulesDialog } from "@/components/SplitRulesDialog";
import { GoogleButton } from "@/components/GoogleButton";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { GroupDetails } from "@/types/database";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isGoogleUser, loading: authLoading } = useAuth();
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [recommender, setRecommender] = useState("");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void supabase.rpc("get_group_by_token", { p_token: token }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) toast.error(error.message);
      setGroup((data as unknown as GroupDetails | null) ?? null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading || authLoading) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10" aria-busy="true" aria-label="Loading invitation">
        <div className="h-9 w-56 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 h-64 animate-pulse rounded-2xl bg-border/40" />
      </div>
    );
  }

  if (!group || !token) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-12">
        <EmptyState
          icon={<SearchX className="size-6" aria-hidden="true" />}
          title="Invite not found"
          body="This link is invalid or the group was deleted. Ask your friend for a fresh one."
          actionLabel="Browse the feed"
          onAction={() => navigate("/")}
        />
      </div>
    );
  }

  const status = GROUP_STATUS_META[group.status];
  const isMember = Boolean(user && group.members.some((member) => member.user_id === user.id));
  const joinable = group.status === "filling" && !isMember;
  const askRecommender = group.recommender_enabled && (group.member_options?.length ?? 0) > 0;

  const accept = async (ackVersion: string) => {
    setAccepting(true);
    const { error } = await supabase.rpc("accept_group_invite", {
      p_token: token,
      p_ack_version: ackVersion,
    });
    setAccepting(false);
    setRulesOpen(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Best-effort, mirrors OrderForm: your own recommender pick on your own
    // member row, independent of whoever else is in this group.
    if (recommender) {
      const { error: recError } = await supabase.rpc("set_group_member_recommender", {
        p_group_id: group.id,
        p_value: recommender,
      });
      if (recError) console.warn("recommender not saved:", recError.message);
    }
    toast.success("You're in. You'll pay your share once the group fills and orders close.");
    navigate("/orders");
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Split an order</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {group.members[0]?.name ?? "A student"} is splitting an order and saved you a spot.
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-base font-extrabold text-ink/80",
              brandTint(group.brand),
            )}
            aria-hidden="true"
          >
            {brandInitials(group.brand)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold">{group.item_name}</h2>
            <p className="text-sm text-ink-muted">
              {group.listing_title}, {group.brand} by {group.club_name}
            </p>
            <p className="mt-1 text-sm">
              <span className="font-mono font-bold">{formatPrice(Number(group.share_amount))}</span>{" "}
              <span className="text-ink-muted">
                each, split {group.total_people} ways ({formatPrice(Number(group.item_price))} total)
              </span>
            </p>
            {/* Invited members need to see WHERE the money goes before joining. */}
            {(group.club_venmo || group.club_zelle) && (
              <p className="mt-1.5 text-xs text-ink-muted">
                You pay {group.club_name} directly over{" "}
                {group.club_venmo && (
                  <>
                    Venmo{" "}
                    <span className="font-mono text-ink">@{group.club_venmo.replace(/^@/, "")}</span>
                  </>
                )}
                {group.club_venmo && group.club_zelle && " or "}
                {group.club_zelle && (
                  <>
                    Zelle <span className="font-mono text-ink">{group.club_zelle}</span>
                  </>
                )}{" "}
                once the group fills.
              </p>
            )}
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <div className="mt-4">
          <GroupMembers group={group} currentUserId={user?.id} />
        </div>
      </div>

      <div className="mt-6">
        {isMember ? (
          <Button className="w-full" size="lg" onClick={() => navigate("/orders")}>
            You are in this group, view it
          </Button>
        ) : !joinable ? (
          <div className="rounded-2xl border border-dashed border-border p-4 text-center text-sm text-ink-muted">
            This group is no longer accepting members.
            <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => navigate(`/listing/${group.listing_id}`)}>
              View the listing instead
            </Button>
          </div>
        ) : !user || !isGoogleUser ? (
          <div>
            <p className="mb-3 text-center text-sm text-ink-muted">
              Sign in with Google to claim your spot.
            </p>
            <GoogleButton label="Sign in and join" redirectPath={`/invite/${token}`} />
          </div>
        ) : (
          <div>
            {askRecommender && (
              <div className="mb-4">
                <Label htmlFor="invite-recommender" className="text-sm font-bold">
                  Which member recommended you?
                </Label>
                <p className="mt-1 text-xs text-ink-muted">
                  Optional. Helps {group.club_name} credit the member who sent you.
                </p>
                <div className="mt-1.5">
                  <Select
                    id="invite-recommender"
                    value={recommender}
                    onChange={(e) => setRecommender(e.target.value)}
                  >
                    <option value="">No one in particular</option>
                    {group.member_options!.map((member) => (
                      <option key={member} value={member}>
                        {member}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" size="lg" loading={accepting} onClick={() => setRulesOpen(true)}>
                Join and split
              </Button>
              <Button variant="ghost" size="lg" onClick={() => navigate("/")}>
                No thanks
              </Button>
            </div>
          </div>
        )}
      </div>

      <SplitRulesDialog
        open={rulesOpen}
        audience="student"
        confirmLabel="Agree & join"
        busy={accepting}
        onAccept={(version) => void accept(version)}
        onClose={() => setRulesOpen(false)}
      />
    </div>
  );
}
