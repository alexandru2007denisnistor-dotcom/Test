export class ProviderError extends Error {
  constructor(provider, message, { status = 502, code = 'provider_error' } = {}) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}

/**
 * fetch + JSON mit Timeout. `fetchImpl` ist austauschbar (Tests).
 */
export async function fetchJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 8000, provider = 'http', ...init } = {}) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    throw new ProviderError(provider, timeout ? 'Zeitüberschreitung' : `Nicht erreichbar (${err?.message || err})`, {
      status: 504,
      code: timeout ? 'timeout' : 'network',
    });
  }
  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text.slice(0, 200) };
    }
  }
  return { status: res.status, ok: res.ok, headers: res.headers, body };
}
