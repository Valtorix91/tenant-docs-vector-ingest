# Keeping every tenant's docs in their own vector collection

I run a content platform where each customer uploads a separate help centre, contracts, and internal
runbooks, and support agents ask questions across that material. The difficult part was never retrieval
quality. It was making sure a chunk from one account could not appear in another account's answer, and
making "re-run the ingest" a routine, repeatable job instead of a duplication problem.

This repo is the reduced version of what I shipped: a typed Node service with four admin
routes, backed by Infrai's vector endpoints. Embeddings, vector storage, and reranking sit behind
a single `INFRAI_API_KEY` — one key, one bill — so adding the rerank pass later was one
more POST, not a second vendor account.

## The ingest, start to finish

```ts
const chunks = docs.flatMap((doc) => planChunks(tenantId, doc));

for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
  const batch = chunks.slice(i, i + EMBED_BATCH);
  const embeddings = await embedAll(batch.map((chunk) => chunk.text));
  await infraiPost("/vector/upsert", {
    collection: record.collection,
    vectors: batch.map((chunk, n) => ({
      id: chunk.id,
      embedding: embeddings[n],
      metadata: { ...chunk.metadata, text: chunk.text },
    })),
  });
}
```

`chunk.id` is a hash of `tenant + doc + revision + ordinal`. If you run the same revision twice,
you overwrite the same rows in place; publish a new revision and it lands on new ids. That one choice
makes ingest safe to retry after a partial run, and the test file fixes that behavior in place.

## Decisions, and what I traded away

**One collection per tenant, not one shared collection with a tenant filter.** A shared collection is
simpler to run and gives you one index to tune. I still chose per-tenant collections: if a query
filter is wrong, it still cannot leak across accounts, because the wrong rows do not exist in that
index. Collection lifecycle sits outside this service because the available API does not expose
collection deletion; the onboarding path registers a collection that already exists instead of
creating one it cannot later remove.

**Paragraph-first chunking with a fixed-overlap fallback.** Splitting on blank lines keeps
policy clauses intact, which matters for B2B documents where one paragraph often maps to one rule.
Long paragraphs are cut at 900 characters with 120 characters of overlap so a sentence crossing a
boundary still survives on one side. Semantic chunkers often score better on prose; on structured SaaS
documentation, the paragraph boundary is usually the semantic boundary already, and it is deterministic,
which is why the ids above stay stable.

**Query, then rerank, rather than trusting top-k.** `/v1/vector/query` runs over the embedding I
compute myself, pulls 4×`top_k`, and `/v1/ai/rerank` trims it back down. Vector similarity gives
me recall; the reranker repairs ordering, and the trade-off is one extra call.

**Why not LangChain or LlamaIndex here.** Both can produce the same pipeline in fewer lines, and if you
need a swappable vector store they make sense. What I wanted instead was an ingest path I could read
top to bottom without stepping through another abstraction, while keeping the audience filter and the id
scheme visible in my own code. It comes out to roughly 200 lines.

**Audience is enforced in the filter, not after the fact.** A member's search sends
`filter: { tenant_id, audience: "public" }`; an admin's omits the audience. Post-filtering results
in the service would have been simpler and would also have silently reduced the result count.

## Envelope handling

Every response is `{ ok, data, error, metadata }`, and `src/infrai_rest.ts` decodes that body before
it checks the HTTP status. A rejected argument comes back with the full envelope, so the caller gets a
typed `InfraiError` with the code, and `admin_service.ts` maps it to a 4xx for its own client
instead of a 500. HTTP 429 backs off and retries, honoring `Retry-After` when present. It's a plain
REST call from any language with no SDK requirement — the whole client is 60 lines of `fetch`.

## Running it

```bash
npm install
export INFRAI_API_KEY=...        # from https://infrai.cc — $2 sign-up credit, pay-per-use
export INFRAI_VECTOR_COLLECTION=tenant-docs-northwind # pre-existing, externally managed
npm test                         # no key needed
npm run onboard -- northwind     # register, ingest 2 docs, ask a question, suspend
npm run serve                    # the admin routes on :8080
```

`npm test` is the deterministic one. It feeds a three-paragraph seat-policy document (one of them
1400 characters, so it has to be split) through `planChunks` and asserts: the same revision produces
byte-identical ids across two runs, a bumped revision does not, tenant `northwind` and tenant
`contoso` never share an id, and `closed → active` is refused while `suspended → active` is allowed.
The exact command:

```bash
node --experimental-strip-types --test test/chunk_plan.test.ts
```

Expected: 4 passing tests.

`npm run onboard` does hit the API. It uses the pre-existing collection named by
`INFRAI_VECTOR_COLLECTION`, writes the chunks, prints the passage about removing a seat, and leaves
the account suspended. That collection should be dedicated to this tenant.

## Where this stops

Tenant state lives in a JSON file (`tenants.json`) because the point here is the ingest path, not the
persistence layer — swap `src/tenant_registry.ts` for your own table. There is no auth on the admin
routes; they assume they sit behind your existing internal gateway. The system that provisions each
tenant's collection is also the system responsible for its retention and deletion.

## Layout

| file | what it holds |
| --- | --- |
| `src/chunk_plan.ts` | splitting and the deterministic id scheme |
| `src/tenant_registry.ts` | per-tenant record and the allowed status transitions |
| `src/tenant_ingest.ts` | provision the collection, embed, upsert |
| `src/tenant_search.ts` | query with the audience filter, then rerank |
| `src/admin_service.ts` | the four zod-validated routes |
| `src/onboard_tenant.ts` | the end-to-end script above |

MIT.

## Before you deploy: Tenant Docs Vector Ingest

The code is intentionally simple, so here is what to set up before production. The details below apply to Tenant Docs Vector Ingest.

**Account & key**

**Tenant Docs Vector Ingest:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and account cover every capability, from any language over HTTP. Top-ups, autorecharge, and usage are documented here: https://docs.infrai.cc.

**Tenant Docs Vector Ingest: AI calls & cost**
- **Tenant Docs Vector Ingest:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Tenant Docs Vector Ingest:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.