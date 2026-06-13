import { useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { hasVoted, markVoted } from "@/lib/local";
import { RatingStars } from "@/components/RatingStars";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Review } from "@/types/database";

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "Student";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface ReviewCardProps {
  review: Review;
  /** True when the signed-in user owns the listing's club. */
  canRespond?: boolean;
  onResponded?: () => void;
}

export function ReviewCard({ review, canRespond = false, onResponded }: ReviewCardProps) {
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [voted, setVoted] = useState(() => hasVoted("review", review.id));
  const [helpfulCount, setHelpfulCount] = useState(review.helpful_count);
  const [responding, setResponding] = useState(false);
  const [responseDraft, setResponseDraft] = useState("");
  const [submittingResponse, setSubmittingResponse] = useState(false);

  const isLong = review.body.length > 240;
  const body = isLong && !expanded ? `${review.body.slice(0, 240).trimEnd()}...` : review.body;

  const voteHelpful = async () => {
    if (voted) return;
    setVoted(true);
    setHelpfulCount((count) => count + 1);
    markVoted("review", review.id);
    const { error } = await supabase.rpc("vote_review_helpful", { p_review_id: review.id });
    if (error) toast.error("Could not record your vote");
  };

  const submitResponse = async (event: FormEvent) => {
    event.preventDefault();
    if (!responseDraft.trim()) return;
    setSubmittingResponse(true);
    const { error } = await supabase
      .from("reviews")
      .update({ club_response: responseDraft.trim(), response_date: new Date().toISOString() })
      .eq("id", review.id);
    setSubmittingResponse(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Response posted");
    setResponding(false);
    onResponded?.();
  };

  return (
    <article className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-base font-bold">{firstName(review.reviewer_name)}</span>
          <span className="text-xs text-ink-muted">{formatDate(review.created_at)}</span>
        </div>
        <RatingStars value={review.rating} size="sm" />
      </div>

      <h3 className="mt-2 text-base font-bold">{review.title}</h3>
      <p className="mt-1 text-sm text-ink-muted">{body}</p>
      {isLong && (
        <button
          type="button"
          className="mt-1 text-xs font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
          onClick={() => setExpanded((previous) => !previous)}
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}

      {review.club_response && (
        <div className="mt-3 rounded-xl border-l-2 border-accent/50 bg-accent/8 p-3">
          <p className="text-xs font-bold text-accent">Response from the club</p>
          <p className="mt-1 text-sm text-ink-muted">{review.club_response}</p>
          {review.response_date && (
            <p className="mt-1 text-xs text-ink-muted/80">{formatDate(review.response_date)}</p>
          )}
        </div>
      )}

      {canRespond && !review.club_response && (
        <div className="mt-3">
          {responding ? (
            <form onSubmit={submitResponse}>
              <Textarea
                value={responseDraft}
                onChange={(e) => setResponseDraft(e.target.value)}
                placeholder="Thanks for the feedback! Here is what we are doing about it."
                maxLength={1000}
                autoFocus
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setResponding(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={submittingResponse}>
                  Post response
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setResponding(true)}>
              Respond as club
            </Button>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void voteHelpful()}
          disabled={voted}
          aria-pressed={voted}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
            voted
              ? "border-accent/40 bg-accent/10 text-accent"
              : "border-border text-ink-muted hover-fine:border-accent/40 hover-fine:text-accent",
          )}
        >
          <motion.span
            key={voted ? "voted" : "idle"}
            initial={reduceMotion || !voted ? false : { opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
            className="inline-flex"
          >
            <Heart className="size-3.5" fill={voted ? "currentColor" : "none"} aria-hidden="true" />
          </motion.span>
          Helpful{helpfulCount > 0 ? ` (${helpfulCount})` : ""}
        </button>
      </div>
    </article>
  );
}
