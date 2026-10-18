import { NextResponse } from "next/server";

/**
 * Server-only proxy to the TRACE backend. TRACE_API_KEY is read here, in a
 * Route Handler, which runs exclusively on the Next.js server — it is
 * never bundled into client-side JS. The browser only ever sees this
 * route's sanitized response, never the key or the backend's raw payload.
 */
export interface BackendStatus {
  connected: boolean;
  organizationName?: string;
  developerCount?: number;
  reason?: string;
}

export async function GET() {
  const baseUrl = process.env.TRACE_API_BASE_URL;
  const apiKey = process.env.TRACE_API_KEY;

  if (!baseUrl || !apiKey) {
    return NextResponse.json<BackendStatus>({ connected: false, reason: "not configured" });
  }

  try {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const [orgResponse, developersResponse] = await Promise.all([
      fetch(`${baseUrl}/organizations/me`, { headers, cache: "no-store" }),
      fetch(`${baseUrl}/organizations/me/developers`, { headers, cache: "no-store" }),
    ]);

    if (!orgResponse.ok || !developersResponse.ok) {
      return NextResponse.json<BackendStatus>({
        connected: false,
        reason: `backend responded with ${orgResponse.status}`,
      });
    }

    const organization = await orgResponse.json();
    const developers = await developersResponse.json();

    return NextResponse.json<BackendStatus>({
      connected: true,
      organizationName: organization.name,
      developerCount: Array.isArray(developers) ? developers.length : undefined,
    });
  } catch {
    return NextResponse.json<BackendStatus>({ connected: false, reason: "backend unreachable" });
  }
}
