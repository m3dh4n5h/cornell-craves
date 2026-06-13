import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useProfile } from "@/hooks/useProfile";
import { Navbar } from "@/components/Navbar";
import { BottomNav } from "@/components/BottomNav";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SkeletonCard } from "@/components/SkeletonCard";
import { Toaster } from "@/components/ui/toaster";

const Home = lazy(() => import("@/pages/Home"));
const ListingDetail = lazy(() => import("@/pages/ListingDetail"));
const Register = lazy(() => import("@/pages/Register"));
const Login = lazy(() => import("@/pages/Login"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Cravings = lazy(() => import("@/pages/Cravings"));
const Admin = lazy(() => import("@/pages/Admin"));
const MapPage = lazy(() => import("@/pages/MapPage"));
const MyReservations = lazy(() => import("@/pages/MyReservations"));
const ClubAnalytics = lazy(() => import("@/pages/ClubAnalytics"));
const ClubTemplates = lazy(() => import("@/pages/ClubTemplates"));
const ClubReservations = lazy(() => import("@/pages/ClubReservations"));
const Onboarding = lazy(() => import("@/pages/Onboarding"));
const Preferences = lazy(() => import("@/pages/Preferences"));
const AccountSettings = lazy(() => import("@/pages/AccountSettings"));
const OrderForm = lazy(() => import("@/pages/OrderForm"));
const MyOrders = lazy(() => import("@/pages/MyOrders"));
const OrderDetail = lazy(() => import("@/pages/OrderDetail"));
const ClubOrders = lazy(() => import("@/pages/ClubOrders"));
const InvitePage = lazy(() => import("@/pages/InvitePage"));
const Terms = lazy(() => import("@/pages/Terms"));

function PageFallback() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10" aria-busy="true" aria-label="Loading page">
      <div className="h-9 w-56 animate-pulse rounded-xl bg-border/70" />
      <div className="mt-3 h-4 w-80 max-w-full animate-pulse rounded-md bg-border/50" />
      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

const ONBOARDING_EXEMPT_PREFIXES = [
  "/onboarding",
  "/preferences",
  "/account",
  "/login",
  "/register",
  "/invite",
];

/**
 * After a Google sign-in, students without Cornell details get routed to
 * onboarding once. Clubs and the admin are exempt.
 */
function OnboardingGate() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const { profile, loading: profileLoading } = useProfile();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || clubLoading || profileLoading) return;
    if (!user || club || isAdmin) return;
    if (ONBOARDING_EXEMPT_PREFIXES.some((prefix) => location.pathname.startsWith(prefix))) return;
    if (!profile?.cornell_netid) {
      navigate("/onboarding", { replace: true });
    }
  }, [
    authLoading,
    clubLoading,
    profileLoading,
    user,
    club,
    isAdmin,
    profile,
    location.pathname,
    navigate,
  ]);

  return null;
}

// Routes a club owner may never see (consumer pages). Feed ("/") is handled
// separately as an exact match.
const CLUB_BLOCKED_PREFIXES = ["/map", "/cravings", "/orders", "/reservations"];

/**
 * Keeps the two roles apart: club owners are confined to their Dashboard,
 * Account, and club-management pages; students never see the club Dashboard or
 * club tools.
 */
function RoleGate() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (authLoading || clubLoading) return;
    const path = location.pathname;
    if (club) {
      const blocked =
        path === "/" || CLUB_BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix));
      if (blocked) navigate("/dashboard", { replace: true });
    } else if (user && !isAdmin) {
      if (path === "/dashboard" || path.startsWith("/club/")) {
        navigate("/", { replace: true });
      }
    }
  }, [authLoading, clubLoading, club, user, isAdmin, location.pathname, navigate]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <OnboardingGate />
        <RoleGate />
        <div className="flex min-h-dvh flex-col pb-14 md:pb-0">
          <Navbar />
          <main className="flex-1">
            <Routes>
              <Route path="/" element={<Screen><Home /></Screen>} />
              <Route path="/listing/:id" element={<Screen><ListingDetail /></Screen>} />
              <Route path="/listing/:id/order-form" element={<Screen><OrderForm /></Screen>} />
              <Route path="/listing/:id/:tab" element={<Screen><ListingDetail /></Screen>} />
              <Route path="/register" element={<Screen><Register /></Screen>} />
              <Route path="/login" element={<Screen><Login /></Screen>} />
              <Route path="/onboarding" element={<Screen><Onboarding /></Screen>} />
              <Route path="/preferences" element={<Screen><Preferences /></Screen>} />
              <Route path="/account/settings" element={<Screen><AccountSettings /></Screen>} />
              <Route path="/dashboard" element={<Screen><Dashboard /></Screen>} />
              <Route path="/cravings" element={<Screen><Cravings /></Screen>} />
              <Route path="/admin" element={<Screen><Admin /></Screen>} />
              <Route path="/map" element={<Screen><MapPage /></Screen>} />
              <Route path="/orders" element={<Screen><MyOrders /></Screen>} />
              <Route path="/orders/:id" element={<Screen><OrderDetail /></Screen>} />
              <Route path="/invite/:token" element={<Screen><InvitePage /></Screen>} />
              <Route path="/reservations" element={<Screen><MyReservations /></Screen>} />
              <Route path="/club/:clubId/analytics" element={<Screen><ClubAnalytics /></Screen>} />
              <Route path="/club/:clubId/templates" element={<Screen><ClubTemplates /></Screen>} />
              <Route path="/club/:clubId/reservations-manager" element={<Screen><ClubReservations /></Screen>} />
              <Route path="/club/:clubId/orders-dashboard" element={<Screen><ClubOrders /></Screen>} />
              <Route path="/terms" element={<Screen><Terms /></Screen>} />
            </Routes>
          </main>
          <footer className="border-t border-border">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between">
              <span>Cornell Craves, built by students for students.</span>
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link to="/terms" className="font-semibold underline-offset-2 hover-fine:underline">
                  Terms and disclaimer
                </Link>
                <span aria-hidden="true" className="hidden sm:inline">
                  /
                </span>
                <span>Payments go directly to clubs. Not affiliated with Cornell University.</span>
              </span>
            </div>
          </footer>
        </div>
        <BottomNav />
        <Toaster />
      </AuthProvider>
    </BrowserRouter>
  );
}
