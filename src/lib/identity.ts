import type { User } from "@supabase/supabase-js";

/** True when an email belongs to the cornell.edu domain (students). */
export function isCornellEmail(email: string | null | undefined): boolean {
  return Boolean(email && email.trim().toLowerCase().endsWith("@cornell.edu"));
}

/**
 * The user's display name as Google gave it (build spec 5 #3). Used to prefill
 * the name at registration so people don't retype what Google already knows.
 */
export function googleFullName(user: User | null): string {
  const meta = user?.user_metadata ?? {};
  const full = (meta.full_name ?? meta.name ?? "") as string;
  if (full.trim()) return full.trim();
  const given = (meta.given_name ?? "") as string;
  const family = (meta.family_name ?? "") as string;
  return `${given} ${family}`.trim();
}
