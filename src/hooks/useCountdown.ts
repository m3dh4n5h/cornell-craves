import { useEffect, useState } from "react";
import { getTimeLeft, type TimeLeft } from "@/lib/format";

/** Live countdown that re-renders every 30 seconds. */
export function useCountdown(expiresAt: string): TimeLeft {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => getTimeLeft(expiresAt));

  useEffect(() => {
    setTimeLeft(getTimeLeft(expiresAt));
    const id = window.setInterval(() => {
      setTimeLeft(getTimeLeft(expiresAt));
    }, 30_000);
    return () => window.clearInterval(id);
  }, [expiresAt]);

  return timeLeft;
}
