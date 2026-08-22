// Seeded demo data for VITE_MOCK=1 (screenshots + offline UI work).
// Everything is deterministic so captures are reproducible.
//
// All club, org, and cause names here are FICTIONAL placeholders invented for
// demos. They intentionally do not match any real Cornell student organization,
// to avoid implying a real club uses or endorses this app.
import type {
  AdminInsights,
  CampusLocation,
  Club,
  ListingWithClub,
  PickupSlot,
  QAEntry,
  RecurringTemplate,
  Review,
} from "@/types/database";

const now = Date.now();
const hours = (n: number) => new Date(now + n * 3_600_000).toISOString();
const daysAgo = (n: number, h = 12) => new Date(now - n * 86_400_000 + h * 3_600_000).toISOString();

export const MOCK_ADMIN_EMAIL = "demo-admin@cornellcraves.app";

export const mockUsers = {
  student: {
    id: "u-student",
    email: "cn284@cornell.edu",
    app_metadata: { provider: "google" },
    user_metadata: { full_name: "Casey Nguyen" },
    aud: "authenticated",
    created_at: daysAgo(90),
  },
  club: {
    id: "u-club",
    email: "willowlane.club@cornell.edu",
    app_metadata: { provider: "google" },
    user_metadata: { full_name: "Willow Lane Dance Crew" },
    aud: "authenticated",
    created_at: daysAgo(120),
  },
  admin: {
    id: "u-admin",
    email: MOCK_ADMIN_EMAIL,
    app_metadata: { provider: "google" },
    user_metadata: { full_name: "Site Admin" },
    aud: "authenticated",
    created_at: daysAgo(400),
  },
} as const;

export const locations: CampusLocation[] = [
  ["loc-duffield", "Duffield Atrium", 42.4442, -76.4823],
  ["loc-hoplaza", "Ho Plaza", 42.4472, -76.4852],
  ["loc-wsh", "Willard Straight Hall", 42.4466, -76.4855],
  ["loc-mann", "Mann Library", 42.4488, -76.4763],
  ["loc-rpcc", "RPCC", 42.4562, -76.4776],
  ["loc-statler", "Statler Hall", 42.4456, -76.4818],
].map(([id, name, latitude, longitude]) => ({
  id: id as string,
  name: name as string,
  latitude: latitude as number,
  longitude: longitude as number,
  description: null,
  pickup_type: "both",
  created_by: null,
  created_at: daysAgo(200),
}));

const clubRow = (
  id: string,
  name: string,
  email: string,
  venmo: string,
  members: string[] = [],
): Club => ({
  id,
  name,
  email,
  venmo,
  zelle_phone: "607-555-0134",
  approved: true,
  groups_enabled: true,
  logo_url: null,
  member_options: members,
  created_at: daysAgo(150),
});

export const clubs: Club[] = [
  clubRow("u-club", "Willow Lane Dance Crew", "willowlane.club@cornell.edu", "willow-lane-dance", [
    "Aarav",
    "Priya",
    "Sam",
  ]),
  clubRow("c-ewb", "Northbridge Builders Club", "northbridge.club@cornell.edu", "northbridge-builders"),
  clubRow("c-skate", "Silverblade Skating Club", "silverblade.club@cornell.edu", "silverblade-skate"),
];

const clubLite = (id: string) => {
  const club = clubs.find((c) => c.id === id)!;
  return {
    name: club.name,
    venmo: club.venmo,
    zelle_phone: club.zelle_phone,
    groups_enabled: club.groups_enabled,
    logo_url: club.logo_url,
    member_options: club.member_options,
  };
};

const spot = (
  listingId: string,
  locationId: string,
  orderType: "preorder" | "same_day" | "both",
) => {
  const location = locations.find((l) => l.id === locationId)!;
  return {
    id: `${listingId}-${locationId}`,
    listing_id: listingId,
    location_id: locationId,
    order_type: orderType,
    available_start: null,
    available_end: null,
    hours_note: null,
    created_at: daysAgo(2),
    campus_locations: {
      id: location.id,
      name: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      description: null,
    },
  };
};

export const listings: ListingWithClub[] = [
  {
    id: "l-kk",
    club_id: "u-club",
    brand: "Krispy Kreme",
    title: "Glazed dozens outside Duffield",
    description:
      "Fresh from the Syracuse store that morning. Every box helps send our team to nationals, and a fifth of it goes to a local food pantry.",
    items: [
      { name: "Glazed dozen", price: 14.99, quantity: 12, dietary_tags: ["vegetarian"] },
      { name: "Chocolate iced dozen", price: 16.99, quantity: 12, dietary_tags: ["vegetarian"] },
      { name: "Single glazed", price: 1.75 },
    ],
    pickup_info: "Duffield atrium, 4 to 7 pm",
    pickup_location_id: "loc-duffield",
    contact_email: "willowlane.club@cornell.edu",
    recommender_enabled: true,
    cause_name: "Campus Food Pantry",
    cause_percent: 20,
    draft: false,
    auto_post_on_brand: false,
    approved_brand: null,
    avg_rating: 4.8,
    review_count: 23,
    expires_at: hours(26),
    active: true,
    created_at: daysAgo(1),
    payment_updated_at: null,
    clubs: clubLite("u-club"),
    listing_pickup_spots: [spot("l-kk", "loc-duffield", "preorder"), spot("l-kk", "loc-hoplaza", "same_day")],
  },
  {
    id: "l-crumbl",
    club_id: "c-skate",
    brand: "Crumbl",
    title: "Crumbl party box drop",
    description: "This week's rotating flavors. Split a party box with friends, everyone gets their own pass.",
    items: [
      { name: "Party box", price: 34.99, quantity: 12, dietary_tags: ["vegetarian"] },
      { name: "4-pack", price: 15.99, quantity: 4, dietary_tags: ["vegetarian"] },
    ],
    pickup_info: "Willard Straight lobby, 5 to 8 pm",
    pickup_location_id: "loc-wsh",
    contact_email: "silverblade.club@cornell.edu",
    recommender_enabled: false,
    cause_name: null,
    cause_percent: null,
    draft: false,
    auto_post_on_brand: false,
    approved_brand: null,
    avg_rating: 4.6,
    review_count: 11,
    expires_at: hours(49),
    active: true,
    created_at: daysAgo(2),
    payment_updated_at: null,
    clubs: clubLite("c-skate"),
    listing_pickup_spots: [spot("l-crumbl", "loc-wsh", "preorder")],
  },
  {
    id: "l-cfa",
    club_id: "c-ewb",
    brand: "Chick-fil-A",
    title: "Sandwich run, pick up at Statler",
    description: "Original chicken sandwiches and nuggets, driven up from Syracuse. Funds our clean-water build trip.",
    items: [
      { name: "Chicken sandwich", price: 9.5 },
      { name: "Nuggets, 8 count", price: 6.75 },
    ],
    pickup_info: "Statler front steps, 12 to 2 pm",
    pickup_location_id: "loc-statler",
    contact_email: "northbridge.club@cornell.edu",
    recommender_enabled: false,
    cause_name: "Clean-Water Build Trip",
    cause_percent: 100,
    draft: false,
    auto_post_on_brand: false,
    approved_brand: null,
    avg_rating: 4.9,
    review_count: 35,
    expires_at: hours(8),
    active: true,
    created_at: daysAgo(1, 6),
    payment_updated_at: null,
    clubs: clubLite("c-ewb"),
    listing_pickup_spots: [spot("l-cfa", "loc-statler", "both")],
  },
  {
    id: "l-trh",
    club_id: "c-skate",
    brand: "Texas Roadhouse",
    title: "Rolls & cinnamon butter, Willard Straight",
    description: "The rolls. You know the ones. Dozen per box with a tub of cinnamon butter.",
    items: [{ name: "Dozen rolls + butter", price: 12.0, quantity: 12, dietary_tags: ["vegetarian"] }],
    pickup_info: "Willard Straight lobby, 6 to 8 pm",
    pickup_location_id: "loc-wsh",
    contact_email: "silverblade.club@cornell.edu",
    recommender_enabled: false,
    cause_name: null,
    cause_percent: null,
    draft: false,
    auto_post_on_brand: false,
    approved_brand: null,
    avg_rating: 4.7,
    review_count: 9,
    expires_at: hours(30),
    active: true,
    created_at: daysAgo(3),
    payment_updated_at: null,
    clubs: clubLite("c-skate"),
    listing_pickup_spots: [spot("l-trh", "loc-wsh", "preorder")],
  },
  {
    id: "l-insomnia",
    club_id: "u-club",
    brand: "Insomnia Cookies",
    title: "Late-night cookie drop at RPCC",
    description: "Warm six-packs delivered to North. Ends tonight.",
    items: [
      { name: "Classic 6-pack", price: 11.5, quantity: 6, dietary_tags: ["vegetarian"] },
      { name: "Deluxe 4-pack", price: 13.25, quantity: 4, dietary_tags: ["vegetarian"] },
    ],
    pickup_info: "RPCC lobby, 9 to 11 pm",
    pickup_location_id: "loc-rpcc",
    contact_email: "willowlane.club@cornell.edu",
    recommender_enabled: true,
    cause_name: null,
    cause_percent: null,
    draft: false,
    auto_post_on_brand: false,
    approved_brand: null,
    avg_rating: 0,
    review_count: 0,
    expires_at: hours(3),
    active: true,
    created_at: daysAgo(0, -6),
    payment_updated_at: null,
    clubs: clubLite("u-club"),
    listing_pickup_spots: [spot("l-insomnia", "loc-rpcc", "same_day")],
  },
  // A draft the club sees on its dashboard (brand pending admin approval).
  {
    id: "l-levain",
    club_id: "u-club",
    brand: "Levain Bakery",
    title: "Levain giant cookies (NYC run)",
    description: "Six-ounce cookies from the city. Pre-orders only.",
    items: [{ name: "Two-pack", price: 12.0, quantity: 2, dietary_tags: ["vegetarian"] }],
    pickup_info: null,
    pickup_location_id: null,
    contact_email: "willowlane.club@cornell.edu",
    recommender_enabled: false,
    cause_name: null,
    cause_percent: null,
    draft: true,
    auto_post_on_brand: false,
    approved_brand: null,
    avg_rating: 0,
    review_count: 0,
    expires_at: hours(96),
    active: false,
    created_at: daysAgo(0, 2),
    payment_updated_at: null,
    clubs: clubLite("u-club"),
    listing_pickup_spots: [],
  },
];

export const reviews: Review[] = [
  {
    id: "r1",
    listing_id: "l-kk",
    reviewer_email: "mv92@cornell.edu",
    reviewer_name: "Maya V.",
    rating: 5,
    title: "Still warm somehow",
    body: "Picked up between classes and the box was gone by 3pm. The pickup QR took five seconds.",
    club_response: "Thanks Maya! Same spot next Friday.",
    response_date: daysAgo(0, 4),
    helpful_count: 12,
    created_at: daysAgo(0, 9),
    updated_at: daysAgo(0, 9),
  },
  {
    id: "r2",
    listing_id: "l-kk",
    reviewer_email: "jd450@cornell.edu",
    reviewer_name: "Jordan D.",
    rating: 5,
    title: "Cheaper than driving to Syracuse",
    body: "Split a chocolate dozen with my roommates through the group order thing. Painless.",
    club_response: null,
    response_date: null,
    helpful_count: 8,
    created_at: daysAgo(1, 15),
    updated_at: daysAgo(1, 15),
  },
  {
    id: "r3",
    listing_id: "l-kk",
    reviewer_email: "ap388@cornell.edu",
    reviewer_name: "Alex P.",
    rating: 4,
    title: "Sold out fast",
    body: "Get there early. The single glazed line moved quick but dozens were gone in an hour.",
    club_response: null,
    response_date: null,
    helpful_count: 3,
    created_at: daysAgo(1, 10),
    updated_at: daysAgo(1, 10),
  },
];

export const qaEntries: QAEntry[] = [
  {
    id: "q1",
    listing_id: "l-kk",
    question_email: "hash-1",
    question: "Any gluten-free options this time?",
    club_response:
      "Not this run, sorry! Krispy Kreme doesn't do GF. We're looking at a GF bakery for later this semester.",
    response_date: daysAgo(0, 6),
    helpful_count: 6,
    answer_helpful_count: 4,
    question_user_id: null,
    created_at: daysAgo(0, 10),
  },
  {
    id: "q2",
    listing_id: "l-kk",
    question_email: "hash-2",
    question: "Can a friend pick mine up if I have a lecture?",
    club_response:
      "Yes! Add them as a proxy when you order and they get their own QR pass by email.",
    response_date: daysAgo(1, 2),
    helpful_count: 9,
    answer_helpful_count: 7,
    question_user_id: null,
    created_at: daysAgo(1, 8),
  },
  {
    id: "q3",
    listing_id: "l-kk",
    question_email: "hash-3",
    question: "Do you take Zelle or just Venmo?",
    club_response: null,
    response_date: null,
    helpful_count: 1,
    answer_helpful_count: 0,
    question_user_id: null,
    created_at: daysAgo(0, 2),
  },
];

export const pickupSlots: PickupSlot[] = [
  {
    id: "slot-1",
    listing_id: "l-kk",
    start_time: hours(22),
    end_time: hours(25),
    max_reservations: 20,
    reserved_count: 12,
    location_id: "loc-duffield",
    created_at: daysAgo(1),
  },
  {
    id: "slot-2",
    listing_id: "l-kk",
    start_time: hours(46),
    end_time: hours(49),
    max_reservations: 15,
    reserved_count: 3,
    location_id: "loc-hoplaza",
    created_at: daysAgo(1),
  },
];

export const profileRow = {
  id: "u-student",
  first_name: "Casey",
  last_name: "Nguyen",
  cornell_netid: "cn284",
  cornell_email: "cn284@cornell.edu",
  venmo_id: "casey-nguyen",
  zelle_id: "cn284@cornell.edu",
  phone: null,
  preferences_json: { brands: ["Krispy Kreme", "Crumbl", "Insomnia Cookies"], dietary: ["vegetarian"] },
  created_at: daysAgo(90),
  updated_at: daysAgo(5),
};

// ---- Student order history (get_my_orders) ----

const qr = (orderId: string, type: "orderer" | "proxy", scanned: boolean, code: string) => ({
  id: `${orderId}-${type}`,
  order_id: orderId,
  user_type: type,
  qr_encrypted: `${orderId}.${type}.demo-signed-token-3f8a1c`,
  is_active: !scanned,
  pickup_code: code,
  scanned_at: scanned ? daysAgo(0, 5) : null,
  scanned_by_user_type: scanned ? type : null,
  created_at: daysAgo(1),
});

export const myOrders = [
  {
    id: "o-1001",
    listing_id: "l-kk",
    user_id: "u-student",
    orderer_name: "Casey Nguyen",
    orderer_email: "cn284@cornell.edu",
    orderer_netid: "cn284",
    items_json: [
      { name: "Glazed dozen", price: 14.99, qty: 1 },
      { name: "Single glazed", price: 1.75, qty: 2 },
    ],
    total: 18.49,
    payment_method: "venmo",
    payment_details_json: { venmo: "casey-nguyen" },
    payment_verified: true,
    status: "qr_sent",
    proxy_name: "Riley Park",
    proxy_email: "rp552@cornell.edu",
    proxy_netid: "rp552",
    picked_up_by_name: null,
    picked_up_by_email: null,
    picked_up_at: null,
    created_at: daysAgo(0, 8),
    listing_title: "Glazed dozens outside Duffield",
    brand: "Krispy Kreme",
    pickup_info: "Duffield atrium, 4 to 7 pm",
    location_name: "Duffield Atrium",
    expires_at: hours(26),
    club_name: "Willow Lane Dance Crew",
    contact_email: "willowlane.club@cornell.edu",
    qr_codes: [qr("o-1001", "orderer", false, "7K3MPQ9T2X"), qr("o-1001", "proxy", false, "M2XW8HJ4RV")],
  },
  {
    id: "o-1002",
    listing_id: "l-crumbl",
    user_id: "u-student",
    orderer_name: "Casey Nguyen",
    orderer_email: "cn284@cornell.edu",
    orderer_netid: "cn284",
    items_json: [{ name: "4-pack", price: 15.99, qty: 1 }],
    total: 15.99,
    payment_method: "both",
    payment_details_json: { venmo: "casey-nguyen", zelle: "cn284@cornell.edu" },
    payment_verified: false,
    status: "pending_payment",
    proxy_name: null,
    proxy_email: null,
    proxy_netid: null,
    picked_up_by_name: null,
    picked_up_by_email: null,
    picked_up_at: null,
    created_at: daysAgo(0, 2),
    listing_title: "Crumbl party box drop",
    brand: "Crumbl",
    pickup_info: "Willard Straight lobby, 5 to 8 pm",
    location_name: "Willard Straight Hall",
    expires_at: hours(49),
    club_name: "Silverblade Skating Club",
    contact_email: "silverblade.club@cornell.edu",
    qr_codes: [qr("o-1002", "orderer", false, "TBD0000000")],
  },
];

// Signed-in students read orders straight from the table (RLS) with listings +
// QR rows embedded, then map them client-side. Reshape myOrders to that row
// shape so the authed order pages render under the mock.
export const authedOrders = myOrders.map((order) => {
  const { listing_title, brand, pickup_info, location_name, expires_at, club_name, contact_email, qr_codes, ...base } = order;
  return {
    ...base,
    listings: {
      title: listing_title,
      brand,
      pickup_info,
      contact_email,
      expires_at,
      campus_locations: location_name ? { name: location_name } : null,
      clubs: club_name ? { name: club_name } : null,
    },
    order_qr_codes: qr_codes,
  };
});

// ---- Split groups ----

const groupMembers = [
  { id: "gm-1", user_id: "u-student", name: "Casey Nguyen", status: "paid", scanned_at: null, is_creator: true, payment_method: "venmo", payment_handle: "casey-nguyen" },
  { id: "gm-2", user_id: "u-x2", name: "Priya Shah", status: "paid", scanned_at: null, is_creator: false, payment_method: "zelle", payment_handle: "ps482@cornell.edu" },
  { id: "gm-3", user_id: "u-x3", name: "Marcus Lee", status: "pending_payment", scanned_at: null, is_creator: false, payment_method: null, payment_handle: null },
];

export const myGroups = [
  {
    id: "g-1",
    listing_id: "l-crumbl",
    item_name: "Party box",
    item_price: 34.99,
    item_quantity: 12,
    split_type: 4,
    total_people: 4,
    filled_count: 3,
    deadline: hours(18),
    order_deadline: hours(18),
    status: "filling",
    visibility: "public",
    created_by: "u-student",
    created_at: daysAgo(0, 5),
    listing_title: "Crumbl party box drop",
    brand: "Crumbl",
    listing_active: true,
    club_name: "Silverblade Skating Club",
    club_venmo: "silverblade-skate",
    club_zelle: "607-555-0134",
    share_amount: 8.75,
    units_per_person: 3,
    open_token: "demo-open-token",
    recommender_enabled: true,
    member_options: ["Aarav", "Priya", "Sam"],
    members: groupMembers,
    my_status: "paid",
    my_member_id: "gm-1",
  },
];

export const clubGroups = [
  {
    ...myGroups[0],
    id: "g-2",
    listing_id: "l-kk",
    item_name: "Chocolate iced dozen",
    item_price: 16.99,
    item_quantity: 12,
    split_type: 4,
    total_people: 4,
    filled_count: 4,
    deadline: hours(20),
    order_deadline: hours(-3),
    status: "payment_in_progress",
    listing_title: "Glazed dozens outside Duffield",
    brand: "Krispy Kreme",
    club_name: "Willow Lane Dance Crew",
    club_venmo: "willow-lane-dance",
    share_amount: 4.25,
    units_per_person: 3,
    // Legacy group-level pick (migration 043), kept alongside the new
    // per-member field below so both old and new payload shapes render.
    recommended_by: "Aarav",
    // email + netid come from get_club_groups only (migration 053): the club
    // owning the drop sees its buyers' contact details, students do not see
    // each other's.
    members: [
      { id: "gm-a", user_id: "u-a", name: "Dev Patel", status: "paid", scanned_at: null, is_creator: true, payment_method: "venmo", payment_handle: "dev-patel-3", recommended_by: "Aarav", email: "dp447@cornell.edu", netid: "dp447" },
      { id: "gm-b", user_id: "u-b", name: "Sofia Ramos", status: "pending_payment", scanned_at: null, is_creator: false, payment_method: "zelle", payment_handle: "607-555-0188", recommended_by: null, email: "sr291@cornell.edu", netid: "sr291" },
      { id: "gm-c", user_id: "u-c", name: "Tom Becker", status: "paid", scanned_at: null, is_creator: false, payment_method: "venmo", payment_handle: "tombecker", recommended_by: "Priya", email: "tb108@cornell.edu", netid: "tb108" },
      { id: "gm-d", user_id: "u-d", name: "Lena Fischer", status: "pending_payment", scanned_at: null, is_creator: false, payment_method: null, payment_handle: null, recommended_by: null, email: "lf523@cornell.edu", netid: "" },
    ],
  },
];

// ---- Club orders dashboard ----

const clubOrder = (
  id: string,
  listingId: string,
  name: string,
  netid: string,
  items: { name: string; price: number; qty: number }[],
  status: "pending_payment" | "qr_sent" | "picked_up",
  hoursAgo: number,
) => {
  const total = items.reduce((sum, line) => sum + line.price * line.qty, 0);
  const verified = status !== "pending_payment";
  return {
    id,
    listing_id: listingId,
    user_id: `u-${netid}`,
    orderer_name: name,
    orderer_email: `${netid}@cornell.edu`,
    orderer_netid: netid,
    items_json: items,
    total: Math.round(total * 100) / 100,
    payment_method: "venmo",
    payment_details_json: { venmo: netid },
    payment_verified: verified,
    status,
    proxy_name: null,
    proxy_email: null,
    proxy_netid: null,
    picked_up_by_name: status === "picked_up" ? name : null,
    picked_up_by_email: status === "picked_up" ? `${netid}@cornell.edu` : null,
    picked_up_at: status === "picked_up" ? daysAgo(0, hoursAgo - 2) : null,
    created_at: daysAgo(0, hoursAgo),
    order_qr_codes:
      status === "pending_payment" ? [] : [qr(id, "orderer", status === "picked_up", "DEMO000000")],
  };
};

export const clubOrders = [
  clubOrder("co-1", "l-kk", "Maya Villanueva", "mv92", [{ name: "Glazed dozen", price: 14.99, qty: 2 }], "pending_payment", 1),
  clubOrder("co-2", "l-kk", "Jordan Diaz", "jd450", [{ name: "Chocolate iced dozen", price: 16.99, qty: 1 }], "pending_payment", 2),
  clubOrder("co-3", "l-kk", "Alex Park", "ap388", [
    { name: "Glazed dozen", price: 14.99, qty: 1 },
    { name: "Single glazed", price: 1.75, qty: 3 },
  ], "qr_sent", 5),
  clubOrder("co-4", "l-kk", "Sam Osei", "so77", [{ name: "Glazed dozen", price: 14.99, qty: 1 }], "picked_up", 9),
  clubOrder("co-5", "l-insomnia", "Nina Rossi", "nr243", [{ name: "Classic 6-pack", price: 11.5, qty: 2 }], "qr_sent", 3),
  clubOrder("co-6", "l-insomnia", "Leo Zhang", "lz88", [{ name: "Deluxe 4-pack", price: 13.25, qty: 1 }], "pending_payment", 1),
];

// Verified orders spread over 30 days for the analytics charts.
export const analyticsOrders = (() => {
  const names = ["Maya Villanueva", "Jordan Diaz", "Alex Park", "Sam Osei", "Nina Rossi", "Leo Zhang", "Ana Silva", "Ben Roth"];
  const rows: Record<string, unknown>[] = [];
  for (let day = 29; day >= 0; day -= 1) {
    const orderCount = Math.max(0, Math.round(2 + 2.2 * Math.sin(day / 3) + (day % 7 === 2 ? 3 : 0)));
    for (let k = 0; k < orderCount; k += 1) {
      const buyer = names[(day + k * 3) % names.length];
      const netid = buyer.split(" ")[0].toLowerCase() + (100 + ((day * 7 + k) % 800));
      const glazed = 1 + ((day + k) % 2);
      rows.push({
        listing_id: (day + k) % 3 === 0 ? "l-insomnia" : "l-kk",
        total: Math.round((glazed * 14.99 + (k % 2) * 1.75) * 100) / 100,
        items_json: [
          { name: (day + k) % 3 === 0 ? "Classic 6-pack" : "Glazed dozen", price: (day + k) % 3 === 0 ? 11.5 : 14.99, qty: glazed },
          ...(k % 2 === 1 ? [{ name: "Single glazed", price: 1.75, qty: 1 }] : []),
        ],
        orderer_name: buyer,
        orderer_email: `${netid}@cornell.edu`,
        recommended_by: (day + k) % 4 === 0 ? ["Aarav", "Priya", "Sam"][(day + k) % 3] : null,
        created_at: daysAgo(day, 10 + ((day + k * 5) % 12)),
        payment_verified: true,
      });
    }
  }
  return rows;
})();

export const analyticsViews = (() => {
  const rows: Record<string, unknown>[] = [];
  for (let day = 29; day >= 0; day -= 1) {
    const views = Math.max(4, Math.round(14 + 9 * Math.sin(day / 2.5)));
    for (let k = 0; k < views; k += 1) {
      rows.push({
        listing_id: k % 3 === 0 ? "l-insomnia" : "l-kk",
        created_at: daysAgo(day, 8 + (k % 14)),
      });
    }
  }
  return rows;
})();

export const templates: RecurringTemplate[] = [
  {
    id: "t-1",
    club_id: "u-club",
    name: "Friday dozen drop",
    brand: "Krispy Kreme",
    description: "Weekly Friday afternoon run, Duffield atrium.",
    items: [
      { name: "Glazed dozen", price: 14.99, quantity: 12, dietary_tags: ["vegetarian"] },
      { name: "Chocolate iced dozen", price: 16.99, quantity: 12, dietary_tags: ["vegetarian"] },
    ],
    mode: "auto",
    frequency: "weekly",
    next_run_date: new Date(now + 2 * 86_400_000).toISOString().slice(0, 10),
    paused: false,
    created_at: daysAgo(40),
    updated_at: daysAgo(3),
  } as unknown as RecurringTemplate,
  {
    id: "t-2",
    club_id: "u-club",
    name: "Late-night cookies",
    brand: "Insomnia Cookies",
    description: "Prelim-week special at RPCC.",
    items: [{ name: "Classic 6-pack", price: 11.5, quantity: 6, dietary_tags: ["vegetarian"] }],
    mode: "one_time",
    frequency: null,
    next_run_date: null,
    paused: false,
    created_at: daysAgo(15),
    updated_at: daysAgo(15),
  } as unknown as RecurringTemplate,
];

export const clubStats = {
  live_drops: 2,
  held_drops: 1,
  orders_pending: 3,
  orders_total: 57,
  revenue: 812.4,
  upcoming_reservations: 15,
  pending_brands: 1,
};

export const brandRequests = [
  {
    id: "br-1",
    club_id: "u-club",
    requested_name: "Levain Bakery",
    status: "pending",
    created_at: daysAgo(0, 3),
  },
];

// ---- Admin fixtures ----

export const adminOverview = {
  clubs_total: 14,
  clubs_pending: 2,
  clubs_approved: 12,
  listings_total: 58,
  listings_active: 7,
  listings_draft: 3,
  orders_total: 341,
  orders_verified: 312,
  orders_pending: 9,
  revenue: 4821.5,
  students: 486,
  cravings: 231,
  reservations: 118,
  brand_requests_pending: 2,
  global_brands: 4,
};

export const adminClubs = [
  { id: "u-club", name: "Willow Lane Dance Crew", email: "willowlane.club@cornell.edu", approved: true, created_at: daysAgo(150), logo_url: null, venmo: "willow-lane-dance", listings: 12, active_listings: 2, orders: 96, revenue: 1420.8 },
  { id: "c-ewb", name: "Northbridge Builders Club", email: "northbridge.club@cornell.edu", approved: true, created_at: daysAgo(130), logo_url: null, venmo: "northbridge-builders", listings: 9, active_listings: 1, orders: 88, revenue: 1245.0 },
  { id: "c-skate", name: "Silverblade Skating Club", email: "silverblade.club@cornell.edu", approved: true, created_at: daysAgo(120), logo_url: null, venmo: "silverblade-skate", listings: 11, active_listings: 2, orders: 74, revenue: 1052.3 },
  { id: "c-new1", name: "Riverside Salsa Society", email: "riverside.club@cornell.edu", approved: false, created_at: daysAgo(1), logo_url: null, venmo: "riverside-salsa", listings: 0, active_listings: 0, orders: 0, revenue: 0 },
  { id: "c-new2", name: "Gearworks Robotics", email: "gearworks.club@cornell.edu", approved: false, created_at: daysAgo(0, 7), logo_url: null, venmo: null, listings: 0, active_listings: 0, orders: 0, revenue: 0 },
];

export const adminBrandRequests = [
  { id: "abr-1", requested_name: "Levain Bakery", status: "pending", created_at: daysAgo(0, 3), club_id: "u-club", club_name: "Willow Lane Dance Crew", club_email: "willowlane.club@cornell.edu", held_listings: 1 },
  { id: "abr-2", requested_name: "Dunkin'", status: "pending", created_at: daysAgo(1, 5), club_id: "c-ewb", club_name: "Northbridge Builders Club", club_email: "northbridge.club@cornell.edu", held_listings: 0 },
];

export const adminListings = listings.map((listing) => ({
  id: listing.id,
  title: listing.title,
  brand: listing.brand,
  club_id: listing.club_id,
  club_name: listing.clubs?.name ?? "",
  active: listing.active,
  draft: listing.draft,
  auto_post_on_brand: listing.auto_post_on_brand,
  expires_at: listing.expires_at,
  created_at: listing.created_at,
  orders: 8 + listing.title.length % 21,
}));

export const adminBrandRevenue = [
  { brand: "Krispy Kreme", revenue: 1685.5, orders: 118 },
  { brand: "Chick-fil-A", revenue: 1245.0, orders: 131 },
  { brand: "Crumbl", revenue: 887.6, orders: 41 },
  { brand: "Texas Roadhouse", revenue: 540.0, orders: 45 },
  { brand: "Insomnia Cookies", revenue: 463.4, orders: 38 },
];

export const adminGlobalBrands = [
  { id: "gb-1", name: "Texas Roadhouse", created_at: daysAgo(60) },
  { id: "gb-2", name: "Kung Fu Tea", created_at: daysAgo(45) },
  { id: "gb-3", name: "Halal Guys", created_at: daysAgo(30) },
  { id: "gb-4", name: "Collegetown Bagels", created_at: daysAgo(12) },
];

export const adminClubBrandApprovals = [
  { id: "cba-1", club_id: "c-skate", brand: "Trader Joe's", created_at: daysAgo(20), club_name: "Silverblade Skating Club" },
];

export const adminInsights: AdminInsights = {
  daily: Array.from({ length: 30 }, (_, index) => {
    const day = 29 - index;
    const revenue = Math.max(40, Math.round((150 + 95 * Math.sin(index / 3) + (index % 7 === 5 ? 120 : 0)) * 100) / 100);
    return {
      day: new Date(now - day * 86_400_000).toISOString().slice(0, 10),
      revenue,
      orders: Math.max(2, Math.round(revenue / 16)),
    };
  }),
  top_items: [
    { name: "Chicken sandwich", units: 214, revenue: 2033.0 },
    { name: "Glazed dozen", units: 96, revenue: 1439.0 },
    { name: "Party box", units: 41, revenue: 1434.6 },
    { name: "Dozen rolls + butter", units: 45, revenue: 540.0 },
    { name: "Classic 6-pack", units: 38, revenue: 437.0 },
    { name: "Nuggets, 8 count", units: 57, revenue: 384.8 },
  ],
  heatmap: (() => {
    const cells: { dow: number; hour: number; orders: number }[] = [];
    for (let dow = 0; dow < 7; dow += 1) {
      for (const hour of [11, 12, 13, 17, 18, 19, 21]) {
        const weekBoost = dow === 1 || dow === 2 ? 2 : 0;
        const lunch = hour <= 13 ? 3 : hour >= 21 ? 1 : 2;
        const orders = Math.max(0, lunch + weekBoost + ((dow * hour) % 3) - (dow === 6 ? 2 : 0));
        if (orders > 0) cells.push({ dow, hour, orders });
      }
    }
    return cells;
  })(),
  buyers_total: 342,
  buyers_repeat: 128,
  buyers_new_30d: 87,
  students_new_30d: 64,
  avg_order_value_30d: 15.42,
};

/** Admin roster fixture for the owner-only Admins tab (migration 046). */
export const adminRoster = [
  {
    email: MOCK_ADMIN_EMAIL,
    label: "You",
    role: "owner",
    status: "active",
    added_by: null,
    created_at: "2026-06-01T12:00:00Z",
    status_changed_at: null,
    status_changed_by: null,
  },
  {
    email: "second-admin@example.com",
    label: "Ops lead",
    role: "admin",
    status: "active",
    added_by: MOCK_ADMIN_EMAIL,
    created_at: "2026-07-14T09:30:00Z",
    status_changed_at: "2026-07-14T09:30:00Z",
    status_changed_by: MOCK_ADMIN_EMAIL,
  },
  {
    email: "former-admin@example.com",
    label: null,
    role: "admin",
    status: "suspended",
    added_by: MOCK_ADMIN_EMAIL,
    created_at: "2026-06-20T15:05:00Z",
    status_changed_at: "2026-08-01T11:00:00Z",
    status_changed_by: MOCK_ADMIN_EMAIL,
  },
];
