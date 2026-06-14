import { useCallback, useEffect, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Heart, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { sha256Hex } from "@/lib/hash";
import { getSavedEmail, hasVoted, markVoted, setSavedEmail } from "@/lib/local";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { QAEntry } from "@/types/database";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function QAItem({
  entry,
  canRespond,
  onResponded,
}: {
  entry: QAEntry;
  canRespond: boolean;
  onResponded: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [voted, setVoted] = useState(() => hasVoted("qa", entry.id));
  const [helpfulCount, setHelpfulCount] = useState(entry.helpful_count);
  const [responding, setResponding] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const voteHelpful = async () => {
    if (voted) return;
    setVoted(true);
    setHelpfulCount((count) => count + 1);
    markVoted("qa", entry.id);
    const { error } = await supabase.rpc("vote_qa_helpful", { p_qa_id: entry.id });
    if (error) toast.error("Could not record your vote");
  };

  const submitResponse = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    setSubmitting(true);
    const { error } = await supabase
      .from("qa")
      .update({ club_response: draft.trim(), response_date: new Date().toISOString() })
      .eq("id", entry.id);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Answer posted");
    setResponding(false);
    onResponded();
  };

  return (
    <motion.li
      initial={reduceMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="rounded-2xl border border-border bg-surface-raised p-4"
    >
      <div className="flex items-center gap-2">
        <span className="font-display text-sm font-bold">Student</span>
        <span className="text-xs text-ink-muted">{formatDate(entry.created_at)}</span>
      </div>
      <p className="mt-1.5 text-sm">{entry.question}</p>

      {entry.club_response ? (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="ml-3 mt-3 rounded-xl bg-tag-blue/50 p-3"
        >
          <p className="text-xs font-bold">Club answer</p>
          <p className="mt-1 text-sm text-ink-muted">{entry.club_response}</p>
          {entry.response_date && (
            <p className="mt-1 text-xs text-ink-muted/80">{formatDate(entry.response_date)}</p>
          )}
        </motion.div>
      ) : canRespond ? (
        <div className="mt-3">
          {responding ? (
            <form onSubmit={submitResponse}>
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Answer publicly. Everyone viewing this listing sees it."
                maxLength={1000}
                autoFocus
              />
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setResponding(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="sm" loading={submitting}>
                  Post answer
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => setResponding(true)}>
              Answer
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-ink-muted">Waiting on the club to answer.</p>
      )}

      <button
        type="button"
        onClick={() => void voteHelpful()}
        disabled={voted}
        aria-pressed={voted}
        className={cn(
          "mt-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
          voted
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border text-ink-muted hover-fine:border-accent/40 hover-fine:text-accent",
        )}
      >
        <Heart className="size-3.5" fill={voted ? "currentColor" : "none"} aria-hidden="true" />
        Helpful{helpfulCount > 0 ? ` (${helpfulCount})` : ""}
      </button>
    </motion.li>
  );
}

interface QAThreadProps {
  listingId: string;
  /** True when the signed-in user owns the listing's club. */
  canRespond: boolean;
  /** True when the signed-in user is a club account (clubs cannot ask questions). */
  isClub: boolean;
}

export function QAThread({ listingId, canRespond, isClub }: QAThreadProps) {
  const [entries, setEntries] = useState<QAEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"newest" | "helpful">("newest");
  const [question, setQuestion] = useState("");
  const [email, setEmail] = useState(getSavedEmail);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("qa")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Could not load questions");
    } else {
      setEntries(data ?? []);
    }
    setLoading(false);
  }, [listingId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const questionError = question.trim().length >= 5 ? undefined : "Ask a question first (5 characters minimum).";
  const emailError = EMAIL_PATTERN.test(email.trim()) ? undefined : "Enter a valid email address.";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (questionError || emailError) return;
    setSubmitting(true);
    const hashed = await sha256Hex(email);
    const { error } = await supabase
      .from("qa")
      .insert({ listing_id: listingId, question_email: hashed, question: question.trim() });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setSavedEmail(email);
    setQuestion("");
    setShowErrors(false);
    toast.success("Question posted anonymously");
    await refetch();
  };

  const sorted = [...entries].sort((a, b) =>
    sort === "helpful"
      ? b.helpful_count - a.helpful_count
      : new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div>
      {/* Clubs answer questions but cannot ask them (Batch 2 #8). */}
      {!isClub && (
      <form onSubmit={submit} noValidate className="rounded-2xl border border-border bg-surface-raised p-4">
        <h3 className="text-base font-bold">Ask the club</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Questions are anonymous. Your email is hashed and never shown; you appear as
          "Student".
        </p>
        <div className="mt-3">
          <Label htmlFor={`qa-question-${listingId}`}>Question</Label>
          <Textarea
            id={`qa-question-${listingId}`}
            value={question}
            invalid={showErrors && Boolean(questionError)}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Is the food made fresh the same day?"
            maxLength={500}
          />
          {showErrors && questionError && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {questionError}
            </p>
          )}
        </div>
        <div className="mt-3">
          <Label htmlFor={`qa-email-${listingId}`}>Email</Label>
          <Input
            id={`qa-email-${listingId}`}
            type="email"
            value={email}
            invalid={showErrors && Boolean(emailError)}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="netid@cornell.edu"
            autoComplete="email"
          />
          {showErrors && emailError && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {emailError}
            </p>
          )}
        </div>
        <Button type="submit" size="sm" className="mt-4" loading={submitting}>
          Ask anonymously
        </Button>
      </form>
      )}

      {loading ? (
        <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading questions">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon={<MessageCircleQuestion className="size-6" aria-hidden="true" />}
            title="No questions yet"
            body="Be the first to ask. Questions are anonymous and answers are public."
          />
        </div>
      ) : (
        <>
          <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Sort questions">
            {(["newest", "helpful"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={sort === option}
                onClick={() => setSort(option)}
                className={cn(
                  "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                  sort === option ? "bg-ink text-surface-raised" : "text-ink-muted hover-fine:bg-ink/10",
                )}
              >
                {option === "newest" ? "Newest" : "Most helpful"}
              </button>
            ))}
          </div>
          <ul className="mt-3 space-y-3">
            {sorted.map((entry) => (
              <QAItem key={entry.id} entry={entry} canRespond={canRespond} onResponded={() => void refetch()} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
