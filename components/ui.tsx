// Shared UI primitives. No "use client": server pages can use these helpers directly;
// interactive pieces that need hooks live in client files (e.g. drawer.tsx).
import Link from "next/link";

/** Join class names, skipping falsy values. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ---- Buttons -------------------------------------------------------------

const BUTTON = {
  primary: "bg-indigo-600 text-white hover:bg-indigo-500 disabled:bg-indigo-300",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50",
  ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
};

export function buttonClass(variant: keyof typeof BUTTON = "primary", size: "sm" | "md" = "md"): string {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
    size === "sm" ? "h-8 px-3 text-xs" : "h-9 px-4 text-sm",
    BUTTON[variant],
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof BUTTON; size?: "sm" | "md" }) {
  return <button {...props} className={cn(buttonClass(variant, size), className)} />;
}

export const inputClass =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50";

// ---- Layout --------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>{children}</div>;
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("px-5 py-4", className)}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1.5 truncate text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value ?? "—"}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "error" | "success"; children: React.ReactNode }) {
  const styles = {
    info: "border-sky-200 bg-sky-50 text-sky-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    error: "border-red-200 bg-red-50 text-red-700",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
  return <div className={cn("rounded-lg border px-4 py-3 text-sm", styles[tone])}>{children}</div>;
}

// ---- Data display --------------------------------------------------------

const BADGE_TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-700 ring-amber-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};
export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ tone = "slate", children, title }: { tone?: BadgeTone; children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

/** 0-100 score with a small bar. */
export function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? "bg-emerald-500" : score >= 50 ? "bg-indigo-500" : "bg-slate-400";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="w-7 text-right text-xs font-semibold tabular-nums text-slate-900">{score}</span>
    </div>
  );
}

export function difficultyTone(score: number): BadgeTone {
  return score <= 30 ? "emerald" : score <= 60 ? "amber" : score <= 80 ? "orange" : "red";
}

/** Table shell: consistent header/row styling across all data tables. */
export function Table({ children, minWidth = 720 }: { children: React.ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" style={{ minWidth }}>
        {children}
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={cn("whitespace-nowrap border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 text-xs font-medium text-slate-500", className)}>
      {children}
    </th>
  );
}

export function SortTh<K extends string>({
  label,
  sortKey,
  sort,
  order,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  sort: K;
  order: "asc" | "desc";
  onSort: (k: K) => void;
  className?: string;
}) {
  const active = sort === sortKey;
  return (
    <Th className={className}>
      <button
        onClick={() => onSort(sortKey)}
        className={cn("inline-flex items-center gap-1 hover:text-slate-900", active && "text-slate-900")}
      >
        {label}
        <span className="text-[10px]">{active ? (order === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </Th>
  );
}

export function Td({ children, className, colSpan }: { children?: React.ReactNode; className?: string; colSpan?: number }) {
  return (
    <td colSpan={colSpan} className={cn("border-b border-slate-100 px-4 py-3 align-middle", className)}>
      {children}
    </td>
  );
}

// ---- Progress ------------------------------------------------------------

/** Horizontal step tracker used by every long-running job. */
export function ProgressSteps<S extends string>({
  steps,
  current,
  running,
  error,
}: {
  steps: { key: S; label: string }[];
  current: S | null;
  running: boolean;
  error: string | null;
}) {
  const index = current ? steps.findIndex((s) => s.key === current) : -1;
  return (
    <Card className="px-5 py-4">
      <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        {steps.map((s, i) => {
          const done = i < index || (!running && !error && i === index);
          const active = running && i === index;
          const failed = !!error && i === Math.max(index, 0);
          return (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  done && "bg-emerald-500 text-white",
                  active && "border-2 border-indigo-600 text-indigo-600",
                  failed && "bg-red-600 text-white",
                  !done && !active && !failed && "border border-slate-300 text-slate-400",
                )}
              >
                {done ? "✓" : failed ? "!" : i + 1}
              </span>
              <span className={cn(done || active ? "text-slate-900" : failed ? "text-red-700" : "text-slate-400", active && "font-medium")}>
                {s.label}
                {active && <span className="ml-1 animate-pulse">…</span>}
              </span>
              {i < steps.length - 1 && <span className="text-slate-300">›</span>}
            </li>
          );
        })}
      </ol>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Card>
  );
}

export function DetailGrid({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3">
      {items.map((i) => (
        <div key={i.label} className="rounded-lg bg-slate-50 px-3 py-2.5">
          <dt className="text-xs text-slate-500">{i.label}</dt>
          <dd className="mt-0.5 text-sm font-medium text-slate-900">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
      {children}
    </Link>
  );
}

export function formatNumber(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString();
}

export function formatDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
