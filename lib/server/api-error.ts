import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

/** Classify errors without putting provider messages, URLs or credentials in logs. */
export function reportError(error: unknown, operation: string) {
  const requestId = randomUUID();
  const item = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown } : {};
  const message = typeof item.message === "string" ? item.message : "";
  const name = typeof item.name === "string" ? item.name : "Error";
  let code = "INTERNAL_ERROR", status = 500, detail = "The request failed. Please retry and quote the request ID if it continues.";
  if (error instanceof SyntaxError) { code = "INVALID_JSON"; status = 400; detail = "The request body must be valid JSON."; }
  else if (/MONGODB_URI.*not configured/.test(message)) { code = "DATABASE_NOT_CONFIGURED"; status = 503; detail = "Database configuration is missing on this deployment."; }
  else if (/GEMINI.*not configured|Gemini.*not configured/.test(message)) { code = "AI_NOT_CONFIGURED"; status = 503; detail = "Damage analysis is not configured on this deployment."; }
  else if (item.code === 18 || /AuthenticationFailed|authentication failed|bad auth/i.test(message)) { code = "DATABASE_AUTH_FAILED"; status = 503; detail = "Database authentication failed. The deployment credentials need checking."; }
  else if (/MongoServerSelection|MongoNetwork/.test(name)) { code = "DATABASE_UNREACHABLE"; status = 503; detail = "The database could not be reached. Check Atlas network access and retry."; }
  else if (/MongoParse|MongoInvalidArgument/.test(name)) { code = "DATABASE_CONFIG_INVALID"; status = 503; detail = "Database connection configuration is invalid."; }
  else if (item.status === 429 || /RESOURCE_EXHAUSTED|quota exceeded/i.test(message)) { code = "AI_RATE_LIMITED"; status = 429; detail = "Damage analysis is temporarily rate limited. Please retry shortly."; }
  else if (/ffmpeg|ENOENT/i.test(message)) { code = "VIDEO_PROCESSING_FAILED"; detail = "Video processing failed. Check the video format and server FFmpeg packaging."; }
  else if (operation === "app/api/search/route.ts" && /index|\$search/i.test(message)) { code = "SEARCH_INDEX_UNAVAILABLE"; status = 503; detail = "Atlas Search index is unavailable. Configure the findings_search index."; }
  // Only allow diagnostic fields that cannot contain user/provider secrets.
  console.error(JSON.stringify({ event: "api.error", requestId, operation, code, errorType: /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(name) ? name : "Error", providerCode: typeof item.code === "number" ? item.code : undefined, providerStatus: typeof item.status === "number" ? item.status : undefined }));
  return { error: detail, code, requestId, status };
}
export function errorResponse(error: unknown, operation = "api.request") {
  const { status, ...body } = reportError(error, operation);
  return NextResponse.json(body, { status, headers: { "X-Request-ID": body.requestId } });
}
