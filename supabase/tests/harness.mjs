// Cornell Craves workflow simulator: runs all migrations on a real Postgres
// (PGlite) with a stubbed Supabase auth/storage layer, then simulates users.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR =
  process.env.MIGRATIONS_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

export async function boot({ through = "999" } = {}) {
  const db = new PGlite();

  // ---- Supabase environment stubs ----
  await db.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;

    create schema if not exists auth;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create or replace function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create or replace function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('app.jwt', true), '')::jsonb, '{}'::jsonb) $$;

    create schema if not exists storage;
    create table storage.buckets (id text primary key, name text, public boolean default false);
    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text, name text, owner uuid, created_at timestamptz default now()
    );
    alter table storage.objects enable row level security;
    create or replace function storage.foldername(name text) returns text[] language sql as
      $$ select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;

    grant usage on schema public, auth, storage to anon, authenticated;
  `);

  // ---- Run migrations in order ----
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (file.slice(0, 3) > through) break;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }

  // Supabase default grants: authenticated can touch everything, RLS decides.
  await db.exec(`
    grant all on all tables in schema public to authenticated;
    grant all on all sequences in schema public to authenticated;
    grant select on all tables in schema public to anon;
  `);

  return db;
}

// ---- Session helpers: run statements as a given user (RLS enforced) ----
export async function asUser(db, user, fn) {
  await db.exec(`
    select set_config('app.uid', '${user ? user.id : ""}', false);
    select set_config('app.jwt', '${user ? JSON.stringify({ email: user.email }).replace(/'/g, "''") : ""}', false);
    set role ${user ? "authenticated" : "anon"};
  `);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; select set_config('app.uid','',false); select set_config('app.jwt','',false);`);
  }
}

export async function createAuthUser(db, email, meta = {}) {
  const { rows } = await db.query(
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id, email`,
    [email, JSON.stringify(meta)],
  );
  return rows[0];
}

// ---- Tiny test runner ----
let pass = 0, fail = 0;
export function check(label, ok, extra = "") {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra ? `  -- ${extra}` : ""}`); }
}
export function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
  return fail;
}
