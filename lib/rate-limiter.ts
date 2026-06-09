import { NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Phase 31 — audit finding [30.D5]. Long-running dev sessions
// accumulated entries forever as per-IP/per-route prefixes rotated.
// Sweep when the map grows past a soft cap; O(n) walk, amortized to
// near-zero per call. The cap is sized to comfortably exceed the
// number of distinct live keys we'd expect for a personal-dev box
// (handful of routes × handful of IPs).
const SWEEP_THRESHOLD = 256;

function maybeSweepExpired(now: number): void {
  if (store.size < SWEEP_THRESHOLD) return;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

/**
 * Simple in-memory sliding window rate limiter.
 * Returns null if allowed, or a 429 Response if blocked.
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = 10,
  windowMs: number = 60_000
): NextResponse | null {
  const now = Date.now();
  maybeSweepExpired(now);
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > maxRequests) {
    return NextResponse.json(
      { error: "Too many requests. Try again later." },
      { status: 429 }
    );
  }

  return null;
}

/**
 * Get a rate limit key from a request (uses IP or fallback).
 */
export function getRateLimitKey(
  request: Request,
  prefix: string
): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "local";
  return `${prefix}:${ip}`;
}

/**
 * Clear all rate limit entries (for testing).
 */
export function clearRateLimits(): void {
  store.clear();
}

/**
 * Test-only — expose the current store size so tests can assert the
 * sweeper actually drops expired entries. Not part of the public API.
 */
export function __rateLimiterStoreSizeForTests(): number {
  return store.size;
}
