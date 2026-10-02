"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "./ui";

export interface SidebarProject {
  id: string;
  domain: string;
  status: string;
}

const PROJECT_SECTIONS = [
  { slug: "", label: "Overview", icon: IconGrid },
  { slug: "/pages", label: "Pages", icon: IconFile },
  { slug: "/keywords", label: "Keywords", icon: IconKey },
  { slug: "/competitors", label: "Competitors", icon: IconUsers },
  { slug: "/strategy", label: "Strategy", icon: IconTarget },
  { slug: "/articles", label: "Articles", icon: IconPen },
];

export function Sidebar({ projects, showLogout }: { projects: SidebarProject[]; showLogout: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const activeProjectId = /^\/projects\/([0-9a-f-]{36})/.exec(pathname)?.[1] ?? null;

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-800 px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">S</span>
        <span className="text-sm font-semibold tracking-tight text-white">SEO Automation</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <NavLink href="/" active={pathname === "/"} icon={IconHome} onClick={() => setOpen(false)}>
          Dashboard
        </NavLink>
        <NavLink href="/projects/new" active={pathname === "/projects/new"} icon={IconPlus} onClick={() => setOpen(false)}>
          New project
        </NavLink>

        <p className="mb-2 mt-6 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Projects</p>
        {projects.length === 0 && <p className="px-3 text-xs text-slate-500">No projects yet</p>}
        <ul className="space-y-0.5">
          {projects.map((p) => {
            const active = p.id === activeProjectId;
            return (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active ? "bg-slate-800 text-white" : "text-slate-400 hover:bg-slate-800/60 hover:text-white",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      p.status === "complete" ? "bg-emerald-400" : p.status === "failed" ? "bg-red-400" : "bg-slate-500",
                    )}
                  />
                  <span className="truncate">{p.domain}</span>
                </Link>
                {active && (
                  <ul className="mb-2 ml-4 mt-1 space-y-0.5 border-l border-slate-800 pl-2">
                    {PROJECT_SECTIONS.map((s) => {
                      const href = `/projects/${p.id}${s.slug}`;
                      return (
                        <li key={s.label}>
                          <NavLink href={href} active={s.slug ? pathname.startsWith(href) : pathname === href} icon={s.icon} small onClick={() => setOpen(false)}>
                            {s.label}
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {showLogout && (
        <form action="/api/auth/logout" method="post" className="border-t border-slate-800 p-3">
          <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800/60 hover:text-white">
            Sign out
          </button>
        </form>
      )}
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-200 bg-white px-4 lg:hidden">
        <span className="text-sm font-semibold">SEO Automation</span>
        <button onClick={() => setOpen(true)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label="Open menu">
          <IconMenu />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="h-full w-72 bg-slate-900" onClick={(e) => e.stopPropagation()}>
            {nav}
          </div>
        </div>
      )}
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 bg-slate-900 lg:block">{nav}</aside>
    </>
  );
}

function NavLink({
  href,
  active,
  icon: Icon,
  small,
  onClick,
  children,
}: {
  href: string;
  active: boolean;
  icon: () => React.ReactElement;
  small?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-3 transition-colors",
        small ? "py-1.5 text-[13px]" : "py-2 text-sm",
        active ? "bg-indigo-500/15 font-medium text-indigo-300" : "text-slate-400 hover:bg-slate-800/60 hover:text-white",
      )}
    >
      <Icon />
      {children}
    </Link>
  );
}

// Small inline icons (no icon library needed).
function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {children}
    </svg>
  );
}
function IconHome() {
  return <Svg><path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" /></Svg>;
}
function IconPlus() {
  return <Svg><path d="M12 5v14M5 12h14" /></Svg>;
}
function IconGrid() {
  return (
    <Svg>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Svg>
  );
}
function IconFile() {
  return (
    <Svg>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </Svg>
  );
}
function IconKey() {
  return <Svg><path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" /></Svg>;
}
function IconUsers() {
  return (
    <Svg>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </Svg>
  );
}
function IconTarget() {
  return (
    <Svg>
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  );
}
function IconPen() {
  return <Svg><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Svg>;
}
function IconMenu() {
  return <Svg><path d="M4 6h16M4 12h16M4 18h16" /></Svg>;
}
