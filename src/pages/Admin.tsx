import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, Inbox, RefreshCw, ShieldX, Tag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { formatPrice } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  AdminBrandRequest,
  AdminClub,
  AdminGlobalBrand,
  AdminOverview,
} from "@/types/database";

type BrandDecision = "one_time" | "global" | "reject";
type TabId = "approvals" | "requests" | "clubs" | "brands";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function BrandRequestRow({
  request,
  busy,
  onDecide,
}: {
  request: AdminBrandRequest;
  busy: boolean;
  onDecide: (name: string, action: BrandDecision) => void;
}) {
  const [name, setName] = useState(request.requested_name);

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">{request.club_name}</p>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {request.club_email} <span className="mx-1">/</span> requested {formatDay(request.created_at)}
          </p>
        </div>
        <div className="w-full sm:w-56">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Brand name (rename to fix spelling)"
            placeholder="Brand name"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" loading={busy} onClick={() => onDecide(name, "global")}>
          Deploy to all
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDecide(name, "one_time")}>
          Approve once
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDecide(name, "reject")}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function ClubRow({
  club,
  busy,
  confirmingReject,
  onApprove,
  onRevoke,
  onReject,
}: {
  club: AdminClub;
  busy: boolean;
  confirmingReject: boolean;
  onApprove: () => void;
  onRevoke: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-bold">{club.name}</h3>
            <Badge variant={club.approved ? "success" : "urgent"}>
              {club.approved ? "Approved" : "Pending"}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {club.email} <span className="mx-1">/</span>
            <span className="font-mono">{club.venmo ? `@${club.venmo.replace(/^@/, "")}` : "no Venmo"}</span>
            <span className="mx-1">/</span> joined {formatDay(club.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {club.approved ? (
            <Button variant="secondary" size="sm" loading={busy} onClick={onRevoke}>
              Suspend
            </Button>
          ) : (
            <Button size="sm" loading={busy} onClick={onApprove}>
              Approve
            </Button>
          )}
          <Button
            variant={confirmingReject ? "destructive" : "ghost"}
            size="sm"
            disabled={busy}
            onClick={onReject}
          >
            {confirmingReject ? "Confirm delete" : "Delete"}
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span>
          <span className="font-mono font-bold text-ink">{formatPrice(Number(club.revenue))}</span> revenue
        </span>
        <span>
          <span className="font-mono font-bold text-ink">{club.orders}</span> orders
        </span>
        <span>
          <span className="font-mono font-bold text-ink">{club.active_listings}</span> live /{" "}
          {club.listings} all-time drops
        </span>
      </div>
    </div>
  );
}

const TABS: { id: TabId; label: string }[] = [
  { id: "approvals", label: "Approvals" },
  { id: "requests", label: "Brand requests" },
  { id: "clubs", label: "Clubs" },
  { id: "brands", label: "Brands" },
];

export default function Admin() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [requests, setRequests] = useState<AdminBrandRequest[]>([]);
  const [clubs, setClubs] = useState<AdminClub[]>([]);
  const [brands, setBrands] = useState<AdminGlobalBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("approvals");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [ov, rq, cl, br] = await Promise.all([
      supabase.rpc("admin_overview"),
      supabase.rpc("admin_brand_requests"),
      supabase.rpc("admin_clubs"),
      supabase.rpc("admin_global_brands"),
    ]);
    const firstError = ov.error || rq.error || cl.error || br.error;
    if (firstError) setError(firstError.message);
    setOverview((ov.data as AdminOverview | null) ?? null);
    setRequests((rq.data as unknown as AdminBrandRequest[]) ?? []);
    setClubs((cl.data as unknown as AdminClub[]) ?? []);
    setBrands((br.data as unknown as AdminGlobalBrand[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const pendingClubs = useMemo(() => clubs.filter((club) => !club.approved), [clubs]);
  const filteredClubs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clubs;
    return clubs.filter(
      (club) =>
        club.name.toLowerCase().includes(query) || club.email.toLowerCase().includes(query),
    );
  }, [clubs, search]);

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10" aria-busy="true" aria-label="Loading admin panel">
        <div className="h-9 w-40 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
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

  const approveClub = async (id: string) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("admin_set_club_approved", {
      p_club_id: id,
      p_approved: true,
    });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success("Club approved. Welcome email is on its way.");
    await load();
  };

  const revokeClub = async (id: string) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("admin_set_club_approved", {
      p_club_id: id,
      p_approved: false,
    });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success("Club suspended and its live drops hidden.");
    await load();
  };

  const rejectClub = async (id: string) => {
    if (confirmRejectId !== id) {
      setConfirmRejectId(id);
      return;
    }
    setBusyId(id);
    const { error: deleteError } = await supabase.from("clubs").delete().eq("id", id);
    setBusyId(null);
    setConfirmRejectId(null);
    if (deleteError) {
      toast.error(deleteError.message);
      return;
    }
    toast.success("Club deleted.");
    await load();
  };

  const decideBrand = async (id: string, name: string, action: BrandDecision) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("decide_brand_request", {
      p_id: id,
      p_name: name,
      p_action: action,
    });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(
      action === "global"
        ? `"${name}" added for every club and in cravings.`
        : action === "one_time"
          ? `"${name}" approved for that club; their drafts can now post.`
          : "Request rejected.",
    );
    await load();
  };

  const removeBrand = async (id: string, name: string) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("admin_remove_brand", { p_brand_id: id });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(`"${name}" removed from the global list.`);
    await load();
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Admin operations</h1>
          <p className="mt-1 text-sm text-ink-muted">Cornell Craves at a glance.</p>
        </div>
        <Button variant="secondary" size="sm" loading={loading} onClick={() => void load()}>
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            Some admin data failed to load: {error}. Confirm your account matches{" "}
            <span className="font-mono">VITE_ADMIN_EMAIL</span> and the migration's{" "}
            <span className="font-mono">is_admin()</span> email.
          </span>
        </div>
      )}

      {/* Overview */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Revenue"
          value={overview ? formatPrice(Number(overview.revenue)) : "n/a"}
          sub="verified payments"
        />
        <StatCard
          label="Orders"
          value={overview ? String(overview.orders_verified) : "n/a"}
          sub={overview ? `${overview.orders_pending} awaiting verify` : undefined}
        />
        <StatCard
          label="Clubs"
          value={overview ? String(overview.clubs_approved) : "n/a"}
          sub={overview ? `${overview.clubs_pending} pending` : undefined}
        />
        <StatCard
          label="Live drops"
          value={overview ? String(overview.listings_active) : "n/a"}
          sub={overview ? `${overview.listings_draft} drafts` : undefined}
        />
        <StatCard label="Students" value={overview ? String(overview.students) : "n/a"} />
        <StatCard label="Craving subs" value={overview ? String(overview.cravings) : "n/a"} />
        <StatCard label="Reservations" value={overview ? String(overview.reservations) : "n/a"} />
        <StatCard
          label="Brand requests"
          value={overview ? String(overview.brand_requests_pending) : "n/a"}
          sub="pending"
        />
      </div>

      {/* Tabs */}
      <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
        {TABS.map(({ id, label }) => {
          const count =
            id === "approvals"
              ? pendingClubs.length
              : id === "requests"
                ? requests.length
                : id === "clubs"
                  ? clubs.length
                  : brands.length;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                tab === id ? "bg-ink text-surface-raised" : "border border-border text-ink-muted hover-fine:border-primary",
              )}
            >
              {label}
              {count > 0 && <span className="ml-1.5 text-xs opacity-80">({count})</span>}
            </button>
          );
        })}
      </div>

      <section className="mt-6">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-border/40" />
            ))}
          </div>
        ) : tab === "approvals" ? (
          pendingClubs.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-6" aria-hidden="true" />}
              title="All caught up"
              body="No clubs are waiting on approval. New registrations show up here."
            />
          ) : (
            <div className="space-y-3">
              {pendingClubs.map((club) => (
                <ClubRow
                  key={club.id}
                  club={club}
                  busy={busyId === club.id}
                  confirmingReject={confirmRejectId === club.id}
                  onApprove={() => void approveClub(club.id)}
                  onRevoke={() => void revokeClub(club.id)}
                  onReject={() => void rejectClub(club.id)}
                />
              ))}
            </div>
          )
        ) : tab === "requests" ? (
          requests.length === 0 ? (
            <EmptyState
              icon={<Tag className="size-6" aria-hidden="true" />}
              title="No brand requests"
              body="When a club asks for a brand that isn't in the list, it shows up here."
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-muted">
                Rename to fix spelling, then deploy to all (adds it everywhere, incl. cravings) or
                approve once for that club. Approving publishes their post-on-approval drops and lets
                them post their drafts.
              </p>
              <div className="space-y-3">
                {requests.map((request) => (
                  <BrandRequestRow
                    key={request.id}
                    request={request}
                    busy={busyId === request.id}
                    onDecide={(name, action) => void decideBrand(request.id, name, action)}
                  />
                ))}
              </div>
            </>
          )
        ) : tab === "clubs" ? (
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clubs by name or email"
              aria-label="Search clubs"
              className="mb-3"
            />
            {filteredClubs.length === 0 ? (
              <EmptyState
                icon={<Inbox className="size-6" aria-hidden="true" />}
                title="No clubs match"
                body="Try a different search."
              />
            ) : (
              <div className="space-y-3">
                {filteredClubs.map((club) => (
                  <ClubRow
                    key={club.id}
                    club={club}
                    busy={busyId === club.id}
                    confirmingReject={confirmRejectId === club.id}
                    onApprove={() => void approveClub(club.id)}
                    onRevoke={() => void revokeClub(club.id)}
                    onReject={() => void rejectClub(club.id)}
                  />
                ))}
              </div>
            )}
          </>
        ) : brands.length === 0 ? (
          <EmptyState
            icon={<Tag className="size-6" aria-hidden="true" />}
            title="No global brands yet"
            body="Brands you deploy to all clubs appear here. The built-in list lives in the app."
          />
        ) : (
          <div className="space-y-2">
            {brands.map((brand) => (
              <div
                key={brand.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{brand.name}</p>
                  <p className="text-xs text-ink-muted">added {formatDay(brand.created_at)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busyId === brand.id}
                  className="text-accent"
                  onClick={() => void removeBrand(brand.id, brand.name)}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
