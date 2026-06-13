/** Small localStorage helpers. Everything degrades silently in private mode. */

const EMAIL_KEY = "craves:email";

export function getSavedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setSavedEmail(email: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase());
  } catch {
    // Ignore.
  }
}

type VoteKind = "review" | "qa";

export function hasVoted(kind: VoteKind, id: string): boolean {
  try {
    return localStorage.getItem(`craves:helpful:${kind}:${id}`) !== null;
  } catch {
    return false;
  }
}

export function markVoted(kind: VoteKind, id: string): void {
  try {
    localStorage.setItem(`craves:helpful:${kind}:${id}`, "1");
  } catch {
    // Ignore.
  }
}
