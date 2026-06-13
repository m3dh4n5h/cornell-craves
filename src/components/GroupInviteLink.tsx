import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { inviteUrl } from "@/lib/groups";
import { Button } from "@/components/ui/button";

interface GroupInviteLinkProps {
  token: string;
}

/** Shareable join link with one-tap copy. */
export function GroupInviteLink({ token }: GroupInviteLinkProps) {
  const [copied, setCopied] = useState(false);
  const url = inviteUrl(token);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy, long-press the link instead");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
        aria-label="Group invite link"
        className="h-11 min-w-0 flex-1 truncate rounded-xl border border-border bg-surface px-3 font-mono text-xs text-ink-muted"
      />
      <Button type="button" variant="secondary" onClick={() => void copy()} className="shrink-0">
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
