import { NavLink } from "react-router-dom";
import {
  Flame,
  MapPinned,
  BellRing,
  ReceiptText,
  Ticket,
  UserRound,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { useClub } from "@/hooks/useClub";
import { cn } from "@/lib/utils";

type Tab = { to: string; label: string; Icon: LucideIcon; end?: boolean };

// Shared consumer destinations. Clubs get these too (they can browse, crave,
// order and pick up like anyone), plus their Dashboard in the last slot.
const BASE_TABS: Tab[] = [
  { to: "/", label: "Feed", Icon: Flame, end: true },
  { to: "/map", label: "Map", Icon: MapPinned },
  { to: "/cravings", label: "Cravings", Icon: BellRing },
  { to: "/orders", label: "Orders", Icon: ReceiptText },
  { to: "/reservations", label: "Pickups", Icon: Ticket },
];

/** Mobile app-shell tabs. Hidden at md+, where the top nav takes over. */
export function BottomNav() {
  const { club } = useClub();

  // Clubs manage from the Dashboard and have no student Account page; everyone
  // else gets Account in the final slot.
  const lastTab: Tab = club
    ? { to: "/dashboard", label: "Dashboard", Icon: LayoutDashboard }
    : { to: "/account/settings", label: "Account", Icon: UserRound };
  const tabs = [...BASE_TABS, lastTab];

  return (
    <nav
      className="z-nav fixed inset-x-0 bottom-0 border-t border-border bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="Primary"
    >
      <div className="grid grid-cols-6">
        {tabs.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                isActive ? "text-ink" : "text-ink-muted",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn("size-5 shrink-0", isActive && "text-primary-dark")}
                  fill={isActive ? "currentColor" : "none"}
                  aria-hidden="true"
                />
                <span className="w-full truncate text-center leading-none">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
