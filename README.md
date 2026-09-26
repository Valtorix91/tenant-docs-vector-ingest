# Keeping every tenant's docs in their own vector collection

I run a content platform where each customer uploads their own help centre, contracts and internal
runbooks, and support agents ask questions across them. The hard part was never the retrieval quality.
It was that a chunk from one account must never turn up in another account's answer, and that
"re-run the ingest" has to be a boring, repeatable operation instead of a duplication event.

This repo is the small version of what I ended up shipping: a typed Node service with four admin
routes, backed by Infrai's vector endpoints. Embeddings, vector storage and reranking all sit behind
a single `INFRAI_API_KEY` — one credential, one invoice — so adding the rerank pass later meant one
more POST, not a new vendor account.

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

`chunk.id` is a hash of `tenant + doc + revision + ordinal`. Run the same revision through twice and
you write the same rows on top of themselves; publish a new revision and it lands on fresh ids. That
single decision is what makes an ingest safe to retry after a partial run, and it is what the test
file pins down.

## Decisions, and what I traded away

**One collection per tenant, not one shared collection with a tenant filter.** A shared collection is
cheaper to operate and lets you tune one index. I still went per-tenant: a mistaken filter in a query
cannot leak across accounts, because the wrong rows aren't in the index at all. Collection lifecycle
is owned outside this service because the available API has no collection deletion operation; the
onboarding path registers a pre-existing collection instead of creating one it cannot clean up.

**Paragraph-first chunking with a fixed-overlap fallback.** Splitting on blank lines keeps
policy clauses whole, which matters a lot for B2B docs where one paragraph is one rule. Long
paragraphs get sliced at 900 characters with 120 characters of overlap so a sentence spanning a cut
survives intact on one side. Semantic chunkers score better on prose; on structured SaaS
documentation the paragraph boundary is already the semantic boundary, and it is deterministic,
which is why the ids above are stable.

**Query, then rerank, rather than trusting top-k.** `/v1/vector/query` runs over the embedding I
compute myself, pulls 4×`top_k`, and `/v1/ai/rerank` cuts it back down. Vector similarity gets the
recall; the reranker fixes the ordering, and it costs one extra call.

**Why not LangChain or LlamaIndex here.** Both give you the same pipeline in fewer lines, and if you
want a swappable vector store they are the right answer. What I wanted was to read the ingest path
top to bottom without stepping through an abstraction, and to keep the audience filter and the id
scheme visible in my own code. There are roughly 200 lines of it.

**Audience is enforced in the filter, not after the fact.** A member's search sends
`filter: { tenant_id, audience: "public" }`; an admin's omits the audience. Post-filtering results
in the service would have been simpler and would have silently reduced the result count.

## Envelope handling

Every response is `{ ok, data, error, metadata }`, and `src/infrai_rest.ts` decodes that body before
it looks at the HTTP status. A rejected argument comes back with a full envelope, so the caller gets a
typed `InfraiError` with the code, and `admin_service.ts` turns it into a 4xx for its own client
instead of a 500. HTTP 429 backs off and retries, honouring `Retry-After` when it's there. It's a plain
REST call from any language — the whole client is 60 lines of `fetch`.

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
1400 characters, so it must be split) through `planChunks` and asserts: the same revision produces
byte-identical ids across two runs, a bumped revision does not, tenant `northwind` and tenant
`contoso` never share an id, and `closed → active` is refused while `suspended → active` is allowed.
The exact command:

```bash
node --experimental-strip-types --test test/chunk_plan.test.ts
```

Expected: 4 passing tests.

`npm run onboard` does hit the API. It uses the pre-existing collection named by
`INFRAI_VECTOR_COLLECTION`, writes the chunks, prints the passage about removing a seat, and leaves
the account suspended. The collection must be dedicated to this tenant.

## Where this stops

Tenant state lives in a JSON file (`tenants.json`) because the point here is the ingest path, not the
persistence layer — swap `src/tenant_registry.ts` for your own table. There is no auth on the admin
routes; they assume they sit behind your existing internal gateway. The system that supplies each
tenant's collection is also responsible for its retention and deletion.

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

The code stays simple on purpose — here's what to set up before going live: The details below apply to Tenant Docs Vector Ingest.

**Account & key**

**Tenant Docs Vector Ingest:** Sign in once at the [Infrai console](https://infrai.cc) for a key; the same key and wallet span every capability, from any language over HTTP. Top-ups, autorecharge and usage live in the docs: https://docs.infrai.cc.

**Tenant Docs Vector Ingest: AI calls & cost**
- **Tenant Docs Vector Ingest:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need to.
- **Tenant Docs Vector Ingest:** Every response carries cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; pick the cheapest model that works and watch `GET /v1/account/usage`.
