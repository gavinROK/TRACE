import { NextRequest, NextResponse } from "next/server";
import { TraceApiNotConfiguredError, traceApiFetch } from "@/lib/trace-api";

/**
 * Single proxy for every backend call the frontend makes. The browser
 * only ever talks to this same-origin route — never directly to the
 * backend — so TRACE_API_KEY (read inside traceApiFetch) never reaches
 * client-side JS. The backend itself still enforces org-scoped
 * authorization on every path; this route only adds the key, it doesn't
 * decide what's allowed.
 */
async function proxy(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await params;
  const targetPath = `/${path.join("/")}${request.nextUrl.search}`;

  const hasBody = request.method === "POST" || request.method === "PATCH";

  try {
    const response = await traceApiFetch(targetPath, {
      method: request.method,
      headers: hasBody ? { "Content-Type": "application/json" } : undefined,
      body: hasBody ? await request.text() : undefined,
    });

    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": response.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (error) {
    if (error instanceof TraceApiNotConfiguredError) {
      return NextResponse.json({ error: "not_configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "backend_unreachable" }, { status: 502 });
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH };
