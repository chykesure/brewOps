// Server-only security helpers: brute-force rate limiting, same-origin enforcement,
// client IP extraction and the security audit trail. Used by the auth routes.
import "server-only";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Login rate limiting — sliding window per IP+identity, then a cool-off lock.
// In-memory by design: the pilot runs a single node. State resets on restart,
// which is acceptable for a throttle (the DB audit trail still keeps evidence).
// ---------------------------------------------------------------------------

const WINDOW_MS = 15 * 60_000; // 15 minutes
const MAX_FAILS = 5; // failed attempts inside the window before lockout
const LOCK_MS = 15 * 60_000; // cool-off once locked

interface FailState {
  fails: number[]; // timestamps of recent failures
  lockedUntil: number;
}

const globalForRate = globalThis as unknown as { __loginFails?: Map<string, FailState> };
const fails: Map<string, FailState> = globalForRate.__loginFails ?? new Map();
globalForRate.__loginFails = fails;

export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

export type RateVerdict = { ok: true } | { ok: false; retryAfterMin: number };

export function loginRateOk(key: string): RateVerdict {
  const now = Date.now();
  const st = fails.get(key);
  if (st && st.lockedUntil > now) {
    return { ok: false, retryAfterMin: Math.max(1, Math.ceil((st.lockedUntil - now) / 60_000)) };
  }
  return { ok: true };
}

export function recordLoginFail(key: string): number {
  const now = Date.now();
  const st = fails.get(key) ?? { fails: [], lockedUntil: 0 };
  st.fails = st.fails.filter((t) => now - t < WINDOW_MS);
  st.fails.push(now);
  if (st.fails.length >= MAX_FAILS) {
    st.lockedUntil = now + LOCK_MS;
    st.fails = [];
  }
  fails.set(key, st);
  return st.lockedUntil > now ? Math.ceil((st.lockedUntil - now) / 60_000) : 0;
}

export function clearLoginFails(key: string) {
  fails.delete(key);
}

// ---------------------------------------------------------------------------
// Same-origin enforcement for state-changing requests (CSRF hardening on top of
// SameSite=Lax cookies). The verdict is driven by the browser-computed
// Sec-Fetch-Site header (proxy-proof, unspoofable); the Origin/Host comparison
// only remains as a legacy fallback and flags mismatches instead of blocking,
// because behind the gateway proxy the internal Host can never match the
// public Origin (see csrfVerdict).
// ---------------------------------------------------------------------------

function hostOf(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .map((h) => {
      try {
        return new URL(`//${h}`, "http://x").hostname;
      } catch {
        return h.split(":")[0];
      }
    });
}

export type CsrfVerdict = { allow: boolean; flagged: boolean };

/**
 * CSRF verdict for browser-initiated state changes.
 *
 * Primary signal: the browser-computed Sec-Fetch-Site header. It is set by the
 * browser itself, cannot be forged by page JavaScript, and is completely
 * independent of proxy header rewriting, so it works identically for direct
 * access and behind the public gateway. cross-site is rejected outright.
 *
 * Fallback for older browsers without Sec-Fetch-Site: compare the Origin
 * hostname against Host / X-Forwarded-Host. When they disagree we ALLOW the
 * request but FLAG it, because behind a proxy chain the internal Host never
 * matches the public Origin (this exact false positive used to lock the
 * engineer out with "Request blocked"). The SameSite=Lax session cookie is the
 * real CSRF backstop for those requests; the audit trail surfaces any abuse.
 */
export function csrfVerdict(req: NextRequest): CsrfVerdict {
  const fetchSite = req.headers.get("sec-fetch-site")?.toLowerCase().trim();
  if (fetchSite) {
    return { allow: fetchSite !== "cross-site", flagged: false };
  }

  const origin = req.headers.get("origin");
  if (!origin) return { allow: true, flagged: false }; // non-browser clients (curl, health checks)

  let originHost: string;
  try {
    originHost = new URL(origin).hostname.toLowerCase();
  } catch {
    return { allow: false, flagged: false }; // malformed Origin header — reject
  }

  const allowed = new Set<string>([
    ...hostOf(req.headers.get("host")),
    ...hostOf(req.headers.get("x-forwarded-host")),
  ]);

  if (allowed.size === 0) return { allow: true, flagged: false };
  if (allowed.has(originHost)) return { allow: true, flagged: false };
  return { allow: true, flagged: true };
}

/** Backwards-compatible boolean wrapper used by the JSON API routes. */
export function sameOrigin(req: NextRequest): boolean {
  return csrfVerdict(req).allow;
}

/** Compact header evidence for the security audit trail. */
export function csrfEvidence(req: NextRequest): string {
  return [
    `origin=${req.headers.get("origin") ?? "none"}`,
    `host=${req.headers.get("host") ?? "none"}`,
    `xfh=${req.headers.get("x-forwarded-host") ?? "none"}`,
    `sec-fetch-site=${req.headers.get("sec-fetch-site") ?? "none"}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Security audit trail
// ---------------------------------------------------------------------------

export async function logSecurityEvent(input: {
  userId?: string | null;
  email?: string | null;
  kind: string;
  detail?: string | null;
  ip?: string | null;
  ua?: string | null;
}) {
  try {
    await db.securityEvent.create({
      data: {
        userId: input.userId ?? null,
        email: input.email ?? null,
        kind: input.kind,
        detail: input.detail?.slice(0, 300) ?? null,
        ip: input.ip ?? null,
        ua: input.ua?.slice(0, 200) ?? null,
      },
    });
  } catch {
    // The audit trail must never break the request path
  }
}
