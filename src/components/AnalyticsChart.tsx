import { Fragment } from "react";
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
  return (
    <ResponsiveContainer width="100%" height={240}>
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

/** Horizontal ranked bar chart for revenue-per-item or recommender leaderboards. */
export function RankBarChart({ data, money = false }: { data: RankDatum[]; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
        <XAxis type="number" allowDecimals={money} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          tick={{ fontSize: 12, fill: "var(--color-ink)" }}
          tickLine={false}
          axisLine={false}
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
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
        <XAxis type="number" allowDecimals={false} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={104}
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
const HEATMAP_HOURS = Array.from({ length: 16 }, (_, index) => index + 8); // 8am to 11pm

function formatHour(hour: number): string {
  if (hour === 12) return "12p";
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

/**
 * Peak-interest heatmap: 7 days x 16 hours, cell intensity scaled to the
 * busiest cell. `matrix` is indexed [dayOfWeekMondayFirst][hour0to23].
 */
export function PeakHeatmap({
  matrix,
  unit = "order",
  caption = "Darker cells mean more orders placed in that hour.",
}: {
  matrix: number[][];
  unit?: string;
  caption?: string;
}) {
  const max = Math.max(1, ...matrix.flat());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[480px]">
        <div className="grid grid-cols-[40px_repeat(16,1fr)] gap-1">
          <span aria-hidden="true" />
          {HEATMAP_HOURS.map((hour) => (
            <span key={hour} className="text-center text-[10px] text-ink-muted">
              {hour % 2 === 0 ? formatHour(hour) : ""}
            </span>
          ))}
          {DAY_LABELS.map((day, dayIndex) => (
            <Fragment key={day}>
              <span className="pr-1 text-right text-[10px] font-semibold leading-4 text-ink-muted">
                {day}
              </span>
              {HEATMAP_HOURS.map((hour) => {
                const value = matrix[dayIndex]?.[hour] ?? 0;
                const intensity = Math.round((value / max) * 100);
                return (
                  <span
                    key={`${day}-${hour}`}
                    className="h-4 rounded-[4px]"
                    style={{
                      backgroundColor:
                        value === 0
                          ? "var(--color-border)"
                          : `color-mix(in oklab, var(--color-primary-dark) ${Math.max(intensity, 15)}%, var(--color-surface))`,
                    }}
                    title={`${day} ${formatHour(hour)}: ${value} ${value === 1 ? unit : `${unit}s`}`}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">{caption}</p>
      </div>
    </div>
  );
}
