"use client";

import { useCallback, useState } from "react";
import { readJson } from "./read-json";

type StreamEvent = { type: string; step?: string; message?: string };

/**
 * Runs a long job exposed as an NDJSON stream ({type:"step"} / {type:"complete"} / {type:"error"}),
 * tracking the current step and error. `onComplete` receives the complete event.
 */
export function useStreamJob<Step extends string, Complete extends { type: "complete" }>() {
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (url: string, body: unknown, onComplete: (event: Complete) => void | Promise<void>) => {
      setRunning(true);
      setStep(null);
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        if (!res.ok || !res.body) {
          const json = await readJson<{ error?: string }>(res);
          throw new Error(json.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let completed: Complete | null = null;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line) as StreamEvent;
            if (event.type === "step" && event.step) setStep(event.step as Step);
            if (event.type === "error") throw new Error(event.message ?? "Something went wrong");
            if (event.type === "complete") completed = event as unknown as Complete;
          }
        }
        if (!completed) throw new Error("Connection closed before the job finished");
        setStep("complete" as Step);
        await onComplete(completed);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setStep(null);
    setError(null);
  }, []);

  return { run, running, step, error, reset, visible: running || step !== null || error !== null };
}
