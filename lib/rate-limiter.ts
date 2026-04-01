import { NextResponse } from "next/server";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

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
