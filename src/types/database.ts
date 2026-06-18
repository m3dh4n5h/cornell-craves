// Note: these are type aliases, not interfaces, on purpose. supabase-js
// constrains table types to Record<string, unknown>, which interfaces fail
// (no implicit index signature) and type aliases satisfy.

export type DietaryTagId =
  | "vegan"
  | "vegetarian"
  | "halal"
  | "kosher"
  | "gluten-free"
  | "nut-free"
  | "dairy-free";

export type ListingItem = {
  name: string;
  price: number;
  /** Units in a box (a dozen = 12). Defaults to 1; used for even group splits. */
  quantity?: number;
  dietary_tags?: DietaryTagId[];
};

export type Club = {
  id: string;
  name: string;
  email: string;
  venmo: string | null;
  zelle_phone: string | null;
  approved: boolean;
  groups_enabled: boolean;
  logo_url: string | null;
  member_options: string[];
  created_at: string;
};

export type PickupType = "same_day_only" | "preorder_only" | "both";

/** Per-spot ordering rule (Batch 2 #3, Tranche 4 #5 adds "both"). */
export type OrderType = "same_day" | "preorder" | "both";

export type CampusLocation = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  description: string | null;
  pickup_type: PickupType;
  /** Club that added this spot, or null for the curated list (Tranche 4 #4). */
  created_by: string | null;
  created_at: string;
};

/** A campus location a listing offers for pickup, with its order type (#2, #3). */
export type ListingPickupSpot = {
  id: string;
  listing_id: string;
  location_id: string;
  order_type: OrderType;
  /** Window this spot's pickup is available; gates the map pin (build spec 5). */
  available_start: string | null;
  available_end: string | null;
  /** Per-day hours for multi-day windows, shown in the map popup. */
  hours_note: string | null;
  created_at: string;
};

export type ListingPickupSpotWithLocation = ListingPickupSpot & {
  campus_locations: Pick<
    CampusLocation,
    "id" | "name" | "latitude" | "longitude" | "description"
  > | null;
};

/** Approved-global brand additions, merged with the static list (Batch 2 #17). */
export type Brand = {
  id: string;
  name: string;
  created_at: string;
};

export type BrandRequestStatus = "pending" | "approved" | "rejected";
export type BrandRequestScope = "one_time" | "global";

export type BrandRequest = {
  id: string;
  club_id: string;
  requested_name: string;
  status: BrandRequestStatus;
  scope: BrandRequestScope | null;
  decided_at: string | null;
  created_at: string;
};

export type BrandRequestWithClub = BrandRequest & {
  clubs: Pick<Club, "name" | "email"> | null;
};

/** Admin operations dashboard shapes (SECURITY DEFINER RPCs). */
export type AdminOverview = {
  clubs_total: number;
  clubs_pending: number;
  clubs_approved: number;
  listings_total: number;
  listings_active: number;
  listings_draft: number;
  orders_total: number;
  orders_verified: number;
  orders_pending: number;
  revenue: number;
  students: number;
  cravings: number;
  reservations: number;
  brand_requests_pending: number;
  global_brands: number;
};

export type AdminBrandRequest = {
  id: string;
  requested_name: string;
  status: BrandRequestStatus;
  created_at: string;
  club_id: string;
  club_name: string;
  club_email: string;
};

export type AdminClub = {
  id: string;
  name: string;
  email: string;
  approved: boolean;
  created_at: string;
  logo_url: string | null;
  venmo: string | null;
  listings: number;
  active_listings: number;
  orders: number;
  revenue: number;
};

export type AdminGlobalBrand = {
  id: string;
  name: string;
  created_at: string;
};

export type AdminBrandRevenue = {
  brand: string;
  revenue: number;
  orders: number;
};

export type Listing = {
  id: string;
  club_id: string;
  brand: string;
  title: string;
  description: string | null;
  items: ListingItem[];
  pickup_info: string | null;
  pickup_location_id: string | null;
  contact_email: string | null;
  recommender_enabled: boolean;
  cause_name: string | null;
  cause_percent: number | null;
  draft: boolean;
  auto_post_on_brand: boolean;
  brand_approved: boolean;
  avg_rating: number;
  review_count: number;
  expires_at: string;
  active: boolean;
  created_at: string;
  payment_updated_at: string | null;
};

export type ListingWithClub = Listing & {
  clubs: Pick<
    Club,
    "name" | "venmo" | "zelle_phone" | "groups_enabled" | "logo_url" | "member_options"
  > | null;
  campus_locations?: Pick<CampusLocation, "name" | "latitude" | "longitude" | "pickup_type"> | null;
  /** All pickup spots for this drop (Batch 2 #2/#3), embedded from the join table. */
  listing_pickup_spots?: ListingPickupSpotWithLocation[];
  /** Scheduled pickup days (Batch 2 #4/#10), embedded from pickup_slots. */
  pickup_slots?: Array<
    Pick<PickupSlot, "start_time" | "end_time" | "location_id"> & {
      campus_locations?: Pick<
        CampusLocation,
        "id" | "name" | "latitude" | "longitude"
      > | null;
    }
  >;
};

export type Craving = {
  id: string;
  email: string;
  brands: string[];
  created_at: string;
};

export type NotificationLog = {
  id: string;
  craving_id: string;
  listing_id: string;
  sent_at: string;
};

export type PickupSlot = {
  id: string;
  listing_id: string;
  start_time: string;
  end_time: string;
  max_reservations: number;
  reserved_count: number;
  /** Per-slot pickup location (build spec 5 #5), null = use the listing's spots. */
  location_id: string | null;
  created_at: string;
};

export type Reservation = {
  id: string;
  slot_id: string;
  user_email: string;
  user_name: string;
  quantity: number;
  dietary_notes: string | null;
  confirmed: boolean;
  attended: boolean;
  created_at: string;
};

export type Review = {
  id: string;
  listing_id: string;
  reviewer_email: string;
  reviewer_name: string;
  rating: number;
  title: string;
  body: string;
  club_response: string | null;
  response_date: string | null;
  helpful_count: number;
  created_at: string;
  updated_at: string;
};

export type QAEntry = {
  id: string;
  listing_id: string;
  question_email: string;
  question: string;
  club_response: string | null;
  response_date: string | null;
  helpful_count: number;
  answer_helpful_count: number;
  question_user_id: string | null;
  created_at: string;
};

export type QAHelpfulVote = {
  id: string;
  qa_id: string;
  user_id: string;
  target: "question" | "answer";
  created_at: string;
};

export type TemplateMode = "one_time" | "auto";

export type RecurringTemplate = {
  id: string;
  club_id: string;
  name: string;
  brand: string;
  items: ListingItem[];
  description: string | null;
  frequency: "weekly" | "biweekly" | "monthly";
  next_run_date: string | null;
  is_active: boolean;
  mode: TemplateMode;
  auto_active: boolean;
  created_at: string;
};

export type AnalyticsEvent = {
  id: string;
  listing_id: string;
  club_id: string;
  event_type: "view" | "venmo_click";
  created_at: string;
};

export type UserPreferences = {
  brands?: string[];
  dietary?: DietaryTagId[];
};

export type UserProfile = {
  id: string;
  first_name: string;
  last_name: string;
  cornell_netid: string | null;
  cornell_email: string | null;
  venmo_id: string | null;
  zelle_id: string | null;
  phone: string | null;
  preferences_json: UserPreferences;
  created_at: string;
  updated_at: string;
};

export type OrderItem = {
  name: string;
  price: number;
  qty: number;
};

export type PaymentMethod = "venmo" | "zelle" | "both";

export type OrderStatus = "pending_payment" | "qr_sent" | "picked_up" | "cancelled";

export type Order = {
  id: string;
  listing_id: string;
  user_id: string | null;
  orderer_name: string;
  orderer_email: string;
  orderer_netid: string | null;
  items_json: OrderItem[];
  total: number;
  payment_method: PaymentMethod;
  payment_details_json: { venmo?: string; zelle?: string };
  payment_verified: boolean;
  status: OrderStatus;
  proxy_name: string | null;
  proxy_email: string | null;
  proxy_netid: string | null;
  picked_up_by_name: string | null;
  picked_up_by_email: string | null;
  picked_up_at: string | null;
  recommended_by: string | null;
  created_at: string;
};

export type OrderQRCode = {
  id: string;
  order_id: string;
  user_type: "orderer" | "proxy";
  qr_encrypted: string;
  /** Short single-use pickup code shown to the buyer and emailed (migration 017). */
  pickup_code: string | null;
  is_active: boolean;
  scanned_at: string | null;
  scanned_by_user_type: string | null;
  created_at: string;
};

/** Order plus context, as returned by get_my_orders and the authed join. */
export type MyOrder = Order & {
  listing_title: string;
  brand: string;
  pickup_info: string | null;
  location_name: string | null;
  expires_at: string;
  qr_codes: OrderQRCode[];
};

export type GroupStatus =
  | "filling"
  | "full"
  | "payment_in_progress"
  | "paid"
  | "canceled"
  | "reactivated";

export type GroupMemberStatus = "invited" | "accepted" | "pending_payment" | "paid";

export type GroupVisibility = "private" | "public";

export type OrderGroup = {
  id: string;
  listing_id: string;
  item_name: string;
  item_price: number;
  item_quantity: number;
  split_type: number;
  total_people: number;
  filled_count: number;
  deadline: string;
  status: GroupStatus;
  visibility: GroupVisibility;
  created_by: string;
  created_at: string;
};

export type OrderGroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  status: GroupMemberStatus;
  qr_encrypted: string;
  scanned_at: string | null;
  created_at: string;
};

export type OrderGroupInvitation = {
  id: string;
  group_id: string;
  invited_email: string | null;
  invited_by_user_id: string;
  status: "pending" | "accepted" | "declined";
  invite_link_token: string;
  created_at: string;
};

export type GroupMemberView = {
  id: string;
  user_id: string;
  name: string;
  status: GroupMemberStatus;
  scanned_at: string | null;
  is_creator: boolean;
};

/** Shape produced by the group_payload SQL helper (all group RPCs). */
export type GroupDetails = OrderGroup & {
  listing_title: string;
  brand: string;
  listing_active: boolean;
  club_name: string;
  club_venmo: string | null;
  club_zelle: string | null;
  share_amount: number;
  units_per_person?: number;
  open_token: string | null;
  members: GroupMemberView[];
  // Present depending on which RPC returned it:
  my_status?: GroupMemberStatus;
  my_member_id?: string;
  my_qr?: string;
  invite_token?: string;
  invite_status?: "pending" | "accepted" | "declined";
};

/** Row shape returned by the get_my_reservations RPC. */
export type MyReservation = {
  id: string;
  quantity: number;
  dietary_notes: string | null;
  confirmed: boolean;
  attended: boolean;
  created_at: string;
  slot_id: string;
  start_time: string;
  end_time: string;
  listing_id: string;
  listing_title: string;
  brand: string;
  listing_active: boolean;
  location_name: string | null;
  club_name: string;
  venmo: string | null;
  zelle_phone: string | null;
};

type ClubInsert = {
  id: string;
  name: string;
  email: string;
  venmo?: string | null;
  zelle_phone?: string | null;
  approved?: boolean;
  groups_enabled?: boolean;
  logo_url?: string | null;
  member_options?: string[];
  created_at?: string;
};

type BrandInsert = {
  id?: string;
  name: string;
  created_at?: string;
};

type BrandRequestInsert = {
  id?: string;
  club_id: string;
  requested_name: string;
  status?: BrandRequestStatus;
  scope?: BrandRequestScope | null;
  decided_at?: string | null;
  created_at?: string;
};

type ListingInsert = {
  id?: string;
  club_id: string;
  brand: string;
  title: string;
  description?: string | null;
  items?: ListingItem[];
  pickup_info?: string | null;
  pickup_location_id?: string | null;
  contact_email?: string | null;
  recommender_enabled?: boolean;
  cause_name?: string | null;
  cause_percent?: number | null;
  draft?: boolean;
  auto_post_on_brand?: boolean;
  brand_approved?: boolean;
  avg_rating?: number;
  review_count?: number;
  expires_at: string;
  active?: boolean;
  created_at?: string;
  payment_updated_at?: string | null;
};

type CravingInsert = {
  id?: string;
  email: string;
  brands: string[];
  created_at?: string;
};

type NotificationLogInsert = {
  id?: string;
  craving_id: string;
  listing_id: string;
  sent_at?: string;
};

type PickupSlotInsert = {
  id?: string;
  listing_id: string;
  start_time: string;
  end_time: string;
  max_reservations: number;
  reserved_count?: number;
  location_id?: string | null;
  created_at?: string;
};

type ListingPickupSpotInsert = {
  id?: string;
  listing_id: string;
  location_id: string;
  order_type?: OrderType;
  available_start?: string | null;
  available_end?: string | null;
  hours_note?: string | null;
  created_at?: string;
};

type ReservationInsert = {
  id?: string;
  slot_id: string;
  user_email: string;
  user_name: string;
  quantity: number;
  dietary_notes?: string | null;
  confirmed?: boolean;
  attended?: boolean;
  created_at?: string;
};

type ReviewInsert = {
  id?: string;
  listing_id: string;
  reviewer_email: string;
  reviewer_name: string;
  rating: number;
  title: string;
  body: string;
  club_response?: string | null;
  response_date?: string | null;
  helpful_count?: number;
  created_at?: string;
  updated_at?: string;
};

type QAInsert = {
  id?: string;
  listing_id: string;
  question_email: string;
  question: string;
  club_response?: string | null;
  response_date?: string | null;
  helpful_count?: number;
  created_at?: string;
};

type RecurringTemplateInsert = {
  id?: string;
  club_id: string;
  name: string;
  brand: string;
  items?: ListingItem[];
  description?: string | null;
  frequency: "weekly" | "biweekly" | "monthly";
  next_run_date?: string | null;
  is_active?: boolean;
  mode?: TemplateMode;
  auto_active?: boolean;
  created_at?: string;
};

type CampusLocationInsert = {
  id?: string;
  name: string;
  latitude: number;
  longitude: number;
  description?: string | null;
  pickup_type?: PickupType;
  created_by?: string | null;
  created_at?: string;
};

type UserProfileInsert = {
  id: string;
  first_name?: string;
  last_name?: string;
  cornell_netid?: string | null;
  cornell_email?: string | null;
  venmo_id?: string | null;
  zelle_id?: string | null;
  phone?: string | null;
  preferences_json?: UserPreferences;
  created_at?: string;
  updated_at?: string;
};

type OrderInsert = {
  id?: string;
  listing_id: string;
  user_id?: string | null;
  orderer_name: string;
  orderer_email: string;
  orderer_netid?: string | null;
  items_json?: OrderItem[];
  total: number;
  payment_method: PaymentMethod;
  payment_details_json?: { venmo?: string; zelle?: string };
  payment_verified?: boolean;
  status?: OrderStatus;
  proxy_name?: string | null;
  proxy_email?: string | null;
  proxy_netid?: string | null;
  picked_up_by_name?: string | null;
  picked_up_by_email?: string | null;
  picked_up_at?: string | null;
  recommended_by?: string | null;
  created_at?: string;
};

type OrderQRCodeInsert = {
  id?: string;
  order_id: string;
  user_type: "orderer" | "proxy";
  qr_encrypted?: string;
  pickup_code?: string | null;
  is_active?: boolean;
  scanned_at?: string | null;
  scanned_by_user_type?: string | null;
  created_at?: string;
};

type AnalyticsEventInsert = {
  id?: string;
  listing_id: string;
  club_id: string;
  event_type: "view" | "venmo_click";
  created_at?: string;
};

export type Database = {
  public: {
    Tables: {
      clubs: {
        Row: Club;
        Insert: ClubInsert;
        Update: Partial<ClubInsert>;
        Relationships: [];
      };
      listings: {
        Row: Listing;
        Insert: ListingInsert;
        Update: Partial<ListingInsert>;
        Relationships: [
          {
            foreignKeyName: "listings_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "clubs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listings_pickup_location_id_fkey";
            columns: ["pickup_location_id"];
            isOneToOne: false;
            referencedRelation: "campus_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      cravings: {
        Row: Craving;
        Insert: CravingInsert;
        Update: Partial<CravingInsert>;
        Relationships: [];
      };
      notifications_log: {
        Row: NotificationLog;
        Insert: NotificationLogInsert;
        Update: Partial<NotificationLogInsert>;
        Relationships: [
          {
            foreignKeyName: "notifications_log_craving_id_fkey";
            columns: ["craving_id"];
            isOneToOne: false;
            referencedRelation: "cravings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_log_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      pickup_slots: {
        Row: PickupSlot;
        Insert: PickupSlotInsert;
        Update: Partial<PickupSlotInsert>;
        Relationships: [
          {
            foreignKeyName: "pickup_slots_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      listing_pickup_spots: {
        Row: ListingPickupSpot;
        Insert: ListingPickupSpotInsert;
        Update: Partial<ListingPickupSpotInsert>;
        Relationships: [
          {
            foreignKeyName: "listing_pickup_spots_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "listing_pickup_spots_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "campus_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      reservations: {
        Row: Reservation;
        Insert: ReservationInsert;
        Update: Partial<ReservationInsert>;
        Relationships: [
          {
            foreignKeyName: "reservations_slot_id_fkey";
            columns: ["slot_id"];
            isOneToOne: false;
            referencedRelation: "pickup_slots";
            referencedColumns: ["id"];
          },
        ];
      };
      reviews: {
        Row: Review;
        Insert: ReviewInsert;
        Update: Partial<ReviewInsert>;
        Relationships: [
          {
            foreignKeyName: "reviews_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      qa: {
        Row: QAEntry;
        Insert: QAInsert;
        Update: Partial<QAInsert>;
        Relationships: [
          {
            foreignKeyName: "qa_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      qa_helpful_votes: {
        Row: QAHelpfulVote;
        Insert: {
          id?: string;
          qa_id: string;
          user_id: string;
          target: "question" | "answer";
          created_at?: string;
        };
        Update: Partial<{
          target: "question" | "answer";
        }>;
        Relationships: [
          {
            foreignKeyName: "qa_helpful_votes_qa_id_fkey";
            columns: ["qa_id"];
            isOneToOne: false;
            referencedRelation: "qa";
            referencedColumns: ["id"];
          },
        ];
      };
      review_helpful_votes: {
        Row: { id: string; review_id: string; user_id: string; created_at: string };
        Insert: { id?: string; review_id: string; user_id: string; created_at?: string };
        Update: Partial<{ review_id: string }>;
        Relationships: [
          {
            foreignKeyName: "review_helpful_votes_review_id_fkey";
            columns: ["review_id"];
            isOneToOne: false;
            referencedRelation: "reviews";
            referencedColumns: ["id"];
          },
        ];
      };
      recurring_templates: {
        Row: RecurringTemplate;
        Insert: RecurringTemplateInsert;
        Update: Partial<RecurringTemplateInsert>;
        Relationships: [
          {
            foreignKeyName: "recurring_templates_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "clubs";
            referencedColumns: ["id"];
          },
        ];
      };
      campus_locations: {
        Row: CampusLocation;
        Insert: CampusLocationInsert;
        Update: Partial<CampusLocationInsert>;
        Relationships: [];
      };
      brands: {
        Row: Brand;
        Insert: BrandInsert;
        Update: Partial<BrandInsert>;
        Relationships: [];
      };
      brand_requests: {
        Row: BrandRequest;
        Insert: BrandRequestInsert;
        Update: Partial<BrandRequestInsert>;
        Relationships: [
          {
            foreignKeyName: "brand_requests_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "clubs";
            referencedColumns: ["id"];
          },
        ];
      };
      users_extended: {
        Row: UserProfile;
        Insert: UserProfileInsert;
        Update: Partial<UserProfileInsert>;
        Relationships: [];
      };
      orders: {
        Row: Order;
        Insert: OrderInsert;
        Update: Partial<OrderInsert>;
        Relationships: [
          {
            foreignKeyName: "orders_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
        ];
      };
      order_qr_codes: {
        Row: OrderQRCode;
        Insert: OrderQRCodeInsert;
        Update: Partial<OrderQRCodeInsert>;
        Relationships: [
          {
            foreignKeyName: "order_qr_codes_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
        ];
      };
      analytics_events: {
        Row: AnalyticsEvent;
        Insert: AnalyticsEventInsert;
        Update: Partial<AnalyticsEventInsert>;
        Relationships: [
          {
            foreignKeyName: "analytics_events_listing_id_fkey";
            columns: ["listing_id"];
            isOneToOne: false;
            referencedRelation: "listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analytics_events_club_id_fkey";
            columns: ["club_id"];
            isOneToOne: false;
            referencedRelation: "clubs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      track_event: {
        Args: { p_listing_id: string; p_event_type: "view" };
        Returns: undefined;
      };
      upsert_my_craving: {
        Args: { p_brands: string[] };
        Returns: undefined;
      };
      delete_my_craving: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      get_my_craving: {
        Args: Record<string, never>;
        Returns: string[];
      };
      can_i_review: {
        Args: { p_listing_id: string };
        Returns: boolean;
      };
      post_review: {
        Args: {
          p_listing_id: string;
          p_rating: number;
          p_title: string;
          p_body: string;
          p_reviewer_name: string;
        };
        Returns: string;
      };
      delete_my_account: {
        Args: Record<string, never>;
        Returns: undefined;
      };
      set_order_recommender: {
        Args: { p_order_id: string; p_value: string };
        Returns: undefined;
      };
      add_campus_location: {
        Args: { p_name: string; p_lat: number; p_lng: number; p_description?: string | null };
        Returns: CampusLocation;
      };
      is_brand_approved: {
        Args: { p_brand: string };
        Returns: boolean;
      };
      request_brand: {
        Args: { p_name: string };
        Returns: string;
      };
      admin_overview: {
        Args: Record<string, never>;
        Returns: AdminOverview | null;
      };
      admin_brand_requests: {
        Args: Record<string, never>;
        Returns: AdminBrandRequest[];
      };
      admin_clubs: {
        Args: Record<string, never>;
        Returns: AdminClub[];
      };
      admin_global_brands: {
        Args: Record<string, never>;
        Returns: AdminGlobalBrand[];
      };
      admin_remove_brand: {
        Args: { p_brand_id: string };
        Returns: undefined;
      };
      admin_set_club_approved: {
        Args: { p_club_id: string; p_approved: boolean };
        Returns: undefined;
      };
      admin_revenue_by_brand: {
        Args: Record<string, never>;
        Returns: AdminBrandRevenue[];
      };
      am_i_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      toggle_review_helpful: {
        Args: { p_review_id: string };
        Returns: { voted: boolean; count: number };
      };
      decide_brand_request: {
        Args: { p_id: string; p_name: string; p_action: "one_time" | "global" | "reject" };
        Returns: undefined;
      };
      create_reservation: {
        Args: {
          p_slot_id: string;
          p_email: string;
          p_name: string;
          p_quantity: number;
          p_dietary_notes?: string | null;
        };
        Returns: string;
      };
      cancel_reservation: {
        Args: { p_reservation_id: string; p_email: string };
        Returns: undefined;
      };
      confirm_reservation: {
        Args: { p_reservation_id: string; p_email: string };
        Returns: undefined;
      };
      get_my_reservations: {
        Args: { p_email: string };
        Returns: MyReservation[];
      };
      vote_review_helpful: {
        Args: { p_review_id: string };
        Returns: undefined;
      };
      vote_qa_helpful: {
        Args: { p_qa_id: string };
        Returns: undefined;
      };
      toggle_qa_helpful: {
        Args: { p_qa_id: string; p_target: "question" | "answer" };
        Returns: { voted: boolean; count: number };
      };
      create_order: {
        Args: {
          p_listing_id: string;
          p_name: string;
          p_email: string;
          p_netid: string | null;
          p_items: { name: string; qty: number }[];
          p_payment_method: PaymentMethod;
          p_venmo?: string | null;
          p_zelle?: string | null;
          p_proxy_name?: string | null;
          p_proxy_email?: string | null;
          p_proxy_netid?: string | null;
        };
        Returns: string;
      };
      get_my_orders: {
        Args: { p_email: string };
        Returns: MyOrder[];
      };
      cancel_order: {
        Args: { p_order_id: string; p_email: string };
        Returns: undefined;
      };
      set_proxy_qr_active: {
        Args: { p_order_id: string; p_email: string; p_active: boolean };
        Returns: undefined;
      };
      create_order_group: {
        Args: {
          p_listing_id: string;
          p_item_name: string;
          p_split_type: number;
          p_invited_emails?: string[];
          p_visibility?: GroupVisibility;
        };
        Returns: { group_id: string; open_token: string | null };
      };
      join_or_create_public_group: {
        Args: { p_listing_id: string; p_item: string; p_total_people: number };
        Returns: { group_id: string; open_token?: string | null; joined: boolean };
      };
      invite_to_group: {
        Args: { p_group_id: string; p_emails: string[] };
        Returns: undefined;
      };
      accept_group_invite: {
        Args: { p_token: string };
        Returns: string;
      };
      decline_group_invite: {
        Args: { p_token: string };
        Returns: undefined;
      };
      get_group_by_token: {
        Args: { p_token: string };
        Returns: GroupDetails | null;
      };
      get_my_groups: {
        Args: Record<string, never>;
        Returns: GroupDetails[];
      };
      get_my_group_invites: {
        Args: Record<string, never>;
        Returns: GroupDetails[];
      };
      get_club_groups: {
        Args: Record<string, never>;
        Returns: GroupDetails[];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
