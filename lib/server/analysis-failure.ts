/** Safe public categories. Provider messages may contain keys, prompts and private URLs. */
export function analysisFailure(error: unknown) {
  const item = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown; message?: unknown } : {};
  const message = typeof item.message === 'string' ? item.message : '';
  const status = Number(item.status ?? item.code);
  if (/spend(?:ing)? cap|monthly spend|billing account.*exceed|insufficient.*(?:credit|balance)|billing.*(?:disabled|not enabled)/i.test(message))
    return { code: 'AI_BILLING_BLOCKED', message: 'AI analysis is blocked by the provider billing or spending limit. The account owner must resolve billing before retrying.', retryable: false, blocksService: true };
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|invalid api key/i.test(message))
    return { code: 'AI_ACCESS_DENIED', message: 'The AI service credentials or permissions need checking before analysis can continue.', retryable: false, blocksService: true };
  if (status === 404 || /model.*not found|GEMINI_API_KEY|not configured/i.test(message))
    return { code: 'AI_NOT_CONFIGURED', message: 'The AI service model or credentials are unavailable. Configuration needs checking before retrying.', retryable: false, blocksService: true };
  if (status === 429 || /RESOURCE_EXHAUSTED/i.test(message))
    return { code: 'AI_RATE_LIMITED', message: 'The AI service is temporarily rate limited. Retry later.', retryable: true, blocksService: false };
  if ([500, 502, 503, 504].includes(status) || /timeout|timed out|DEADLINE_EXCEEDED|fetch failed/i.test(message))
    return { code: 'AI_UNAVAILABLE', message: 'The AI service timed out or was temporarily unavailable.', retryable: true, blocksService: false };
  return { code: 'AI_INVALID_RESPONSE', message: 'The AI check did not return a usable result.', retryable: false, blocksService: false };
}

/** One line in the server logs (Vercel → Logs) for every failed AI call, without keys or prompts. */
export function logAIFailure(where: string, error: unknown) {
  const item = error && typeof error === 'object' ? error as { status?: unknown; code?: unknown; message?: unknown } : {};
  const message = typeof item.message === 'string' ? item.message.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[key]').slice(0, 240) : String(error).slice(0, 240);
  console.error(JSON.stringify({ event: 'ai.failed', where, code: analysisFailure(error).code, status: item.status ?? item.code ?? null, model: process.env.GEMINI_MODEL || 'gemini-4-argon', message }));
}
