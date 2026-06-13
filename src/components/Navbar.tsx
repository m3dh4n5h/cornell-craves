import { Link, NavLink, useNavigate } from "react-router-dom";
import { Flame } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
    isActive ? "bg-primary/25 text-ink" : "text-ink-muted hover-fine:bg-primary/15 hover-fine:text-ink",
  );
}

export function Navbar() {
  const { user, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/");
  };

  return (
    <header className="z-nav sticky top-0 border-b border-border bg-surface/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-2 px-4">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2 rounded-xl"
          aria-label="Cornell Craves home"
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-primary">
            <Flame className="size-5 text-on-primary" aria-hidden="true" />
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight">
            Cornell Craves
          </span>
        </Link>

        {/* On mobile the bottom tab bar carries navigation; the top bar stays clean. */}
        <div className="hidden items-center gap-2 md:flex">
          <NavLink to="/" end className={navLinkClass}>
            Feed
          </NavLink>
          <NavLink to="/map" className={navLinkClass}>
            Map
          </NavLink>
          <NavLink to="/cravings" className={navLinkClass}>
            Cravings
          </NavLink>
          <NavLink to="/orders" className={navLinkClass}>
            Orders
          </NavLink>
          <NavLink to="/reservations" className={navLinkClass}>
            Pickups
          </NavLink>
          {user ? (
            <>
              <NavLink to="/dashboard" className={navLinkClass}>
                Dashboard
              </NavLink>
              {isAdmin && (
                <NavLink to="/admin" className={navLinkClass}>
                  Admin
                </NavLink>
              )}
              <NavLink to="/account/settings" className={navLinkClass}>
                Account
              </NavLink>
              <Button variant="ghost" size="sm" onClick={handleSignOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Button variant="secondary" size="sm" onClick={() => navigate("/login")}>
              Sign in
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
}
