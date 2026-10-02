/**
 * Parse a fetch response as JSON with a readable error when the server returned something else
 * (e.g. an HTML error page while the dev server restarts).
 */
export async function readJson<T = any>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `The server returned an unexpected response (HTTP ${res.status}). It may have been restarting — please try again.`,
    );
  }
}
