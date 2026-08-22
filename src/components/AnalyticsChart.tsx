import { Fragment } from "react";
import { cn } from "@/lib/utils";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  background: "var(--color-surface-raised)",
  border: "1px solid var(--color-border)",
  borderRadius: "12px",
  fontFamily: "var(--font-body)",
  fontSize: "13px",
  color: "var(--color-ink)",
};

/**
 * Charts live inside cards that are often half a grid row wide. An empty chart
 * that still draws its axes reads as broken data rather than "nothing yet", so
 * every chart here swaps to this instead of rendering an empty frame.
 */
export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[140px] items-center justify-center rounded-xl border border-dashed border-border bg-surface px-4 py-6">
      <p className="max-w-[36ch] text-center text-sm text-ink-muted">{children}</p>
    </div>
  );
}

export interface TrendPoint {
  day: string;
  views: number;
  clicks: number;
}

export function TrendLineChart({ data }: { data: TrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--color-border)" }} />
        <Line
          type="monotone"
          dataKey="views"
          name="Views"
          stroke="var(--color-primary-dark)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: "var(--color-primary-dark)" }}
        />
        <Line
          type="monotone"
          dataKey="clicks"
          name="Venmo clicks"
          stroke="var(--color-ink)"
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          activeDot={{ r: 4, fill: "var(--color-ink)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface RevenuePoint {
  day: string;
  revenue: number;
}

const moneyTick = (value: number) => `$${value}`;

export function RevenueLineChart({ data }: { data: RevenuePoint[] }) {
  if (data.every((point) => point.revenue === 0)) {
    return <ChartEmpty>No verified payments in this window yet. Revenue shows up here the day a payment is verified.</ChartEmpty>;
  }
  return (
    <ResponsiveContainer width="100%" height={240} minWidth={0}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -4 }}>
        <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="day"
          tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }}
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
        />
        <YAxis
          tickFormatter={moneyTick}
          tick={{ fontSize: 12, fill: "var(--color-ink-muted)" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ stroke: "var(--color-border)" }}
          formatter={(value: number) => [`$${Number(value).toFixed(2)}`, "Revenue"]}
        />
        <Line
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke="var(--color-primary-dark)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: "var(--color-primary-dark)" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export interface RankDatum {
  name: string;
  value: number;
}

/**
 * Gutter for the category labels. A fixed width either clipped long item names
 * or wasted half the card on short ones, so scale it with the longest label but
 * never let it eat more than the bars.
 */
function labelGutter(data: { name: string }[]): number {
  const longest = data.reduce((max, datum) => Math.max(max, datum.name.length), 0);
  return Math.min(148, Math.max(76, longest * 7 + 12));
}

/** Horizontal ranked bar chart for revenue-per-item or recommender leaderboards. */
export function RankBarChart({ data, money = false }: { data: RankDatum[]; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)} minWidth={0}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
        <XAxis type="number" allowDecimals={money} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={labelGutter(data)}
          tick={{ fontSize: 12, fill: "var(--color-ink)" }}
          tickLine={false}
          axisLine={false}
          interval={0}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: "var(--color-border)", opacity: 0.3 }}
          formatter={(value: number) => [money ? `$${Number(value).toFixed(2)}` : value, money ? "Revenue" : "Units"]}
        />
        <Bar dataKey="value" fill="var(--color-primary)" radius={[0, 8, 8, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface TagCount {
  name: string;
  count: number;
}

export function TagBarChart({ data }: { data: TagCount[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)} minWidth={0}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
        <XAxis type="number" allowDecimals={false} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={labelGutter(data)}
          interval={0}
          tick={{ fontSize: 12, fill: "var(--color-ink)" }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-border)", opacity: 0.3 }} />
        <Bar dataKey="count" name="Items" fill="var(--color-primary)" radius={[0, 8, 8, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
// The full day, not a 9-to-5 slice. Late-night drops are a real pattern here,
// and an 8am-11pm grid silently dropped every order placed after midnight -
// which was a large share of them.
const HEATMAP_HOURS = Array.from({ length: 24 }, (_, index) => index);

function formatHour(hour: number): string {
  if (hour === 0) return "12a";
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/**
 * Peak-interest heatmap: 7 days x 16 hours, cell intensity scaled to the
 * busiest cell. `matrix` is indexed [dayOfWeekMondayFirst][hour0to23].
 *
 * Sized to fit a half-width card on a laptop without scrolling, and to scroll
 * inside its own box on a phone rather than widening the page. The card used to
 * push the whole grid row past the viewport, which is why the analytics pages
 * scrolled sideways on mobile.
 */
export function PeakHeatmap({
  matrix,
  unit = "order",
  caption = "Darker cells mean more orders placed in that hour.",
  emptyLabel = "No orders in this window yet, so there is no busiest hour to show.",
}: {
  matrix: number[][];
  unit?: string;
  caption?: string;
  emptyLabel?: string;
}) {
  // Everything below is scoped to the hours the grid actually draws. Scaling
  // the shading (or naming a "busiest" hour) off a 3am cell nobody can see made
  // the chart contradict itself, so out-of-window activity gets its own note.
  let shown = 0;
  let hidden = 0;
  let peak = { day: 0, hour: 0, value: 0 };
  matrix.forEach((row, day) =>
    row.forEach((value, hour) => {
      if (hour < HEATMAP_HOURS[0] || hour > HEATMAP_HOURS[HEATMAP_HOURS.length - 1]) {
        hidden += value;
        return;
      }
      shown += value;
      if (value > peak.value) peak = { day, hour, value };
    }),
  );
  const max = Math.max(1, peak.value);

  if (shown === 0) {
    return (
      <ChartEmpty>
        {hidden > 0
          ? `All ${hidden} ${hidden === 1 ? unit : `${unit}s`} in this window landed outside ${formatHour(HEATMAP_HOURS[0])}–${formatHour(HEATMAP_HOURS[HEATMAP_HOURS.length - 1])}, so there is nothing to plot here.`
          : emptyLabel}
      </ChartEmpty>
    );
  }

  const shade = (value: number) =>
    value === 0
      ? "var(--color-border)"
      : `color-mix(in oklab, var(--color-primary-dark) ${Math.max(
          Math.round((value / max) * 100),
          18,
        )}%, var(--color-surface))`;

  return (
    <div className="min-w-0">
      {/* pb leaves the horizontal scrollbar its own lane instead of parking it
          on top of the Sunday row. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1.5 [scrollbar-width:thin]">
        <div className="min-w-[392px]">
          <div className="grid grid-cols-[26px_repeat(24,1fr)] gap-[2px]">
            <span aria-hidden="true" />
            {HEATMAP_HOURS.map((hour) => (
              <span key={hour} className="text-center text-[10px] leading-4 text-ink-muted">
                {hour % 3 === 0 ? formatHour(hour) : ""}
              </span>
            ))}
            {DAY_LABELS.map((day, dayIndex) => (
              <Fragment key={day}>
                <span className="pr-1 text-right text-[10px] font-semibold leading-5 text-ink-muted">
                  {day}
                </span>
                {HEATMAP_HOURS.map((hour) => {
                  const value = matrix[dayIndex]?.[hour] ?? 0;
                  return (
                    <span
                      key={`${day}-${hour}`}
                      className={cn(
                        "h-5 rounded-[4px]",
                        value === peak.value && value > 0 && "ring-1 ring-ink/40",
                      )}
                      style={{ backgroundColor: shade(value) }}
                      title={`${day} ${formatHour(hour)}: ${value} ${value === 1 ? unit : `${unit}s`}`}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <p className="text-xs text-ink-muted">
          Busiest:{" "}
          <span className="font-semibold text-ink">
            {DAY_LABELS[peak.day]} {formatHour(peak.hour)}
          </span>{" "}
          ({peak.value} {peak.value === 1 ? unit : `${unit}s`})
        </p>
        <p className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span>Less</span>
          {[0, 0.25, 0.5, 0.75, 1].map((step) => (
            <span
              key={step}
              className="size-3 rounded-[3px]"
              style={{ backgroundColor: shade(step * max) }}
              aria-hidden="true"
            />
          ))}
          <span>More</span>
        </p>
      </div>
      <p className="mt-1.5 text-xs text-ink-muted">
        {caption}
        {hidden > 0 &&
          ` ${hidden} ${hidden === 1 ? unit : `${unit}s`} fell outside ${formatHour(HEATMAP_HOURS[0])}–${formatHour(HEATMAP_HOURS[HEATMAP_HOURS.length - 1])} and are not shown.`}
      </p>
    </div>
  );
}
