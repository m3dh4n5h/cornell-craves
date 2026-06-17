import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { BRANDS } from "@/lib/brands";

/**
 * The brand options shown to students and clubs: the built-in list plus any
 * brands an admin has deployed globally (Batch 2 #17). Deployed brands appear
 * everywhere the list is used - listing form, cravings chips - automatically.
 */
export function useBrandOptions(): string[] {
  const [extra, setExtra] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("brands")
      .select("name")
      .order("name", { ascending: true })
      .then(({ data }) => {
        if (!cancelled && data) setExtra(data.map((row) => row.name));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Static list first (stable, familiar order), then approved-global additions
  // not already present, de-duplicated case-insensitively.
  const seen = new Set<string>(BRANDS.map((brand) => brand.toLowerCase()));
  const merged: string[] = [...BRANDS];
  for (const name of extra) {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      merged.push(name);
    }
  }
  return merged;
}
