import { NextResponse } from "next/server";

/**
 * Bearer-token gate for scheduled routes. A cron route is a public URL —
 * anyone can hit it — so it authenticates itself rather than relying on
 * nobody guessing the path.
 *
 * Fails closed: if CRON_SECRET is not configured the route refuses
 * everything rather than falling open, because an unset secret is the
 * exact deployment mistake that would otherwise make these endpoints
 * world-callable.
 *
 * Returns a response to send back when the request should be rejected,
 * or null when it may proceed.
 */
export function rejectUnauthorizedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    console.error("[cron] CRON_SECRET is not set — refusing the request.");
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not configured on this deployment." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
