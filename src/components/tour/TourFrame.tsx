import { TOUR_META, type TourKey, type TourStatus } from "@/lib/tour";
import { TourShell, type TourStep } from "@/components/tour/TourShell";

export type TourDoneHandler = (status: TourStatus, lastStep: number) => void;

/**
 * Thin adapter between a step script and the walkthrough shell, so each tour
 * module in ./tours is four lines and the shell stays the only place that knows
 * about navigation, progress, and skipping.
 */
export function TourFrame({
  tour,
  steps,
  onDone,
}: {
  tour: TourKey;
  steps: TourStep[];
  onDone: TourDoneHandler;
}) {
  return (
    <TourShell
      open
      label={TOUR_META[tour].label}
      steps={steps}
      onSkip={(lastStep) => onDone("skipped", lastStep)}
      onFinish={(lastStep) => onDone("completed", lastStep)}
    />
  );
}
