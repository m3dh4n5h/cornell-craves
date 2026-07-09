// Drop-in replacement for @/lib/supabase when VITE_MOCK=1 (see vite.config.ts).
// Only the vite runtime aliases to this file; tsc still type-checks the app
// against the real client, so production types stay honest.
import type { supabase as realClient } from "@/lib/supabase";
import { createMockClient } from "./client";
import { MOCK_ADMIN_EMAIL } from "./data";

export const supabase = createMockClient() as unknown as typeof realClient;
export const ADMIN_EMAIL = MOCK_ADMIN_EMAIL;
