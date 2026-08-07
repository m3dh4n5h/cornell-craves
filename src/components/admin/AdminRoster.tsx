import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Crown, PauseCircle, PlayCircle, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { AdminRosterEntry } from "@/types/database";

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function RosterRow({
  entry,
  isYou,
  busy,
  confirmingRemove,
  onSetStatus,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  entry: AdminRosterEntry;
  isYou: boolean;
  busy: boolean;
  confirmingRemove: boolean;
  onSetStatus: (status: "active" | "suspended") => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const isOwnerRow = entry.role === "owner";
  const suspended = entry.status === "suspended";

  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        suspended ? "border-dashed border-border bg-surface" : "border-border bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className={cn("truncate text-sm font-bold", suspended && "text-ink-muted")}>
              {entry.label || entry.email}
            </p>
            {isOwnerRow && (
              <Badge>
                <Crown className="size-3" aria-hidden="true" />
                Owner
              </Badge>
            )}
            {isYou && !isOwnerRow && <Badge variant="neutral">You</Badge>}
            {suspended && <Badge variant="urgent">Suspended</Badge>}
          </div>
          {entry.label && <p className="truncate text-xs text-ink-muted">{entry.email}</p>}
          <p className="mt-0.5 text-xs text-ink-muted">
            {isOwnerRow
              ? "Full access, including this page."
              : `Added ${formatWhen(entry.created_at)}${entry.added_by ? ` by ${entry.added_by}` : ""}`}
            {suspended && entry.status_changed_at
              ? ` · suspended ${formatWhen(entry.status_changed_at)}`
              : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {isOwnerRow ? (
            <span className="text-xs text-ink-muted">Changed in SQL only</span>
          ) : confirmingRemove ? (
            <>
              <Button variant="destructive" size="sm" loading={busy} onClick={onRemove}>
                Remove for good
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancelRemove}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              {suspended ? (
                <Button variant="secondary" size="sm" loading={busy} onClick={() => onSetStatus("active")}>
                  <PlayCircle className="size-3.5" aria-hidden="true" />
                  Reactivate
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={busy}
                  onClick={() => onSetStatus("suspended")}
                >
                  <PauseCircle className="size-3.5" aria-hidden="true" />
                  Suspend
                </Button>
              )}
              <Button variant="ghost" size="sm" className="text-accent" onClick={onAskRemove}>
                <Trash2 className="size-3.5" aria-hidden="true" />
                Remove
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The owner-only admin roster.
 *
 * Rendered only when `useAuth().isOwner` is true, but that is a convenience,
 * not the security boundary: every function this calls re-checks `is_owner()`
 * server-side and refuses anyone else, so pasting the RPC into a console
 * achieves nothing.
 */
export function AdminRoster() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AdminRosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  // One-click add is a live grant, so the confirm step is where a typo gets
  // caught. It shows the exact address that is about to receive access.
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [adding, setAdding] = useState(false);

  const [busyEmail, setBusyEmail] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const myEmail = (user?.email ?? "").toLowerCase();
  const trimmedEmail = email.trim().toLowerCase();
  const emailValid = EMAIL_SHAPE.test(trimmedEmail);
  const alreadyListed = rows.some((row) => row.email.toLowerCase() === trimmedEmail);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc("admin_list_admins");
    if (rpcError) {
      setError(rpcError.message);
      setRows([]);
    } else {
      setError(null);
      setRows((data as unknown as AdminRosterEntry[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitAdd = (event: FormEvent) => {
    event.preventDefault();
    if (!emailValid) {
      toast.error("Enter a valid email address.");
      return;
    }
    setConfirmAdd(true);
  };

  const reallyAdd = async () => {
    setAdding(true);
    const { error: rpcError } = await supabase.rpc("admin_add_admin", {
      p_email: trimmedEmail,
      p_label: label.trim() || null,
    });
    setAdding(false);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(`${trimmedEmail} now has admin access.`);
    setEmail("");
    setLabel("");
    setConfirmAdd(false);
    await load();
  };

  const setStatus = async (target: string, status: "active" | "suspended") => {
    setBusyEmail(target);
    const { error: rpcError } = await supabase.rpc("admin_set_admin_status", {
      p_email: target,
      p_status: status,
    });
    setBusyEmail(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(status === "suspended" ? `${target} suspended.` : `${target} reactivated.`);
    await load();
  };

  const remove = async (target: string) => {
    setBusyEmail(target);
    const { error: rpcError } = await supabase.rpc("admin_remove_admin", { p_email: target });
    setBusyEmail(null);
    setConfirmRemove(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(`${target} removed.`);
    await load();
  };

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
        <span>
          Could not load the admin roster. This page needs the{" "}
          <span className="font-mono">046_admin_owner_role.sql</span> migration, and an owner row
          seeded by hand. ({error})
        </span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-2xl bg-border/40" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-border bg-surface-raised p-4">
        <h3 className="text-sm font-bold">Add an admin</h3>
        <p className="mt-1 text-sm text-ink-muted">
          They get everything you have except this page: club approvals, brand decisions, listing
          moderation, and insights. Use the exact Google address they sign in with.
        </p>

        <form onSubmit={submitAdd} noValidate className="mt-4 space-y-3">
          <div>
            <Label htmlFor="admin-add-email">Google email</Label>
            <Input
              id="admin-add-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setConfirmAdd(false);
              }}
              placeholder="name@example.com"
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="admin-add-label">Name (optional)</Label>
            <Input
              id="admin-add-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="So the list is readable later"
            />
          </div>

          {confirmAdd ? (
            <div className="rounded-xl border border-accent/40 bg-accent/10 p-3">
              <p className="text-sm font-semibold text-ink">
                Give <span className="font-mono">{trimmedEmail}</span> admin access right now?
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {alreadyListed
                  ? "This address is already on the roster; adding it again reactivates it."
                  : "Access is immediate. You can suspend or remove them at any time."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" loading={adding} onClick={() => void reallyAdd()}>
                  Yes, grant access
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmAdd(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button type="submit" disabled={!emailValid}>
              <UserPlus className="size-4" aria-hidden="true" />
              Add admin
            </Button>
          )}
        </form>
      </div>

      <div>
        <h3 className="text-sm font-bold">
          Current admins <span className="font-normal text-ink-muted">({rows.length})</span>
        </h3>
        {rows.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              icon={<Crown className="size-6" aria-hidden="true" />}
              title="No owner configured"
              body="Seed an owner row in the Supabase SQL editor, then reload. Until then nobody can manage this list."
            />
          </div>
        ) : (
          <div className="mt-2 space-y-2">
            {rows.map((entry) => (
              <RosterRow
                key={entry.email}
                entry={entry}
                isYou={entry.email.toLowerCase() === myEmail}
                busy={busyEmail === entry.email}
                confirmingRemove={confirmRemove === entry.email}
                onSetStatus={(status) => void setStatus(entry.email, status)}
                onAskRemove={() => setConfirmRemove(entry.email)}
                onCancelRemove={() => setConfirmRemove(null)}
                onRemove={() => void remove(entry.email)}
              />
            ))}
          </div>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          Suspending takes effect on their very next request — the check reads the roster live
          rather than trusting a signed-in session. The owner row cannot be suspended, removed, or
          demoted from here on purpose; transferring ownership is a deliberate SQL step so a
          misclick can never lock you out.
        </p>
      </div>
    </div>
  );
}
