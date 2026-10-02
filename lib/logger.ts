type Level = "info" | "warn" | "error";
type Meta = Record<string, unknown>;

function write(level: Level, msg: string, meta?: Meta) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...meta });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, meta?: Meta) => write("info", msg, meta),
  warn: (msg: string, meta?: Meta) => write("warn", msg, meta),
  error: (msg: string, meta?: Meta) => write("error", msg, meta),
};

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
