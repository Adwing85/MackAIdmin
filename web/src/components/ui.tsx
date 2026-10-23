import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApiError } from "../lib/api";
import { useApp } from "../lib/app";
import type { RiskLevel, Severity } from "../lib/types";

// --- icons (16px stroke icons) --------------------------------------------------------

const ICONS: Record<string, string> = {
  dashboard: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  inventory: "M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8",
  approvals: "M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM9 12l2 2 4-4",
  costs: "M12 2v20M17 6H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  licenses:
    "M3 6a2 2 0 012-2h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2zM8 10a2 2 0 104 0 2 2 0 10-4 0M6 16c.8-1.6 2.2-2.4 4-2.4s3.2.8 4 2.4M15 9h3M15 13h3",
  redundancy: "M8 8h11a2 2 0 012 2v9a2 2 0 01-2 2h-9a2 2 0 01-2-2zM16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3",
  radar: "M12 12l6-6M21 12a9 9 0 11-9-9M17 12a5 5 0 11-5-5M12 12h.01",
  policy: "M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9zM14 3v6h6M9 14h6M9 17h4",
  users:
    "M16 20v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 18.5V20M10 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM20 20v-1.5a3.5 3.5 0 00-2.5-3.35M15.5 4.15a3.5 3.5 0 010 6.7",
  log: "M4 6h16M4 12h16M4 18h10",
  plus: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3",
  sun: "M12 17a5 5 0 100-10 5 5 0 000 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z",
  menu: "M3 6h18M3 12h18M3 18h18",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9",
  alert: "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 11-7.8 7.8 5.5 5.5 0 017.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
  refresh: "M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15",
  user: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
};

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={ICONS[name] ?? ICONS.log} />
    </svg>
  );
}

// --- layout primitives ---------------------------------------------------------------

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  flush,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${flush ? "flush" : ""} ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, to }: { label: string; value: ReactNode; sub?: ReactNode; to?: string }) {
  const body = (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
  return (
    <div className="card">
      {to ? (
        <Link to={to} style={{ color: "inherit", textDecoration: "none" }}>
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

export function Loading() {
  return <div className="empty">Lädt …</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ error }: { error: ApiError | Error | null | undefined }) {
  if (!error) return null;
  const lines = "detailLines" in error ? (error as ApiError).detailLines : [];
  return (
    <div className="callout danger" role="alert">
      <Icon name="alert" />
      <div>
        <strong>{error.message}</strong>
        {lines.length > 0 && (
          <ul>
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// --- badges -----------------------------------------------------------------------------

const SEVERITY_DOT: Record<Severity, string> = { critical: "critical", high: "serious", medium: "warning", low: "muted" };
const RISK_DOT: Record<RiskLevel, string> = { critical: "critical", high: "serious", medium: "warning", low: "good" };
const STATUS_DOT: Record<string, string> = {
  draft: "muted",
  in_review: "accent",
  approved: "good",
  active: "good",
  rejected: "critical",
  deprecated: "warning",
  retired: "muted",
};

export function Badge({ dot, children, title }: { dot?: string; children: ReactNode; title?: string }) {
  return (
    <span className="badge" title={title}>
      {dot && <span className={`dot dot-${dot}`} />}
      {children}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const { meta } = useApp();
  return <Badge dot={SEVERITY_DOT[severity]}>{meta.severities[severity]}</Badge>;
}

export function RiskBadge({ level, score }: { level: RiskLevel; score?: number }) {
  const { meta } = useApp();
  return (
    <Badge dot={RISK_DOT[level]} title={score != null ? `Risiko-Score ${score}/100` : undefined}>
      {meta.riskLevels[level]}
      {score != null && <span className="muted num">{score}</span>}
    </Badge>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const { meta } = useApp();
  return <Badge dot={STATUS_DOT[status] ?? "muted"}>{meta.assetStatuses[status] ?? status}</Badge>;
}

export function ApprovalBadge({ decision }: { decision: "pending" | "approved" | "rejected" }) {
  const map = { pending: ["accent", "Offen"], approved: ["good", "Freigegeben"], rejected: ["critical", "Abgelehnt"] } as const;
  return <Badge dot={map[decision][0]}>{map[decision][1]}</Badge>;
}

export function RiskScore({ score, level }: { score: number; level: RiskLevel }) {
  const color = { low: "var(--good)", medium: "var(--warning)", high: "var(--serious)", critical: "var(--critical)" }[level];
  return (
    <span className="risk-score" title={`Risiko-Score ${score}/100`}>
      <span className="bar">
        <span style={{ width: `${Math.max(4, score)}%`, background: color }} />
      </span>
      <span className="num small">{score}</span>
    </span>
  );
}

// --- forms --------------------------------------------------------------------------------

export function Field({
  label,
  hint,
  children,
  className = "",
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={`field ${className}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function ChipInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  id,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  id?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const items = raw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.includes(s));
    if (items.length) onChange([...value, ...items]);
    setDraft("");
  };
  const listId = id ? `${id}-list` : undefined;
  return (
    <div className="chip-input">
      {value.map((v) => (
        <span className="chip" key={v}>
          {v}
          <button type="button" aria-label={`${v} entfernen`} onClick={() => onChange(value.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        type="text"
        list={listId}
        value={draft}
        placeholder={value.length ? "" : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;]/.test(v)) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft && add(draft)}
      />
      {listId && suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions
            .filter((s) => !value.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: ReactNode }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={active === t.id}
          className={active === t.id ? "active" : ""}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Schließen">
            <Icon name="x" />
          </button>
        </div>
        {children}
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={value === o.id ? "active" : ""}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
