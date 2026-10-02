"use client";

import { useState } from "react";
import { readJson } from "@/components/read-json";
import { Button, inputClass } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await readJson<{ error?: string }>(res);
      if (!res.ok) throw new Error(json.error ?? "Sign-in failed");
      window.location.href = next; // full reload so the server renders with the new session
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">S</span>
        <span className="text-sm font-semibold tracking-tight">SEO Automation</span>
      </div>
      <h1 className="mt-6 text-lg font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Enter the app password.</p>
      <input
        type="password"
        autoFocus
        required
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className={`${inputClass} mt-5 w-full`}
        placeholder="Password"
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={busy || !password} className="mt-4 w-full">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
