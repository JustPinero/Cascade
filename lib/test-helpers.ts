import { NextRequest } from "next/server";

/**
 * Create a mock NextRequest for API route testing.
 */
export function createRequest(
  url: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  const { method = "GET", body, headers = {} } = options;

  const reqHeaders = new Headers({
    "Content-Type": "application/json",
    ...headers,
  });

  const init: { method: string; headers: Headers; body?: string } = {
    method,
    headers: reqHeaders,
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  return new NextRequest(new URL(url, "http://localhost:3000"), init);
}
