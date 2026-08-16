import { EmptyState } from "cornell-craves";
import { PackageOpen, Inbox, SearchX } from "lucide-react";

export function WithAction() {
  return (
    <EmptyState
      icon={<PackageOpen className="size-6" aria-hidden="true" />}
      title="No listings yet"
      body="Post your first drop and it shows up on the feed instantly. Cravers who picked your brand get an email."
      actionLabel="Create your first listing"
      onAction={() => {}}
    />
  );
}

export function Informational() {
  return (
    <EmptyState
      icon={<Inbox className="size-6" aria-hidden="true" />}
      title="No orders here"
      body="Orders land in this dashboard the moment students place them on your listings."
    />
  );
}

export function NotFound() {
  return (
    <EmptyState
      icon={<SearchX className="size-6" aria-hidden="true" />}
      title="This drop is not taking orders"
      body="It has ended or been deactivated by the club. The feed has what is live right now."
      actionLabel="Back to feed"
      onAction={() => {}}
    />
  );
}
