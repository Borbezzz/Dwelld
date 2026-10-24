import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

/** Extract bounded categories only: driver error messages can contain credentials/hosts. */
export function databaseDiagnostics(error: unknown): string[] {
  const categories = new Set<string>();
  const seen = new Set<object>();
  function visit(value: unknown, depth = 0) {
    if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return;
    seen.add(value);
    const item = value as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown; reason?: unknown; error?: unknown; servers?: unknown };
    const text = typeof item.message === "string" ? item.message : "";
    const code = typeof item.code === "string" ? item.code : "";
    if (["ENOTFOUND", "EAI_AGAIN", "ENODATA", "ESERVFAIL"].includes(code) || /querySrv|queryTxt/.test(text)) categories.add("dns_resolution");
    if (["ETIMEDOUT", "ETIMEOUT"].includes(code) || /timed out|timeout/i.test(text)) categories.add("connection_timeout");
    if (code === "ECONNREFUSED") categories.add("connection_refused");
    if (code === "ECONNRESET" || /connection.*closed|socket.*closed/i.test(text)) categories.add("connection_closed");
    if (code === "ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR" || /tlsv1 alert internal error/i.test(text)) categories.add("tls_remote_internal_alert");
    if (/CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|ERR_TLS_CERT_ALTNAME_INVALID/.test(code)) categories.add("tls_certificate_validation");
    if (/ERR_SSL_UNSUPPORTED_PROTOCOL|ERR_SSL_WRONG_VERSION_NUMBER|ERR_TLS_PROTOCOL_VERSION_CONFLICT/.test(code)) categories.add("tls_protocol_version");
    if (/TLS|SSL|CERT|tls|ssl/.test(code) || /TLS|SSL|certificate|tlsv1/i.test(text)) categories.add("tls_handshake");
    if (item.code === 18 || /authentication failed|bad auth/i.test(text)) categories.add("authentication");
    if (item.code === 13) categories.add("authorization");
    if (/MongoParse|MongoInvalidArgument/.test(String(item.name))) categories.add("connection_configuration");
    visit(item.cause, depth + 1); visit(item.reason, depth + 1); visit(item.error, depth + 1);
    if (item.servers instanceof Map) for (const server of [...item.servers.values()].slice(0, 10)) visit(server, depth + 1);
  }
  visit(error);
  return [...categories].sort();
}

/** Classify errors without putting provider messages, URLs or credentials in logs. */
export function reportError(error: unknown, operation: string) {
  const requestId = randomUUID();
  const item = error && typeof error === "object" ? error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown } : {};
  const message = typeof item.message === "string" ? item.message : "";
  const name = typeof item.name === "string" ? item.name : "Error";
  let code = "INTERNAL_ERROR", status = 500, detail = "The request failed. Please retry and quote the request ID if it continues.";
  if (name === "RequestBodyError") { code = "INVALID_REQUEST_BODY"; status = Number(item.status) || 413; detail = message; }
  else if (message === "SEARCH_NOT_READY") { code = "SEARCH_INDEX_UNAVAILABLE"; status = 503; detail = "The required Atlas Search index is not queryable yet. Retry after indexing completes."; }
  else if (name === "AccessError") { code = "ACCESS_DENIED"; status = Number(item.status) || 401; detail = message; }
  else if (message === "AUTH_NOT_CONFIGURED") { code = "AUTH_NOT_CONFIGURED"; status = 503; detail = "Account sign-in is not configured on this deployment."; }
  else if (error instanceof SyntaxError) { code = "INVALID_JSON"; status = 400; detail = "The request body must be valid JSON."; }
  else if (/MONGODB_URI.*not configured/.test(message)) { code = "DATABASE_NOT_CONFIGURED"; status = 503; detail = "Database configuration is missing on this deployment."; }
  else if (/GEMINI.*not configured|Gemini.*not configured/.test(message)) { code = "AI_NOT_CONFIGURED"; status = 503; detail = "Damage analysis is not configured on this deployment."; }
  else if (item.code === 18 || /AuthenticationFailed|authentication failed|bad auth/i.test(message)) { code = "DATABASE_AUTH_FAILED"; status = 503; detail = "Database authentication failed. The deployment credentials need checking."; }
  else if (/MongoServerSelection|MongoNetwork/.test(name)) { code = "DATABASE_UNREACHABLE"; status = 503; detail = "The database could not be reached. Check Atlas network access and retry."; }
  else if (/MongoParse|MongoInvalidArgument/.test(name)) { code = "DATABASE_CONFIG_INVALID"; status = 503; detail = "Database connection configuration is invalid."; }
  else if (/spend(?:ing)? cap|monthly spend|billing account.*exceed/i.test(message)) { code = "AI_BILLING_BLOCKED"; status = 503; detail = "AI analysis is blocked by the provider billing or spending limit. The account owner must resolve billing before retrying."; }
  else if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(message)) { code = "AI_CREDENTIALS_INVALID"; status = 503; detail = "The AI service key is invalid. The account owner must update the service configuration."; }
  else if (item.status === 429 || /RESOURCE_EXHAUSTED|quota exceeded/i.test(message)) { code = "AI_RATE_LIMITED"; status = 429; detail = "Damage analysis is temporarily rate limited. Please retry shortly."; }
  else if (/ffmpeg|ENOENT/i.test(message)) { code = "VIDEO_PROCESSING_FAILED"; detail = "Video processing failed. Check the video format and server FFmpeg packaging."; }
  else if (operation === "app/api/search/route.ts" && /index|\$search/i.test(message)) { code = "SEARCH_INDEX_UNAVAILABLE"; status = 503; detail = "Atlas Search index is unavailable. Configure the findings_search index."; }
  // Only allow diagnostic fields that cannot contain user/provider secrets.
  console.error(JSON.stringify({ event: "api.error", requestId, operation, code, errorType: /^[A-Za-z][A-Za-z0-9]{0,60}$/.test(name) ? name : "Error", providerCode: typeof item.code === "number" ? item.code : undefined, providerStatus: typeof item.status === "number" ? item.status : undefined, databaseDiagnostics: /Mongo/.test(name) ? databaseDiagnostics(error) : undefined }));
  return { error: detail, code, requestId, status };
}
export function errorResponse(error: unknown, operation = "api.request") {
  const { status, ...body } = reportError(error, operation);
  return NextResponse.json(body, { status, headers: { "X-Request-ID": body.requestId } });
}
