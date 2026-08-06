import { TourFrame, type TourDoneHandler } from "@/components/tour/TourFrame";
import { ADMIN_STEPS } from "@/components/tour/steps/adminSteps";

/**
 * Own chunk, and the reason the tours are split at all: this walkthrough
 * describes the approval and moderation tooling, so its copy should never land
 * on a student's or a club's machine. `useTour().canOpen` refuses to open it
 * for anyone but the admin, which means this file is never fetched for them.
 */
export default function AdminTour({ onDone }: { onDone: TourDoneHandler }) {
  return <TourFrame tour="admin" steps={ADMIN_STEPS} onDone={onDone} />;
}
