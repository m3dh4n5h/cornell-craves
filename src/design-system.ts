/**
 * Cornell Craves design system surface.
 *
 * The components re-exported here are the reusable, presentation-only parts of
 * the app: each renders from its props alone, with no router, auth, Supabase, or
 * device-API coupling. That is what makes them safe to render outside the app
 * (in Claude Design, a docs page, or a test) and what keeps this list meaningful
 * as "the design system" rather than "every component we happen to have".
 *
 * Deliberately excluded: ListingCard (react-router), ReviewCard (Supabase),
 * BottomNav (router + auth + club context), QRScanner (camera), and the page
 * chrome. Those are app components, not design-system parts.
 *
 * This module is also the entry point design-sync bundles, so adding a
 * component here is what publishes it to the design system.
 */

// Toaster is useless without the function that fires into it, and importing
// `toast` straight from sonner elsewhere would create a second store instance
// that this Toaster never listens to. Re-export the one bound to this bundle.
export { toast } from "sonner";

// Form controls and primitives
export { Badge } from "./components/ui/badge";
export { Button } from "./components/ui/button";
export { Combobox } from "./components/ui/combobox";
export { DateTimeField } from "./components/ui/datetime";
export { Input } from "./components/ui/input";
export { Label } from "./components/ui/label";
export { Select } from "./components/ui/select";
export { Textarea } from "./components/ui/textarea";
export { Toaster } from "./components/ui/toaster";

// Content and status display
export { AllergenIcon } from "./components/AllergenIcon";
export { DeadlineTimer } from "./components/DeadlineTimer";
export { DietaryTag } from "./components/DietaryTag";
export { EmptyState } from "./components/EmptyState";
export { RatingStars } from "./components/RatingStars";
export { SkeletonCard } from "./components/SkeletonCard";
export { TemplateCard } from "./components/TemplateCard";

// Ordering and payment
export { GroupInviteLink } from "./components/GroupInviteLink";
export { SplitOrderToggle } from "./components/SplitOrderToggle";
export { SplitTypeSelector } from "./components/SplitTypeSelector";
export { VenmoButton } from "./components/VenmoButton";
