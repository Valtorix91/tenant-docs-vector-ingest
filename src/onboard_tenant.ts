/**
 * End-to-end walk of one tenant: provision the collection, ingest two docs,
 * ask a question as a member, then suspend the account.
 *
 *   INFRAI_API_KEY=... node --experimental-strip-types src/onboard_tenant.ts northwind
 */
import { provisionTenant, ingestDocs } from "./tenant_ingest.ts";
import { searchTenantDocs } from "./tenant_search.ts";
import { setStatus } from "./tenant_registry.ts";
import type { TenantDoc } from "./chunk_plan.ts";

const tenantId = process.argv[2] ?? "northwind";
const collection = process.env.INFRAI_VECTOR_COLLECTION;
if (!collection) {
  throw new Error("INFRAI_VECTOR_COLLECTION must name a pre-existing collection");
}

const docs: TenantDoc[] = [
  {
    docId: "seat-policy",
    title: "Seats and licences",
    body: [
      "Every workspace starts with five seats. Adding a seat takes effect immediately and is prorated to the end of the current period.",
      "Removing a seat keeps the member read-only until the period ends, so nobody loses access mid-sprint.",
    ].join("\n\n"),
    audience: "public",
    revision: "2024-11-02",
  },
  {
    docId: "billing-escalation",
    title: "Billing escalation path",
    body: "Failed invoices retry twice. After the second failure an owner is emailed and the workspace moves to a grace period of fourteen days.",
    audience: "admin",
    revision: "2024-11-02",
  },
];

const record = await provisionTenant(tenantId, collection);
console.log("collection:", record.collection);

const written = await ingestDocs(tenantId, docs);
console.log("chunks written:", written);

const answers = await searchTenantDocs(tenantId, "what happens when we remove a seat?", "member");
for (const answer of answers) {
  console.log("\n#" + answer.docId + " — " + answer.title);
  console.log(answer.passage);
}

console.log("\nstatus:", setStatus(tenantId, "suspended").status);
