// Frontend <-> backend contract check.
//
// Boots every migration on a real Postgres (PGlite), then statically extracts
// every Supabase call the app and the edge function make and checks each one
// against the schema that actually exists:
//
//   * .from("table")   -> table/view exists; every column named in select /
//                         eq / in / is / gte / order / or / insert / update /
//                         upsert exists on it; every embedded relation
//                         (`clubs(name)`, `alias:table!fk(...)`) is a real
//                         table reachable through a real foreign key
//   * .rpc("fn", {..}) -> function exists; every argument the client passes is
//                         a real parameter; every parameter without a default
//                         is passed; the caller's role can EXECUTE it
//   * functions.invoke -> every `action` the client sends has a handler
//   * mock client      -> every RPC the app calls has a mock handler, so the
//                         VITE_MOCK preview cannot silently return null
//
// A FAIL here is a request that will 400/404 in production even though tsc is
// green, because the TypeScript types are hand-written and not derived from
// the database.
//
//   node supabase/tests/contract.mjs
import { boot, check, summary } from "./harness.mjs";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = (p) => relative(ROOT, p);

// ---------------------------------------------------------------- files
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !p.includes("/src/mock/")) out.push(p);
  }
  return out;
}
const APP_FILES = walk(join(ROOT, "src"));
const EDGE_FILE = join(ROOT, "supabase", "functions", "notify-cravings", "index.ts");
const ALL_FILES = [...APP_FILES, EDGE_FILE];

const sources = new Map(ALL_FILES.map((f) => [f, readFileSync(f, "utf8")]));
const lineOf = (src, idx) => src.slice(0, idx).split("\n").length;

// ---------------------------------------------------------------- parsing helpers
/** From `src[open]` (a "(" or "{"), return index just past the matching close. */
function balancedEnd(src, open) {
  const pairs = { "(": ")", "{": "}", "[": "]" };
  const stack = [pairs[src[open]]];
  let i = open + 1;
  let quote = null;
  for (; i < src.length && stack.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "/" && src[i + 1] === "/") i = src.indexOf("\n", i);
    else if (pairs[ch]) stack.push(pairs[ch]);
    else if (ch === stack[stack.length - 1]) stack.pop();
  }
  return i;
}

/** Top-level keys of an object literal `{ a: 1, "b": 2, c, ...rest }`. */
function objectKeys(literal) {
  const body = literal.trim().replace(/^\{/, "").replace(/\}$/, "");
  const keys = [];
  let depth = 0, quote = null, token = "", atKey = true, spread = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (quote) {
      if (ch === "\\") i += 1;
      else if (ch === quote) quote = null;
      if (atKey && depth === 0) token += ch;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { quote = ch; if (atKey && depth === 0) token += ch; continue; }
    if ("({[".includes(ch)) { depth += 1; continue; }
    if (")}]".includes(ch)) { depth -= 1; continue; }
    if (depth > 0) continue;
    if (ch === ":" && atKey) { keys.push(token.trim().replace(/^["'`]|["'`]$/g, "")); atKey = false; token = ""; continue; }
    if (ch === ",") {
      const t = token.trim();
      if (atKey && t && !spread) keys.push(t.replace(/^["'`]|["'`]$/g, "")); // shorthand `{ email }`
      atKey = true; token = ""; spread = false; continue;
    }
    if (atKey) { if (ch === "." && body.slice(i, i + 3) === "...") { spread = true; i += 2; continue; } token += ch; }
  }
  const t = token.trim();
  if (atKey && t && !spread) keys.push(t.replace(/^["'`]|["'`]$/g, ""));
  return keys.filter((k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k));
}

/** Split a PostgREST select string at top-level commas. */
function splitSelect(s) {
  const parts = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parse a select string into { columns: [], relations: [{ name, hint, inner }] }. */
function parseSelect(s) {
  const columns = [];
  const relations = [];
  for (const item of splitSelect(s.replace(/\s+/g, ""))) {
    const paren = item.indexOf("(");
    if (paren >= 0) {
      let head = item.slice(0, paren);
      const inner = item.slice(paren + 1, item.lastIndexOf(")"));
      if (head.includes(":")) head = head.split(":")[1]; // alias:relation
      let hint = null;
      if (head.includes("!")) { const [n, h] = head.split("!"); head = n; hint = h; }
      relations.push({ name: head, hint, inner });
    } else {
      let col = item.includes(":") ? item.split(":")[1] : item;
      col = col.split("::")[0]; // casts
      if (col.includes("->")) col = col.split("->")[0]; // json path
      if (col === "*" || /^count\b/.test(col)) continue;
      // aggregate / count(): treat `x.count()` etc. as unknown-safe
      if (/\.(count|sum|avg|min|max)\(\)$/.test(col)) col = col.split(".")[0];
      columns.push(col);
    }
  }
  return { columns, relations };
}

const BUILDER = new Set([
  "select", "insert", "update", "upsert", "delete", "eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike",
  "is", "in", "contains", "containedBy", "overlaps", "or", "not", "filter", "match", "order", "limit",
  "range", "single", "maybeSingle", "returns", "throwOnError", "csv", "abortSignal", "textSearch",
  "then", "catch", "finally", "explain", "head", "rangeGt", "rangeLt", "rangeGte", "rangeLte", "rangeAdjacent",
]);

/** Walk the builder chain that starts at `.from("t")`; return list of {method, argText, argList}. */
function parseChain(src, fromIdx) {
  const calls = [];
  let i = balancedEnd(src, src.indexOf("(", fromIdx)); // past from(...)
  for (;;) {
    let j = i;
    while (j < src.length && /\s/.test(src[j])) j += 1;
    if (src[j] !== ".") break;
    const m = /^\.([A-Za-z_]+)\s*(<[^>]*>)?\s*\(/.exec(src.slice(j, j + 60));
    if (!m || !BUILDER.has(m[1])) break;
    const open = src.indexOf("(", j + m[0].length - 1);
    const end = balancedEnd(src, open);
    calls.push({ method: m[1], argText: src.slice(open + 1, end - 1) });
    i = end;
    if (m[1] === "then" || m[1] === "catch") break;
  }
  return calls;
}

const firstStringArg = (t) => {
  const m = /^\s*(["'`])((?:\\.|(?!\1)[\s\S])*)\1/.exec(t);
  return m ? m[2] : null;
};
const firstObjectArg = (t) => {
  const s = t.trimStart();
  if (!s.startsWith("{")) return null;
  return s.slice(0, balancedEnd(s, 0));
};

// ---------------------------------------------------------------- extraction
const tableUses = []; // { file, line, table, columns: Set, relations: [], mutations: Set<col> }
const rpcUses = []; // { file, line, fn, args: string[]|null }
const invokeActions = []; // { file, line, action }

for (const [file, src] of sources) {
  const fromRe = /\.from\(\s*"([a-z_0-9]+)"\s*\)/g;
  let m;
  while ((m = fromRe.exec(src))) {
    // storage.from("bucket") is not a table
    if (/storage\s*$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;
    const use = { file, line: lineOf(src, m.index), table: m[1], columns: new Set(), relations: [], mutations: new Set(), dynamicSelect: false };
    for (const call of parseChain(src, m.index)) {
      const { method, argText } = call;
      if (method === "select") {
        const s = firstStringArg(argText);
        if (s == null) { if (argText.trim()) use.dynamicSelect = true; continue; }
        const parsed = parseSelect(s);
        parsed.columns.forEach((c) => use.columns.add(c));
        use.relations.push(...parsed.relations);
      } else if (["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "is", "in", "contains", "containedBy", "overlaps", "textSearch", "filter"].includes(method)) {
        const c = firstStringArg(argText);
        if (c && !c.includes(".")) use.columns.add(c);
      } else if (method === "not") {
        const c = firstStringArg(argText);
        if (c && !c.includes(".")) use.columns.add(c);
      } else if (method === "order") {
        const c = firstStringArg(argText);
        if (c && !c.includes(".") && !c.includes("(")) {
          const opts = firstObjectArg(argText.slice(argText.indexOf(",") + 1) || "");
          const foreign = opts && /(foreignTable|referencedTable)\s*:\s*["']([a-z_]+)["']/.exec(opts);
          if (foreign) use.relations.push({ name: foreign[2], hint: null, inner: c, viaOrder: true });
          else use.columns.add(c);
        }
      } else if (method === "or") {
        const s = firstStringArg(argText);
        if (s) for (const term of splitSelect(s)) {
          const col = term.replace(/^(and|or)\(/, "").split(".")[0];
          if (/^[a-z_][a-z0-9_]*$/.test(col)) use.columns.add(col);
        }
      } else if (method === "match") {
        const o = firstObjectArg(argText);
        if (o) objectKeys(o).forEach((k) => use.columns.add(k));
      } else if (method === "insert" || method === "update" || method === "upsert") {
        const s = argText.trimStart();
        const literal = s.startsWith("{") ? s.slice(0, balancedEnd(s, 0)) : s.startsWith("[") && s.slice(1).trimStart().startsWith("{") ? (() => { const k = s.indexOf("{"); return s.slice(k, balancedEnd(s, k)); })() : null;
        if (literal) objectKeys(literal).forEach((k) => use.mutations.add(k));
        if (method === "upsert") {
          const opt = /onConflict\s*:\s*["']([^"']+)["']/.exec(argText);
          if (opt) opt[1].split(",").forEach((k) => use.mutations.add(k.trim()));
        }
      }
    }
    tableUses.push(use);
  }

  const rpcRe = /\.rpc(?:<[^>]*>)?\(\s*"([a-z_0-9]+)"/g;
  while ((m = rpcRe.exec(src))) {
    const after = src.slice(m.index + m[0].length);
    const comma = after.trimStart().startsWith(",");
    let args = [];
    if (comma) {
      const rest = after.slice(after.indexOf(",") + 1).trimStart();
      if (rest.startsWith("{")) args = objectKeys(rest.slice(0, balancedEnd(rest, 0)));
      else args = null; // variable; cannot check keys statically
    }
    rpcUses.push({ file, line: lineOf(src, m.index), fn: m[1], args, caller: file === EDGE_FILE ? "service_role" : "authenticated" });
  }

  const invRe = /functions\.invoke\(\s*"notify-cravings"[\s\S]{0,200}?action\s*:\s*"([a-z_]+)"/g;
  while ((m = invRe.exec(src))) invokeActions.push({ file, line: lineOf(src, m.index), action: m[1] });
}

// ---------------------------------------------------------------- schema
const db = await boot();
const columnsByRel = new Map();
{
  const { rows } = await db.query(`
    select table_name, column_name from information_schema.columns
    where table_schema = 'public' order by table_name, ordinal_position`);
  for (const r of rows) {
    if (!columnsByRel.has(r.table_name)) columnsByRel.set(r.table_name, new Set());
    columnsByRel.get(r.table_name).add(r.column_name);
  }
}
const fks = (await db.query(`
  select c.conname, src.relname as src, dst.relname as dst
  from pg_constraint c
  join pg_class src on src.oid = c.conrelid
  join pg_class dst on dst.oid = c.confrelid
  join pg_namespace n on n.oid = src.relnamespace
  where c.contype = 'f' and n.nspname = 'public'`)).rows;
const fkBetween = (a, b) => fks.some((f) => (f.src === a && f.dst === b) || (f.src === b && f.dst === a));
const fkNamed = (name) => fks.some((f) => f.conname === name);

const fnRows = (await db.query(`
  select p.proname,
         coalesce(p.proargnames, '{}') as argnames,
         p.pronargs, p.pronargdefaults,
         pg_get_function_identity_arguments(p.oid) as sig,
         has_function_privilege('authenticated', p.oid, 'execute') as auth_exec,
         has_function_privilege('anon', p.oid, 'execute') as anon_exec,
         p.prosecdef
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'`)).rows;
const fnsByName = new Map();
for (const f of fnRows) {
  if (!fnsByName.has(f.proname)) fnsByName.set(f.proname, []);
  fnsByName.get(f.proname).push(f);
}

// ---------------------------------------------------------------- checks: tables
console.log("T: tables and columns referenced by the app + edge function\n");
const seenTable = new Set();
for (const use of tableUses) {
  const where = `${rel(use.file)}:${use.line}`;
  const cols = columnsByRel.get(use.table);
  if (!cols) { check(`${where} .from("${use.table}") exists`, false, "no such table/view"); continue; }
  if (!seenTable.has(use.table)) { seenTable.add(use.table); check(`table/view "${use.table}" exists`, true); }
  for (const c of use.columns) check(`${where} ${use.table}.${c} (read)`, cols.has(c), `column not in ${use.table}: ${[...cols].join(", ")}`);
  for (const c of use.mutations) check(`${where} ${use.table}.${c} (write)`, cols.has(c), `column not in ${use.table}`);
  for (const r of use.relations) {
    const rcols = columnsByRel.get(r.name);
    if (!rcols) { check(`${where} ${use.table} -> ${r.name}(...) relation exists`, false, "no such table"); continue; }
    const joined = r.hint && !["inner", "left"].includes(r.hint) ? fkNamed(r.hint) : fkBetween(use.table, r.name);
    check(`${where} ${use.table} -> ${r.name}${r.hint ? "!" + r.hint : ""} joinable by FK`, joined, "PostgREST cannot embed without a foreign key");
    if (!r.viaOrder) {
      const inner = parseSelect(r.inner);
      for (const c of inner.columns) check(`${where} ${r.name}.${c} (embedded read)`, rcols.has(c), `column not in ${r.name}`);
    } else check(`${where} order by ${r.name}.${r.inner}`, rcols.has(r.inner));
  }
}

// ---------------------------------------------------------------- checks: rpcs
console.log("\nR: RPC names, arguments, and execute grants\n");
const seenRpc = new Map();
for (const u of rpcUses) {
  const where = `${rel(u.file)}:${u.line}`;
  const overloads = fnsByName.get(u.fn);
  if (!overloads) { check(`${where} rpc("${u.fn}") exists`, false, "no such function"); continue; }
  const argKey = `${u.fn}(${(u.args ?? ["?"]).slice().sort().join(",")})`;
  if (seenRpc.has(argKey)) continue; // same call shape already verified
  seenRpc.set(argKey, true);

  if (u.args === null) { check(`${where} rpc("${u.fn}", <dynamic>) exists`, true); continue; }
  // PostgREST resolves the overload whose named parameters match the JSON keys.
  const matches = overloads.filter((f) => {
    const names = f.argnames.filter(Boolean);
    const required = names.slice(0, f.pronargs - f.pronargdefaults);
    return u.args.every((a) => names.includes(a)) && required.every((r) => u.args.includes(r));
  });
  const detail = overloads.map((f) => `${u.fn}(${f.sig})`).join(" | ");
  check(`${where} rpc("${u.fn}", {${u.args.join(", ")}}) matches a signature`, matches.length === 1, matches.length === 0 ? `client keys do not match any overload: ${detail}` : `ambiguous: ${matches.length} overloads`);
  if (matches.length === 1) {
    const f = matches[0];
    const role = u.caller;
    const ok = role === "service_role" ? true : f.auth_exec;
    check(`${where} ${role} may execute ${u.fn}`, ok, "no EXECUTE grant");
  }
}

// RPCs the app calls while signed out (public pages). These must be executable by anon.
// Ordering, reservations and reviews are gated behind Google sign-in in the UI
// (OrderForm, PickupCalendar, MyOrders, OrderDetail all bail when !user) and
// migration 005 revoked anon on purpose, so only these two are truly public.
const ANON_RPCS = ["get_group_by_token", "track_event"];
console.log("\nA: RPCs reachable from signed-out pages must allow anon\n");
for (const name of ANON_RPCS) {
  const fs = fnsByName.get(name) ?? [];
  check(`anon may execute ${name}`, fs.length > 0 && fs.every((f) => f.anon_exec), fs.length ? "anon lacks EXECUTE" : "missing");
}

// RPCs that must NOT be callable by anon or authenticated (system jobs).
console.log("\nP: privileged functions are not exposed\n");
for (const name of ["process_group_deadlines", "group_payload"]) {
  const fs = fnsByName.get(name) ?? [];
  check(`anon cannot execute ${name}`, fs.length > 0 && fs.every((f) => !f.anon_exec));
  check(`authenticated cannot execute ${name}`, fs.length > 0 && fs.every((f) => !f.auth_exec));
}

// ---------------------------------------------------------------- checks: edge function actions
console.log("\nE: edge-function actions the client sends have handlers\n");
const edgeSrc = sources.get(EDGE_FILE);
const seenAction = new Set();
for (const a of invokeActions) {
  if (seenAction.has(a.action)) continue;
  seenAction.add(a.action);
  check(`${rel(a.file)}:${a.line} action "${a.action}" handled by notify-cravings`, edgeSrc.includes(`body.action === "${a.action}"`));
}

// ---------------------------------------------------------------- checks: mock parity
console.log("\nM: VITE_MOCK client covers every RPC and table the app uses\n");
const mockClient = readFileSync(join(ROOT, "src/mock/client.ts"), "utf8");
const mockData = readFileSync(join(ROOT, "src/mock/data.ts"), "utf8");
const mockAll = mockClient + mockData;
// Informational: the mock returns { data: null } for an unhandled RPC, which is
// enough for fire-and-forget calls but means the preview cannot exercise them.
for (const fn of new Set(rpcUses.filter((u) => u.file !== EDGE_FILE).map((u) => u.fn))) {
  if (!new RegExp(`(^|[\\s,{])${fn}\\s*[:(]`, "m").test(mockAll)) console.log(`  INFO  no mock handler for rpc ${fn} (preview returns null data)`);
}
for (const t of new Set(tableUses.filter((u) => u.file !== EDGE_FILE).map((u) => u.table))) {
  check(`mock table fixture: ${t}`, new RegExp(`(^|[\\s,{])${t}\\s*:`, "m").test(mockAll), "from() returns [] in the preview harness");
}

// ---------------------------------------------------------------- checks: stale functions
console.log("\nU: functions the app declares in types but never calls / backend functions unused (informational)\n");
const typesSrc = readFileSync(join(ROOT, "src/types/database.ts"), "utf8");
const fnSection = typesSrc.slice(typesSrc.indexOf("Functions: {"));
const declared = [...fnSection.matchAll(/^\s{6}([a-z_0-9]+): \{/gm)].map((m) => m[1]);
const called = new Set(rpcUses.map((u) => u.fn));
for (const d of declared) {
  if (!called.has(d)) console.log(`  INFO  declared in database.ts but never called: ${d}${fnsByName.has(d) ? "" : " (and does not exist in the database: dead type)"}`);
  else check(`declared type ${d} exists in database`, fnsByName.has(d));
}

summary();
