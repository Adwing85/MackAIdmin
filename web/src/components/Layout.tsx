import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { applyTheme, getStoredTheme, useApp } from "../lib/app";
import { Icon } from "./ui";

const NAV: {
  section: string;
  items: { to: string; label: string; icon: string; count?: "approvals" | "discovery" | "critical" }[];
}[] = [
  {
    section: "Überblick",
    items: [
      { to: "/", label: "Übersicht", icon: "dashboard" },
      { to: "/inventar", label: "Inventar", icon: "inventory" },
      { to: "/freigaben", label: "Freigaben", icon: "approvals", count: "approvals" },
    ],
  },
  {
    section: "Steuerung",
    items: [
      { to: "/sicherheit", label: "Sicherheit & Risiken", icon: "shield", count: "critical" },
      { to: "/kosten", label: "Kosten & Budgets", icon: "costs" },
      { to: "/lizenzen", label: "Lizenzen", icon: "licenses" },
      { to: "/redundanzen", label: "Redundanzen", icon: "redundancy" },
      { to: "/discovery", label: "Shadow-AI-Discovery", icon: "radar", count: "discovery" },
    ],
  },
  {
    section: "Administration",
    items: [
      { to: "/richtlinien", label: "Richtlinien & Policy", icon: "policy" },
      { to: "/organisation", label: "Organisation", icon: "users" },
      { to: "/audit", label: "Audit-Log", icon: "log" },
    ],
  },
];

export function Layout() {
  const { me, meta, logout, counts } = useApp();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState(getStoredTheme());
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  const effectiveDark = theme ? theme === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const toggleTheme = () => {
    const next = effectiveDark ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div className="app">
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Navigation">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 32 32">
              <path
                d="M7 24V9l9 9 9-9v15"
                stroke="white"
                strokeWidth="3.4"
                fill="none"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </svg>
          </span>
          MackAIdmin
        </div>
        {NAV.map((group) => (
          <div key={group.section}>
            <div className="nav-section">{group.section}</div>
            {group.items.map((item) => {
              const count = item.count ? counts[item.count] : 0;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}
                >
                  <Icon name={item.icon} />
                  {item.label}
                  {count > 0 && <span className={`nav-count ${item.count === "critical" ? "alert" : ""}`}>{count}</span>}
                </NavLink>
              );
            })}
          </div>
        ))}
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost icon-btn menu-toggle" onClick={() => setOpen((o) => !o)} aria-label="Menü">
            <Icon name="menu" />
          </button>
          <button
            className="btn btn-ghost icon-btn"
            onClick={toggleTheme}
            aria-label={effectiveDark ? "Helles Design" : "Dunkles Design"}
            title="Design wechseln"
          >
            <Icon name={effectiveDark ? "sun" : "moon"} />
          </button>
          <NavLink to="/konto" className="btn btn-ghost" title="Konto">
            <Icon name="user" />
            <span>{me.name}</span>
            <span className="muted small">{me.roles.map((r) => meta.roles[r] ?? r).join(", ")}</span>
          </NavLink>
          {!me.ssoProxy && (
            <button className="btn btn-ghost icon-btn" onClick={logout} aria-label="Abmelden" title="Abmelden">
              <Icon name="logout" />
            </button>
          )}
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
