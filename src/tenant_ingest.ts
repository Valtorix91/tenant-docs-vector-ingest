import { infraiPost } from "./infrai_rest.ts";
import { embedAll } from "./embed.ts";
import { planChunks, type TenantDoc } from "./chunk_plan.ts";
import { getTenant, putTenant, type TenantRecord } from "./tenant_registry.ts";

const EMBED_BATCH = 32;

/** Register a collection managed outside this service for the tenant. */
export async function provisionTenant(tenantId: string, collection: string): Promise<TenantRecord> {
  return putTenant({ tenantId, collection, status: "onboarding", docCount: 0 });
}

export async function ingestDocs(tenantId: string, docs: TenantDoc[]): Promise<number> {
  const record = getTenant(tenantId);
  if (!record) throw new Error("provision the tenant before ingesting");
  if (record.status === "suspended" || record.status === "closed") {
    throw new Error("tenant " + tenantId + " is " + record.status + "; ingest is not accepted");
  }

  const chunks = docs.flatMap((doc) => planChunks(tenantId, doc));
  let written = 0;

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
    written += batch.length;
  }

  putTenant({ ...record, status: "active", docCount: record.docCount + docs.length });
  return written;
}
