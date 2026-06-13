import { NavLink } from "react-router-dom";
import { Flame, MapPinned, ReceiptText, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Feed", Icon: Flame, end: true },
  { to: "/map", label: "Map", Icon: MapPinned, end: false },
  { to: "/orders", label: "Orders", Icon: ReceiptText, end: false },
  { to: "/account/settings", label: "Account", Icon: UserRound, end: false },
];

/** Mobile app-shell tabs. Hidden at md+, where the top nav takes over. */
export function BottomNav() {
  return (
    <nav
      className="z-nav fixed inset-x-0 bottom-0 border-t border-border bg-surface-raised/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      aria-label="Primary"
    >
      <div className="grid grid-cols-4">
        {TABS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                isActive ? "text-ink" : "text-ink-muted",
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn("size-5", isActive && "text-primary-dark")}
                  fill={isActive ? "currentColor" : "none"}
                  aria-hidden="true"
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
