import { TourFrame, type TourDoneHandler } from "@/components/tour/TourFrame";
import { CLUB_STEPS } from "@/components/tour/steps/clubSteps";

/** Own chunk: loaded only when a club walkthrough is actually opened. */
export default function ClubTour({ onDone }: { onDone: TourDoneHandler }) {
  return <TourFrame tour="club" steps={CLUB_STEPS} onDone={onDone} />;
}
