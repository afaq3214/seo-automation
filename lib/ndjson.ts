import { errorMessage } from "@/lib/logger";

/**
 * Stream progress events as newline-delimited JSON. `run` receives an `emit` function;
 * if it throws, an `{ type: "error", message }` event is sent before the stream closes.
 *
 * If the browser disconnects (tab closed, panel closed), emitting becomes a no-op and the job
 * keeps running to completion — long jobs still save their results.
 */
export function ndjsonResponse<E>(
  run: (emit: (event: E) => void) => Promise<void>,
  onError?: (err: unknown) => void,
): Response {
  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: E | { type: "error"; message: string }) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false; // client went away
        }
      };
      try {
        await run(emit);
      } catch (err) {
        onError?.(err);
        emit({ type: "error", message: errorMessage(err) });
      } finally {
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
