import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, Inbox, ShieldX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import type { Club } from "@/types/database";

function PendingClubRow({
  club,
  busy,
  confirmingReject,
  onApprove,
  onReject,
}: {
  club: Club;
  busy: boolean;
  confirmingReject: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const registered = new Date(club.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised p-4">
      <div className="min-w-0">
        <h3 className="truncate text-base font-bold">{club.name}</h3>
        <p className="mt-0.5 truncate text-sm text-ink-muted">
          {club.email} <span className="mx-1">/</span>
          <span className="font-mono text-xs">
            {club.venmo ? `@${club.venmo.replace(/^@/, "")}` : "no Venmo"}
          </span>
          <span className="mx-1">/</span>
          registered {registered}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button size="sm" loading={busy} onClick={onApprove}>
          Approve
        </Button>
        <Button
          variant={confirmingReject ? "destructive" : "secondary"}
          size="sm"
          disabled={busy}
          onClick={onReject}
        >
          {confirmingReject ? "Confirm reject" : "Reject"}
        </Button>
      </div>
    </div>
  );
}

export default function Admin() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [pending, setPending] = useState<Club[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("clubs")
      .select("*")
      .eq("approved", false)
      .order("created_at", { ascending: true });
    if (queryError) {
      setError(queryError.message);
      setPending([]);
    } else {
      setPending(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) void fetchPending();
  }, [isAdmin, fetchPending]);

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10" aria-busy="true" aria-label="Loading admin panel">
        <div className="h-9 w-40 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <EmptyState
          icon={<ShieldX className="size-6" aria-hidden="true" />}
          title="Admins only"
          body="This account does not have admin access. If that seems wrong, check VITE_ADMIN_EMAIL."
        />
      </div>
    );
  }

  const approve = async (club: Club) => {
    setBusyId(club.id);
    const { error: updateError } = await supabase
      .from("clubs")
      .update({ approved: true })
      .eq("id", club.id);
    if (updateError) {
      toast.error(updateError.message);
    } else {
      toast.success(`${club.name} approved. Welcome email is on its way.`);
      setPending((previous) => previous.filter((entry) => entry.id !== club.id));
    }
    setBusyId(null);
  };

  const reject = async (club: Club) => {
    if (confirmRejectId !== club.id) {
      setConfirmRejectId(club.id);
      return;
    }
    setBusyId(club.id);
    const { error: deleteError } = await supabase.from("clubs").delete().eq("id", club.id);
    if (deleteError) {
      toast.error(deleteError.message);
    } else {
      toast.success(`${club.name} rejected and removed.`);
      setPending((previous) => previous.filter((entry) => entry.id !== club.id));
    }
    setBusyId(null);
    setConfirmRejectId(null);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Admin</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {pending.length} {pending.length === 1 ? "club" : "clubs"} waiting for approval.
      </p>

      <section className="mt-8">
        {loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading pending clubs">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl bg-border/40" />
            ))}
          </div>
        ) : error ? (
          <EmptyState
            icon={<AlertTriangle className="size-6" aria-hidden="true" />}
            title="Could not load pending clubs"
            body="Check that your account email matches VITE_ADMIN_EMAIL and the migration's is_admin() email, then retry."
            actionLabel="Retry"
            onAction={() => void fetchPending()}
          />
        ) : pending.length === 0 ? (
          <EmptyState
            icon={<Inbox className="size-6" aria-hidden="true" />}
            title="All caught up"
            body="No clubs are waiting on approval. New registrations show up here."
          />
        ) : (
          <div className="space-y-3">
            {pending.map((club) => (
              <PendingClubRow
                key={club.id}
                club={club}
                busy={busyId === club.id}
                confirmingReject={confirmRejectId === club.id}
                onApprove={() => void approve(club)}
                onReject={() => void reject(club)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
