import { infraiPost } from "./infrai_rest.ts";
import { embedOne } from "./embed.ts";
import { getTenant } from "./tenant_registry.ts";

type Match = {
  id: string;
  score: number;
  metadata?: { text?: string; title?: string; doc_id?: string; audience?: string };
};

export type Answer = {
  docId: string;
  title: string;
  passage: string;
};

/**
 * Search one tenant's collection. An ordinary seat only ever sees "public" chunks;
 * the audience filter is applied server-side, not after the fact.
 */
export async function searchTenantDocs(
  tenantId: string,
  question: string,
  role: "member" | "admin",
  topK = 3,
): Promise<Answer[]> {
  const record = getTenant(tenantId);
  if (!record) throw new Error("unknown tenant " + tenantId);
  if (record.status !== "active") throw new Error("tenant " + tenantId + " is " + record.status);

  const embedding = await embedOne(question);
  const result = await infraiPost<{ matches?: Match[] }>("/vector/query", {
    collection: record.collection,
    embedding,
    top_k: topK * 4,
    filter: role === "admin" ? { tenant_id: tenantId } : { tenant_id: tenantId, audience: "public" },
    include_metadata: true,
  });

  const matches = result.matches ?? [];
  if (matches.length === 0) return [];

  const candidates = matches.map((match) => match.metadata?.text ?? "");
  const ranked = await infraiPost<{ results?: { index: number }[] }>("/ai/rerank", {
    query: question,
    candidates,
    top_k: topK,
    model: "auto",
  });

  return (ranked.results ?? []).map((entry) => {
    const match = matches[entry.index];
    return {
      docId: match.metadata?.doc_id ?? match.id,
      title: match.metadata?.title ?? "",
      passage: match.metadata?.text ?? "",
    };
  });
}
