import { TOUR_META, type TourKey, type TourStatus } from "@/lib/tour";
import { TourShell } from "@/components/tour/TourShell";
import { STUDENT_STEPS } from "@/components/tour/steps/studentSteps";
import { CLUB_STEPS } from "@/components/tour/steps/clubSteps";
import { ADMIN_STEPS } from "@/components/tour/steps/adminSteps";

const STEPS_BY_TOUR = {
  student: STUDENT_STEPS,
  club: CLUB_STEPS,
  admin: ADMIN_STEPS,
} as const;

interface TourRunnerProps {
  tour: TourKey;
  onDone: (status: TourStatus, lastStep: number) => void;
}

/**
 * Everything a walkthrough needs, in one lazily-loaded chunk: the shell, the
 * sandbox primitives, and all three step scripts. TourHost only imports this
 * once someone actually opens a tour, so the ~40 kB of tutorial never lands in
 * the main bundle for the majority of visits where nobody opens it.
 */
export default function TourRunner({ tour, onDone }: TourRunnerProps) {
  return (
    <TourShell
      open
      label={TOUR_META[tour].label}
      steps={STEPS_BY_TOUR[tour]}
      onSkip={(lastStep) => onDone("skipped", lastStep)}
      onFinish={(lastStep) => onDone("completed", lastStep)}
    />
  );
}
