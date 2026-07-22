// In-memory Supabase stand-in for VITE_MOCK=1. Serves the fixtures in
// ./data.ts through a just-enough query-builder so the real pages render with
// seeded demo data (screenshots, offline UI work). Never bundled in production:
// vite.config.ts only aliases "@/lib/supabase" here when VITE_MOCK=1.
import * as fx from "./data";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: null };

const ROLE_KEY = "craves-mock-role";

function currentRole(): "student" | "club" | "admin" | "anon" {
  // ?mockrole=... wins and persists, so the capture script can steer auth.
  const fromUrl = new URLSearchParams(window.location.search).get("mockrole");
  if (fromUrl) localStorage.setItem(ROLE_KEY, fromUrl);
  const stored = localStorage.getItem(ROLE_KEY);
  return stored === "club" || stored === "admin" || stored === "anon" ? stored : stored === "student" ? "student" : "anon";
}

function currentSession() {
  const role = currentRole();
  if (role === "anon") return null;
  const user = fx.mockUsers[role];
  return {
    access_token: "mock-token",
    refresh_token: "mock-refresh",
    expires_in: 3600,
    token_type: "bearer",
    user,
  };
}

/** Tables the builder can serve. Unknown tables resolve to []. */
const TABLES: Record<string, Row[]> = {
  listings: fx.listings as unknown as Row[],
  clubs: fx.clubs as unknown as Row[],
  campus_locations: fx.locations as unknown as Row[],
  reviews: fx.reviews as unknown as Row[],
  qa: fx.qaEntries as unknown as Row[],
  pickup_slots: fx.pickupSlots as unknown as Row[],
  users_extended: [fx.profileRow] as unknown as Row[],
  recurring_templates: fx.templates as unknown as Row[],
  brand_requests: fx.brandRequests as unknown as Row[],
  club_brand_approvals: [],
  review_helpful_votes: [],
  qa_helpful_votes: [],
  reservations: [],
  brands: fx.adminGlobalBrands as unknown as Row[],
  listing_pickup_spots: [],
  analytics_events: fx.analyticsViews as unknown as Row[],
};

/** The orders table backs three different reads, told apart by the requested
 * columns: authed student orders (listings embedded), the club dashboard
 * (QR rows, no listings), and the analytics 30-day series (neither). */
function ordersFor(columns: string): Row[] {
  if (columns.includes("listings(")) return fx.authedOrders as unknown as Row[];
  if (columns.includes("order_qr_codes")) return fx.clubOrders as unknown as Row[];
  return fx.analyticsOrders as unknown as Row[];
}

class MockQuery implements PromiseLike<Result> {
  private rows: Row[];
  private isSingle = false;
  private nullable = false;
  private isWrite = false;
  private written: Row | null = null;

  constructor(private table: string, rows: Row[]) {
    this.rows = [...rows];
  }

  select(columns = "*") {
    if (this.table === "orders" && !this.isWrite) this.rows = [...ordersFor(columns)];
    return this;
  }
  insert(payload: Row | Row[]) {
    this.isWrite = true;
    this.written = { id: `mock-${Math.random().toString(36).slice(2, 8)}`, ...(Array.isArray(payload) ? payload[0] : payload) };
    this.rows = [this.written];
    return this;
  }
  update(payload: Row) {
    this.isWrite = true;
    this.written = { id: "mock-updated", ...payload };
    this.rows = [this.written];
    return this;
  }
  upsert(payload: Row) {
    return this.insert(payload);
  }
  delete() {
    this.isWrite = true;
    this.rows = [];
    return this;
  }

  eq(column: string, value: unknown) {
    if (!this.isWrite) this.rows = this.rows.filter((row) => !(column in row) || row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    if (!this.isWrite) this.rows = this.rows.filter((row) => !(column in row) || row[column] !== value);
    return this;
  }
  gt(column: string, value: unknown) {
    if (!this.isWrite) this.rows = this.rows.filter((row) => !(column in row) || String(row[column]) > String(value));
    return this;
  }
  gte(column: string, value: unknown) {
    if (!this.isWrite) this.rows = this.rows.filter((row) => !(column in row) || String(row[column]) >= String(value));
    return this;
  }
  lt(column: string, value: unknown) {
    if (!this.isWrite) this.rows = this.rows.filter((row) => !(column in row) || String(row[column]) < String(value));
    return this;
  }
  lte(column: string, value: unknown) {
    if (!this.isWrite) this.rows = this.rows.filter((row) => !(column in row) || String(row[column]) <= String(value));
    return this;
  }
  in(column: string, values: unknown[]) {
    if (!this.isWrite) this.rows = this.rows.filter((row) => !(column in row) || values.includes(row[column]));
    return this;
  }
  contains() {
    return this;
  }
  or() {
    return this;
  }
  ilike() {
    return this;
  }
  is() {
    return this;
  }
  order(column: string, options?: { ascending?: boolean }) {
    const ascending = options?.ascending ?? true;
    this.rows.sort((a, b) => (String(a[column] ?? "") < String(b[column] ?? "") ? -1 : 1) * (ascending ? 1 : -1));
    return this;
  }
  limit(count: number) {
    this.rows = this.rows.slice(0, count);
    return this;
  }
  range(from: number, to: number) {
    this.rows = this.rows.slice(from, to + 1);
    return this;
  }
  returns() {
    return this;
  }
  maybeSingle() {
    this.isSingle = true;
    this.nullable = true;
    return this;
  }
  single() {
    this.isSingle = true;
    return this;
  }

  then<T1 = Result, T2 = never>(
    onfulfilled?: ((value: Result) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    const data = this.isSingle ? (this.rows[0] ?? (this.nullable ? null : null)) : this.rows;
    return Promise.resolve({ data, error: null } as Result).then(onfulfilled, onrejected);
  }
}

/** RPC fixtures. Anything unlisted resolves { data: null }. */
const RPC: Record<string, (args?: Row) => unknown> = {
  get_my_orders: () => fx.myOrders,
  get_my_groups: () => fx.myGroups,
  get_my_group_invites: () => [],
  get_my_reservations: () => [],
  get_club_groups: () => fx.clubGroups,
  club_dashboard_stats: () => fx.clubStats,
  get_my_craving: () => ({ brands: ["Krispy Kreme", "Crumbl", "Insomnia Cookies"] }),
  can_i_review: () => false,
  track_event: () => null,
  am_i_admin: () => currentRole() === "admin",
  admin_overview: () => fx.adminOverview,
  admin_clubs: () => fx.adminClubs,
  admin_brand_requests: () => fx.adminBrandRequests,
  admin_listings: () => fx.adminListings,
  admin_revenue_by_brand: () => fx.adminBrandRevenue,
  admin_global_brands: () => fx.adminGlobalBrands,
  admin_club_brand_approvals: () => fx.adminClubBrandApprovals,
  admin_insights: () => fx.adminInsights,
  create_order: () => "o-new-demo",
  set_order_recommender: () => null,
  set_group_recommender: () => null,
  set_group_member_payment: () => null,
  set_club_groups_enabled: () => null,
  club_extend_deadlines: () => ({ changed: 1 }),
  open_group_payment: () => ({ opened: 1 }),
  reactivate_group: () => ({ mode: "payment" }),
  accept_group_invite: () => "g-1",
  decline_group_invite: () => null,
  invite_to_group: () => null,
  create_order_group: () => ({ group_id: "g-new", open_token: "demo-open-token" }),
  join_or_create_public_group: () => ({ group_id: "g-1", joined: true }),
  get_group_by_token: () => fx.myGroups[0],
  request_brand: () => "br-new",
  add_campus_location: (args) => ({
    id: "loc-new",
    name: (args?.p_name as string) ?? "New spot",
    latitude: 42.444,
    longitude: -76.484,
    description: null,
    pickup_type: "both",
    created_by: "u-club",
    created_at: new Date().toISOString(),
  }),
};

function rpcResult(name: string, args?: Row): Promise<Result> {
  const handler = RPC[name];
  return Promise.resolve({ data: handler ? handler(args) : null, error: null });
}

type AuthCallback = (event: string, session: ReturnType<typeof currentSession>) => void;

export function createMockClient() {
  return {
    from(table: string) {
      return new MockQuery(table, TABLES[table] ?? []);
    },
    rpc(name: string, args?: Row) {
      const promise = rpcResult(name, args) as Promise<Result> & { returns: () => Promise<Result> };
      promise.returns = () => promise;
      return promise;
    },
    functions: {
      invoke: async (_name: string, _options?: Row) => ({ data: { ok: true }, error: null }),
    },
    auth: {
      getSession: async () => ({ data: { session: currentSession() }, error: null }),
      getUser: async () => ({ data: { user: currentSession()?.user ?? null }, error: null }),
      onAuthStateChange(callback: AuthCallback) {
        setTimeout(() => callback("INITIAL_SESSION", currentSession()), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => {
        localStorage.setItem(ROLE_KEY, "anon");
        return { error: null };
      },
      signInWithOAuth: async () => ({ data: {}, error: null }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
      }),
    },
  };
}
