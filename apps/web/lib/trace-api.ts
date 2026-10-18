/**
 * Server-only helper for calling the TRACE backend. TRACE_API_KEY is read
 * here and nowhere else in the frontend — this file is imported only by
 * Route Handlers under app/api/, which run exclusively on the Next.js
 * server, so the key never reaches client-side JS.
 */
export class TraceApiNotConfiguredError extends Error {
  constructor() {
    super("TRACE_API_BASE_URL / TRACE_API_KEY are not configured");
  }
}

export async function traceApiFetch(path: string, init?: RequestInit): Promise<Response> {
  const baseUrl = process.env.TRACE_API_BASE_URL;
  const apiKey = process.env.TRACE_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new TraceApiNotConfiguredError();
  }

  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${apiKey}`,
    },
    cache: "no-store",
  });
}
