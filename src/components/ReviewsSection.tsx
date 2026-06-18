import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { RatingStars } from "@/components/RatingStars";
import { ReviewCard } from "@/components/ReviewCard";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Review } from "@/types/database";

const VIRTUALIZE_THRESHOLD = 100;

interface ReviewsSectionProps {
  listingId: string;
  /** True when the signed-in user owns the listing's club. */
  canRespond: boolean;
  /** True when the signed-in user is a club account (clubs cannot post reviews). */
  isClub: boolean;
  /** Called after any change so the parent can refresh avg_rating. */
  onChanged?: () => void;
}

function VirtualReviewList({
  reviews,
  canRespond,
  signedIn,
  votes,
  userEmail,
  onResponded,
}: {
  reviews: Review[];
  canRespond: boolean;
  signedIn: boolean;
  votes: Set<string>;
  userEmail: string;
  onResponded: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useWindowVirtualizer({
    count: reviews.length,
    estimateSize: () => 180,
    overscan: 6,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  return (
    <div ref={listRef}>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const review = reviews[row.index];
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full pb-3"
              style={{ transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
            >
              <ReviewCard
                review={review}
                canRespond={canRespond}
                signedIn={signedIn}
                initialVoted={votes.has(review.id)}
                ownReview={Boolean(userEmail) && review.reviewer_email.toLowerCase() === userEmail}
                onResponded={onResponded}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ReviewsSection({ listingId, canRespond, isClub, onChanged }: ReviewsSectionProps) {
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();
  const signedIn = Boolean(user);
  const userEmail = (user?.email ?? "").toLowerCase();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [votes, setVotes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [starFilter, setStarFilter] = useState<number | null>(null);
  // Only a signed-in buyer with a verified order may post (Batch 2 #13).
  const [eligible, setEligible] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isClub) {
      setEligible(false);
      return;
    }
    let cancelled = false;
    void supabase.rpc("can_i_review", { p_listing_id: listingId }).then(({ data }) => {
      if (!cancelled) setEligible(data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [isClub, listingId]);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("reviews")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Could not load reviews");
      setLoading(false);
      return;
    }
    const rows = data ?? [];
    setReviews(rows);
    // The caller's own helpful votes drive the toggled state (RLS limits to self).
    if (user && rows.length > 0) {
      const { data: voteRows } = await supabase
        .from("review_helpful_votes")
        .select("review_id")
        .in(
          "review_id",
          rows.map((row) => row.id),
        );
      setVotes(new Set((voteRows ?? []).map((vote) => vote.review_id)));
    } else {
      setVotes(new Set());
    }
    setLoading(false);
  }, [listingId, user]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const average = useMemo(
    () =>
      reviews.length === 0
        ? 0
        : reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length,
    [reviews],
  );

  const countsByStar = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const review of reviews) counts[review.rating] += 1;
    return counts;
  }, [reviews]);

  const filtered = starFilter ? reviews.filter((review) => review.rating === starFilter) : reviews;

  const errors = {
    name: name.trim().length >= 2 ? undefined : "Enter your name (first name is what shows).",
    rating: rating >= 1 ? undefined : "Pick a star rating.",
    title: title.trim().length >= 3 ? undefined : "Give your review a short title.",
    body: body.trim().length >= 10 ? undefined : "Say a bit more (10 characters minimum).",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (hasErrors) return;
    setSubmitting(true);
    // Server derives the email and re-checks the verified purchase (migration 012).
    const { error } = await supabase.rpc("post_review", {
      p_listing_id: listingId,
      p_rating: rating,
      p_title: title.trim(),
      p_body: body.trim(),
      p_reviewer_name: name.trim(),
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Review posted. Thanks for keeping clubs honest!");
    setFormOpen(false);
    setEligible(false);
    setRating(0);
    setTitle("");
    setBody("");
    setShowErrors(false);
    await refetch();
    onChanged?.();
  };

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading reviews">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-32 animate-pulse rounded-2xl bg-border/40" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {reviews.length > 0 ? (
          <div className="flex items-center gap-3">
            <span className="font-display text-3xl font-extrabold">{average.toFixed(1)}</span>
            <div>
              <RatingStars value={average} size="sm" />
              <p className="text-xs text-ink-muted">
                {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">No reviews yet.</p>
        )}
        {isClub ? null : eligible ? (
          <Button variant={formOpen ? "ghost" : "primary"} size="sm" onClick={() => setFormOpen((open) => !open)}>
            {formOpen ? "Close" : "Write a review"}
          </Button>
        ) : (
          <span className="text-xs text-ink-muted">Only verified buyers can review.</span>
        )}
      </div>

      <AnimatePresence>
        {formOpen && (
          <motion.form
            onSubmit={submit}
            noValidate
            initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="mt-4 rounded-2xl border border-border bg-surface-raised p-4"
          >
            <div>
              <Label>Your rating</Label>
              <RatingStars value={rating} onChange={setRating} size="lg" />
              {showErrors && errors.rating && (
                <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
                  {errors.rating}
                </p>
              )}
            </div>
            <div className="mt-4">
              <Label htmlFor="review-name">Name</Label>
              <Input
                id="review-name"
                value={name}
                invalid={showErrors && Boolean(errors.name)}
                onChange={(e) => setName(e.target.value)}
                placeholder="Only your first name is shown"
                autoComplete="name"
              />
              {showErrors && errors.name && (
                <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
                  {errors.name}
                </p>
              )}
            </div>
            <div className="mt-4">
              <Label htmlFor="review-title">Title</Label>
              <Input
                id="review-title"
                value={title}
                invalid={showErrors && Boolean(errors.title)}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Worth the walk across the quad"
                maxLength={120}
              />
              {showErrors && errors.title && (
                <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
                  {errors.title}
                </p>
              )}
            </div>
            <div className="mt-4">
              <Label htmlFor="review-body">Review</Label>
              <Textarea
                id="review-body"
                value={body}
                invalid={showErrors && Boolean(errors.body)}
                onChange={(e) => setBody(e.target.value)}
                placeholder="How was the food, the line, the pickup?"
                maxLength={2000}
              />
              {showErrors && errors.body && (
                <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
                  {errors.body}
                </p>
              )}
            </div>
            <Button type="submit" className="mt-5" loading={submitting}>
              Post review
            </Button>
          </motion.form>
        )}
      </AnimatePresence>

      {reviews.length > 0 && (
        <>
          <div
            className="mt-5 flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Filter reviews by rating"
          >
            <button
              type="button"
              role="radio"
              aria-checked={starFilter === null}
              onClick={() => setStarFilter(null)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                starFilter === null ? "bg-ink text-surface-raised" : "border border-border text-ink-muted hover-fine:border-primary",
              )}
            >
              All ({reviews.length})
            </button>
            {[5, 4, 3, 2, 1].map((stars) => (
              <button
                key={stars}
                type="button"
                role="radio"
                aria-checked={starFilter === stars}
                disabled={countsByStar[stars] === 0}
                onClick={() => setStarFilter(starFilter === stars ? null : stars)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45",
                  starFilter === stars
                    ? "bg-ink text-surface-raised"
                    : "border border-border text-ink-muted hover-fine:border-primary",
                )}
              >
                {stars}-star ({countsByStar[stars]})
              </button>
            ))}
          </div>

          <div className="mt-4">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<MessageSquarePlus className="size-6" aria-hidden="true" />}
                title="No reviews at this rating"
                body="Try another filter to see what people said."
                actionLabel="Show all reviews"
                onAction={() => setStarFilter(null)}
              />
            ) : filtered.length > VIRTUALIZE_THRESHOLD ? (
              <VirtualReviewList
                reviews={filtered}
                canRespond={canRespond}
                signedIn={signedIn}
                votes={votes}
                userEmail={userEmail}
                onResponded={() => void refetch()}
              />
            ) : (
              <div className="space-y-3">
                {filtered.map((review) => (
                  <ReviewCard
                    key={review.id}
                    review={review}
                    canRespond={canRespond}
                    signedIn={signedIn}
                    initialVoted={votes.has(review.id)}
                    ownReview={Boolean(userEmail) && review.reviewer_email.toLowerCase() === userEmail}
                    onResponded={() => void refetch()}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
