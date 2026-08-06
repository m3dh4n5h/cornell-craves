import { TourFrame, type TourDoneHandler } from "@/components/tour/TourFrame";
import { STUDENT_STEPS } from "@/components/tour/steps/studentSteps";

/** Own chunk: loaded only when a student walkthrough is actually opened. */
export default function StudentTour({ onDone }: { onDone: TourDoneHandler }) {
  return <TourFrame tour="student" steps={STUDENT_STEPS} onDone={onDone} />;
}
