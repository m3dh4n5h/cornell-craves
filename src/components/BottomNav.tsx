import { NavLink } from "react-router-dom";
import {
  Flame,
  MapPinned,
  BellRing,
  ReceiptText,
  Ticket,
  UserRound,
  LayoutDashboard,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { cn } from "@/lib/utils";

type Tab = { to: string; label: string; Icon: LucideIcon; end?: boolean };

// Students (and signed-out visitors) get the consumer tabs.
const STUDENT_TABS: Tab[] = [
  { to: "/", label: "Feed", Icon: Flame, end: true },
  { to: "/map", label: "Map", Icon: MapPinned },
  { to: "/cravings", label: "Cravings", Icon: BellRing },
  { to: "/orders", label: "Orders", Icon: ReceiptText },
  { to: "/reservations", label: "Pickups", Icon: Ticket },
  { to: "/account/settings", label: "Account", Icon: UserRound },
];

// Admins see everything students do, plus the Admin console.
const ADMIN_TABS: Tab[] = [...STUDENT_TABS, { to: "/admin", label: "Admin", Icon: ShieldCheck }];

// Club owners only manage their club: Dashboard + Account.
const CLUB_TABS: Tab[] = [
  { to: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { to: "/account/settings", label: "Account", Icon: UserRound },
];

const GRID_COLS: Record<number, string> = {
  2: "grid-cols-2",
  6: "grid-cols-6",
  7: "grid-cols-7",
};

/** Mobile app-shell tabs. Hidden at md+, where the top nav takes over. */
export function BottomNav() {
  const { isAdmin } = useAuth();
  const { club } = useClub();
  const tabs = club ? CLUB_TABS : isAdmin ? ADMIN_TABS : STUDENT_TABS;

  return (
    <nav
      className="z-nav fixed inset-x-0 bottom-0 border-t border-border bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="Primary"
    >
      <div className={cn("grid", GRID_COLS[tabs.length])}>
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
