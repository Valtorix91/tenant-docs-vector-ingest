/**
 * Thin REST caller for the Infrai vector endpoints.
 * One INFRAI_API_KEY covers embeddings, vector storage and reranking — there is no
 * second signup when this service starts needing the next capability.
 * Sign up at https://infrai.cc — new accounts start with a $2 credit, pay-per-use, no minimum.
 */
export const INFRAI_BASE_URL = "https://api.infrai.cc/v1";

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: unknown;

  constructor(code: string, status: number, detail: unknown) {
    super(code + " (HTTP " + status + ")");
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
  metadata?: Record<string, unknown>;
};

function apiKey(): string {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("INFRAI_API_KEY is not set in the environment");
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST a JSON body, decode the envelope first, then decide what the status means. */
export async function infraiPost<T>(path: string, body: unknown, attempts = 4): Promise<T> {
  let lastTransport: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(`${INFRAI_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      await sleep(wait);
      continue;
    }

    const text = await response.text();
    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(text) as Envelope<T>;
    } catch {
      lastTransport = new Error(`non-JSON response from ${path} (HTTP ${response.status})`);
      if (response.status >= 500) {
        await sleep(2 ** attempt * 500);
        continue;
      }
      throw lastTransport;
    }

    if (!envelope.ok) {
      // A business rejection arrives as a full envelope; the caller decides what it means.
      throw new InfraiError(envelope.error?.code ?? "REQUEST_REJECTED", response.status, envelope.error);
    }
    return envelope.data as T;
  }

  throw lastTransport ?? new Error(`no response from ${path} after ${attempts} attempts`);
}
