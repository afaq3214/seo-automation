"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

const TABS = [
  { slug: "", label: "Overview" },
  { slug: "/pages", label: "Pages" },
  { slug: "/keywords", label: "Keywords" },
  { slug: "/competitors", label: "Competitors" },
  { slug: "/strategy", label: "Strategy" },
  { slug: "/articles", label: "Articles" },
];

export function ProjectTabs({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  return (
    <nav className="-mb-px flex gap-6 overflow-x-auto">
      {TABS.map((t) => {
        const href = `/projects/${projectId}${t.slug}`;
        const active = t.slug ? pathname.startsWith(href) : pathname === href;
        return (
          <Link
            key={t.label}
            href={href}
            className={cn(
              "whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors",
              active ? "border-indigo-600 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-900",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
