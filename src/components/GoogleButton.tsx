import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";

interface GoogleButtonProps {
  label?: string;
  /** Path to land on after the OAuth round-trip, e.g. an invite link. */
  redirectPath?: string;
}

export function GoogleButton({ label = "Continue with Google", redirectPath = "/" }: GoogleButtonProps) {
  const [loading, setLoading] = useState(false);

  const signIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + redirectPath },
    });
    if (error) {
      setLoading(false);
      toast.error(error.message);
    }
    // On success the browser redirects to Google; no state to reset.
  };

  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full"
      loading={loading}
      onClick={() => void signIn()}
    >
      <img
        src="https://cdn.simpleicons.org/google"
        alt=""
        width={16}
        height={16}
        loading="lazy"
        className="size-4"
        aria-hidden="true"
      />
      {label}
    </Button>
  );
}
