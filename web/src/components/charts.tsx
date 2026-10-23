// Small hand-written SVG charts. Spec: bars ≤24px with 4px rounded data-end, square at the
// baseline; hairline solid gridlines; text in ink tokens (never the series color); per-mark
// hover tooltips with hit targets larger than the mark.

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { fmtCompact, fmtUsd, shortDay } from "../lib/format";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

/** Column path with a 4px rounded top and a square base. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface ColumnDatum {
  date: string;
  value: number;
}

export function DailyColumnChart({
  data,
  height = 200,
  reference,
  referenceLabel,
  format = (v: number) => fmtUsd(v, true),
  ariaLabel,
}: {
  data: ColumnDatum[];
  height?: number;
  reference?: number;
  referenceLabel?: string;
  format?: (v: number) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const margin = { top: 10, right: 8, bottom: 22, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value), reference ?? 0));
  const slot = innerW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(2, slot - 2));
  const y = (v: number) => margin.top + innerH - (v / max) * innerH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const labelEvery = Math.ceil(data.length / Math.max(2, Math.floor(innerW / 64)));

  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--axis)" : "var(--grid)"}
              strokeWidth={1}
            />
            <text x={margin.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="num">
              {t === 0 ? "0" : `$${fmtCompact(t)}`}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = margin.left + i * slot + (slot - barW) / 2;
          const h = Math.max(0, y(0) - y(d.value));
          return (
            <g key={d.date}>
              {h > 0 && (
                <path
                  d={columnPath(x, y(d.value), barW, h)}
                  fill="var(--series-1)"
                  opacity={hover === null || hover === i ? 1 : 0.55}
                />
              )}
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={height - 6} textAnchor="middle" fontSize={11} fill="var(--muted)" className="num">
                  {shortDay(d.date)}
                </text>
              )}
              <rect
                x={margin.left + i * slot}
                y={margin.top}
                width={slot}
                height={innerH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${shortDay(d.date)}: ${format(d.value)}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            </g>
          );
        })}
        {reference != null && reference > 0 && (
          <line
            x1={margin.left}
            x2={width - margin.right}
            y1={y(reference)}
            y2={y(reference)}
            stroke="var(--text-2)"
            strokeWidth={1.5}
            pointerEvents="none"
          />
        )}
      </svg>
      {hover !== null && data[hover] && (
        <div className="chart-tooltip" style={{ left: margin.left + hover * slot + slot / 2, top: y(data[hover].value) }}>
          <strong className="num">{format(data[hover].value)}</strong>
          <span className="muted">{shortDay(data[hover].date)}</span>
        </div>
      )}
      {reference != null && reference > 0 && referenceLabel && (
        <div className="legend">
          <span>
            <i className="line" style={{ background: "var(--text-2)" }} />
            {referenceLabel} {format(reference)}
          </span>
        </div>
      )}
    </div>
  );
}

export interface BarListItem {
  key: string | number;
  label: ReactNode;
  value: number;
  budget?: number | null;
  to?: string;
}

/** Horizontal magnitude bars with an optional budget tick; over-budget rows get a labelled status. */
export function BarList({
  items,
  format = (v: number) => fmtUsd(v),
  empty = "Keine Daten",
}: {
  items: BarListItem[];
  format?: (v: number) => string;
  empty?: string;
}) {
  if (!items.length) return <div className="empty">{empty}</div>;
  const max = Math.max(...items.map((i) => Math.max(i.value, i.budget ?? 0)), 1);
  return (
    <div className="bar-list">
      {items.map((item) => {
        const over = item.budget != null && item.budget > 0 && item.value > item.budget;
        return (
          <div className="bar-list-row" key={item.key} title={item.budget ? `Budget ${format(item.budget)}` : undefined}>
            <span className="bar-list-label">{item.to ? <Link to={item.to}>{item.label}</Link> : item.label}</span>
            <span className="num small nowrap">
              {over && (
                <span className="badge badge-plain" style={{ marginRight: 6 }}>
                  <span className="dot dot-critical" />
                  über Budget
                </span>
              )}
              {format(item.value)}
              {item.budget ? <span className="muted"> / {format(item.budget)}</span> : null}
            </span>
            <div className="bar-list-track" aria-hidden="true">
              <div className="bar-list-fill" style={{ width: `${(item.value / max) * 100}%` }} />
              {item.budget ? (
                <div className="bar-list-budget" style={{ left: `calc(${(item.budget / max) * 100}% - 1px)` }} />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function StackedBar({
  segments,
  format = (v: number) => String(v),
}: {
  segments: Segment[];
  format?: (v: number) => string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <div>
      <div className="stacked" role="img" aria-label={segments.map((s) => `${s.label}: ${format(s.value)}`).join(", ")}>
        {total === 0 ? (
          <span style={{ flex: 1, background: "var(--surface-2)" }} />
        ) : (
          segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.key} title={`${s.label}: ${format(s.value)}`} style={{ flex: s.value, background: s.color }} />
            ))
        )}
      </div>
      <div className="legend">
        {segments.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}{" "}
            <strong className="num" style={{ color: "var(--text)" }}>
              {format(s.value)}
            </strong>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Meter({ value, max, warnAt = 0.8 }: { value: number; max: number; warnAt?: number }) {
  const ratio = max > 0 ? value / max : 0;
  const cls = ratio >= 1 ? "danger" : ratio >= warnAt ? "warn" : "";
  return (
    <div className={`meter ${cls}`} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
    </div>
  );
}
