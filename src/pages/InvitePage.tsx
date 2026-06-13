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
import { GoogleButton } from "@/components/GoogleButton";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupDetails } from "@/types/database";

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, isGoogleUser, loading: authLoading } = useAuth();
  const [group, setGroup] = useState<GroupDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);

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

  const accept = async () => {
    setAccepting(true);
    const { error } = await supabase.rpc("accept_group_invite", { p_token: token });
    setAccepting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("You are in. Pay your share once the group fills.");
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
          <div className="flex gap-2">
            <Button className="flex-1" size="lg" loading={accepting} onClick={() => void accept()}>
              Join and split
            </Button>
            <Button variant="ghost" size="lg" onClick={() => navigate("/")}>
              No thanks
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
