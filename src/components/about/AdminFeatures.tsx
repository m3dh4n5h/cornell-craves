import { BarChart3, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { FeatureList, type Feature } from "@/components/about/FeatureList";

/**
 * The admin half of the About page, in its own chunk.
 *
 * About.tsx only imports this once the viewer is confirmed as the admin, so a
 * description of the moderation and approval tooling is not sitting in the
 * bundle every student and club downloads. UI gating already hides the tab;
 * this keeps the copy itself off non-admin machines.
 */
const ADMIN_FEATURES: Feature[] = [
  {
    Icon: ShieldCheck,
    title: "Club approvals",
    body: "The gate between someone signing up and a club selling food on the platform. Nothing a club does is visible until an admin clears it. Approving sends a welcome email and unlocks the dashboard.",
  },
  {
    Icon: Sparkles,
    title: "Brand requests",
    body: "Three outcomes, and they are not interchangeable: approve for this club only (durable, so they never re-request), add to the global approved list for everyone, or reject. Approving releases the drafts the club had held.",
  },
  {
    Icon: Lock,
    title: "Per-club grants and moderation",
    body: "Every durable grant is listed and revocable. Every listing on the platform can be hidden and restored, which pulls a drop off the feed without deleting anything or cancelling existing orders.",
  },
  {
    Icon: BarChart3,
    title: "Platform insights",
    body: "Revenue over time, revenue by brand, peak ordering hours, and the eight-tile overview of clubs, students, orders, drops, reservations, and pending requests.",
  },
];

export default function AdminFeatures() {
  return <FeatureList features={ADMIN_FEATURES} />;
}
