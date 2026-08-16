import { TemplateCard } from "cornell-craves";

const base = {
  id: "t-1",
  club_id: "c-1",
  description: "Weekly Friday afternoon run, Duffield atrium.",
  items: [
    { name: "Glazed dozen", price: 14.99, quantity: 12, dietary_tags: ["vegetarian"] },
    { name: "Chocolate iced dozen", price: 16.99, quantity: 12, dietary_tags: ["vegetarian"] },
  ],
  created_at: "2026-06-01T12:00:00.000Z",
} as const;

const noop = () => {};
const handlers = { busy: false, onPost: noop, onEdit: noop, onToggleActive: noop, onToggleAuto: noop };

/** A recurring template that posts itself on a schedule. */
export function AutoRecurring() {
  return (
    <div style={{ maxWidth: 520 }}>
      <TemplateCard
        {...handlers}
        template={{
          ...base,
          name: "Friday dozen drop",
          brand: "Krispy Kreme",
          frequency: "weekly",
          next_run_date: "2026-09-18",
          is_active: true,
          mode: "auto",
          auto_active: true,
        }}
      />
    </div>
  );
}

/** A saved template the club relaunches by hand. */
export function OneTime() {
  return (
    <div style={{ maxWidth: 520 }}>
      <TemplateCard
        {...handlers}
        template={{
          ...base,
          name: "Late-night cookies",
          brand: "Insomnia Cookies",
          description: "Prelim-week special at RPCC.",
          items: [{ name: "Classic 6-pack", price: 11.5, quantity: 6, dietary_tags: ["vegetarian"] }],
          frequency: "monthly",
          next_run_date: null,
          is_active: true,
          mode: "one_time",
          auto_active: false,
        }}
      />
    </div>
  );
}

/** Recurring, but paused: the schedule is set and not currently firing. */
export function Paused() {
  return (
    <div style={{ maxWidth: 520 }}>
      <TemplateCard
        {...handlers}
        template={{
          ...base,
          name: "Biweekly bagel run",
          brand: "Collegetown Bagels",
          description: "Every other Sunday, Ho Plaza.",
          items: [{ name: "Half dozen bagels", price: 9.0, quantity: 6 }],
          frequency: "biweekly",
          next_run_date: "2026-09-27",
          is_active: true,
          mode: "auto",
          auto_active: false,
        }}
      />
    </div>
  );
}
