import { GroupInviteLink } from "cornell-craves";

/** The shareable join link handed to a split-order creator, with copy control. */
export function Default() {
  return (
    <div style={{ maxWidth: 380 }}>
      <GroupInviteLink token="qh3xk9td2m" />
    </div>
  );
}

/** In context: the confirmation panel shown right after starting a split. */
export function InConfirmation() {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-6" style={{ maxWidth: 380 }}>
      <h2 className="text-lg font-extrabold">Split order started</h2>
      <p className="mt-2 text-sm text-ink-muted">
        Share this link. When 4 people are in, everyone pays their $8.75 share.
      </p>
      <div className="mt-4">
        <GroupInviteLink token="qh3xk9td2m" />
      </div>
    </div>
  );
}
