import { useCallback, useEffect, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Heart, MessageCircleQuestion } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { sha256Hex } from "@/lib/hash";
import { EmptyState } from "@/components/EmptyState";
import { GoogleButton } from "@/components/GoogleButton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { QAEntry } from "@/types/database";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type HelpfulTarget = "question" | "answer";

function HelpfulButton({
  qaId,
  target,
  initialVoted,
  initialCount,
  canVote,
}: {
  qaId: string;
  target: HelpfulTarget;
  initialVoted: boolean;
  initialCount: number;
  canVote: boolean;
}) {
  const [voted, setVoted] = useState(initialVoted);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  // Re-sync if the parent reloads with fresh server state.
  useEffect(() => setVoted(initialVoted), [initialVoted]);
  useEffect(() => setCount(initialCount), [initialCount]);

  const toggle = async () => {
    if (!canVote) {
      toast.error("Sign in to mark helpful");
      return;
    }
    if (busy) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("toggle_qa_helpful", {
      p_qa_id: qaId,
      p_target: target,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data as unknown as { voted: boolean; count: number };
    setVoted(result.voted);
    setCount(result.count);
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      aria-pressed={voted}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
        voted
          ? "border-accent/40 bg-accent/10 text-accent"
          : "border-border text-ink-muted hover-fine:border-accent/40 hover-fine:text-accent",
      )}
    >
      <Heart className="size-3.5" fill={voted ? "currentColor" : "none"} aria-hidden="true" />
      Helpful{count > 0 ? ` (${count})` : ""}
    </button>
  );
}

function QAItem({
  entry,
  canRespond,
  signedIn,
  ownQuestion,
  votedQuestion,
  votedAnswer,
  onResponded,
}: {
  entry: QAEntry;
  canRespond: boolean;
  signedIn: boolean;
  /** True when the signed-in user asked this question (cannot mark it helpful). */
  ownQuestion: boolean;
  votedQuestion: boolean;
  votedAnswer: boolean;
  onResponded: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [responding, setResponding] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm">{entry.question}</p>

      {/* The asker cannot mark their own question helpful. */}
      {!ownQuestion && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <HelpfulButton
            qaId={entry.id}
            target="question"
            initialVoted={votedQuestion}
            initialCount={entry.helpful_count}
            canVote={signedIn}
          />
        </div>
      )}

      {entry.club_response ? (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          className="ml-3 mt-3 rounded-xl bg-tag-blue/50 p-3"
        >
          <p className="text-xs font-bold">Club answer</p>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-muted">
            {entry.club_response}
          </p>
          {entry.response_date && (
            <p className="mt-1 text-xs text-ink-muted/80">{formatDate(entry.response_date)}</p>
          )}
          {/* The club cannot mark its own answer helpful. */}
          {!canRespond && (
            <div className="mt-2">
              <HelpfulButton
                qaId={entry.id}
                target="answer"
                initialVoted={votedAnswer}
                initialCount={entry.answer_helpful_count}
                canVote={signedIn}
              />
            </div>
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
  const { user } = useAuth();
  const signedIn = Boolean(user);
  const [entries, setEntries] = useState<QAEntry[]>([]);
  const [votes, setVotes] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"newest" | "helpful">("newest");
  const [question, setQuestion] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // The asker's anonymized hash, so we can hide "Helpful" on their own question.
  const [myHash, setMyHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (user?.email) {
      void sha256Hex(user.email).then((hash) => {
        if (!cancelled) setMyHash(hash);
      });
    } else {
      setMyHash(null);
    }
    return () => {
      cancelled = true;
    };
  }, [user]);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("qa")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false });
    if (error) {
      toast.error("Could not load questions");
      setLoading(false);
      return;
    }
    const rows = data ?? [];
    setEntries(rows);

    // The caller's own helpful votes drive the toggled state (RLS limits to self).
    if (user && rows.length > 0) {
      const { data: voteRows } = await supabase
        .from("qa_helpful_votes")
        .select("qa_id, target")
        .in(
          "qa_id",
          rows.map((row) => row.id),
        );
      setVotes(new Set((voteRows ?? []).map((vote) => `${vote.qa_id}:${vote.target}`)));
    } else {
      setVotes(new Set());
    }
    setLoading(false);
  }, [listingId, user]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const questionError =
    question.trim().length >= 5 ? undefined : "Ask a question first (5 characters minimum).";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (questionError || !user) return;
    setSubmitting(true);
    const hashed = await sha256Hex(user.email ?? user.id);
    const { error } = await supabase
      .from("qa")
      .insert({ listing_id: listingId, question_email: hashed, question: question.trim() });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
      {!isClub &&
        (signedIn ? (
          <form
            onSubmit={submit}
            noValidate
            className="rounded-2xl border border-border bg-surface-raised p-4"
          >
            <h3 className="text-base font-bold">Ask the club</h3>
            <p className="mt-1 text-xs text-ink-muted">
              Questions are anonymous. Your identity is hashed and never shown; you appear as
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
            <Button type="submit" size="sm" className="mt-4" loading={submitting}>
              Ask anonymously
            </Button>
          </form>
        ) : (
          <div className="rounded-2xl border border-border bg-surface-raised p-4 text-center">
            <h3 className="text-base font-bold">Ask the club</h3>
            <p className="mt-1 text-xs text-ink-muted">
              Sign in to ask a question or mark answers helpful. You stay anonymous as "Student".
            </p>
            <div className="mx-auto mt-3 max-w-xs">
              <GoogleButton label="Sign in to ask" redirectPath={`/listing/${listingId}/qa`} />
            </div>
          </div>
        ))}

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
              <QAItem
                key={entry.id}
                entry={entry}
                canRespond={canRespond}
                signedIn={signedIn}
                ownQuestion={Boolean(myHash) && entry.question_email === myHash}
                votedQuestion={votes.has(`${entry.id}:question`)}
                votedAnswer={votes.has(`${entry.id}:answer`)}
                onResponded={() => void refetch()}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
