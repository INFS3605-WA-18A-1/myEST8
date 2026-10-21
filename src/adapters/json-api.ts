// Shared plumbing for the JSON HTTP APIs behind the classifier, image matcher,
// quote reader and places ports. A call that fails throws, and the worker
// retries the task that made it.

const TIMEOUT_MS = 15_000;
const EXCERPT_LENGTH = 200;

const excerpt = (text: string) => (text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH)}…` : text);

/**
 * Sends one request and returns the parsed JSON body. A body is sent as JSON with
 * POST. Throws on a timeout, a non-2xx status or a body that isn't JSON. Error
 * messages never include the URL, which can carry an API key.
 */
export async function callJson(
  fetchImpl: typeof fetch,
  service: string,
  url: string,
  options: { headers: Record<string, string>; body?: unknown; timeoutMs?: number },
): Promise<unknown> {
  const hasBody = options.body !== undefined;
  const response = await fetchImpl(url, {
    method: hasBody ? 'POST' : 'GET',
    headers: { accept: 'application/json', ...(hasBody ? { 'content-type': 'application/json' } : {}), ...options.headers },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${service} returned ${response.status}: ${excerpt(text)}`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${service} returned a body that is not JSON: ${excerpt(text)}`);
  }
}

/** Throws for a response that doesn't have the expected shape. */
export function malformed(service: string, problem: string, body: unknown): never {
  throw new Error(`${service} returned a malformed response (${problem}): ${excerpt(JSON.stringify(body) ?? String(body))}`);
}

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
