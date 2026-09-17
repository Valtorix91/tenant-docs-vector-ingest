import test from "node:test";
import assert from "node:assert/strict";
import { planChunks, type TenantDoc } from "../src/chunk_plan.ts";
import { canTransition } from "../src/tenant_registry.ts";

const doc: TenantDoc = {
  docId: "seat-policy",
  title: "Seats and licences",
  body: ["A".repeat(500), "B".repeat(1400), "C".repeat(200)].join("\n\n"),
  audience: "public",
  revision: "2024-11-02",
};

test("re-ingesting the same revision reuses the same vector ids", () => {
  const first = planChunks("northwind", doc);
  const second = planChunks("northwind", doc);
  assert.deepEqual(
    first.map((c) => c.id),
    second.map((c) => c.id),
  );
});

test("a new revision produces new ids, and another tenant never collides", () => {
  const base = planChunks("northwind", doc)[0].id;
  const revised = planChunks("northwind", { ...doc, revision: "2024-12-01" })[0].id;
  const otherTenant = planChunks("contoso", doc)[0].id;
  assert.notEqual(base, revised);
  assert.notEqual(base, otherTenant);
});

test("every chunk stays under the embedding window and keeps its tenant tag", () => {
  const chunks = planChunks("northwind", doc);
  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 900, "chunk of " + chunk.text.length + " chars is too long");
    assert.equal(chunk.metadata.tenant_id, "northwind");
    assert.equal(chunk.metadata.audience, "public");
  }
  assert.deepEqual(
    chunks.map((c) => c.metadata.ordinal),
    chunks.map((_, i) => i),
  );
});

test("a closed account cannot be reactivated by an admin call", () => {
  assert.equal(canTransition("suspended", "active"), true);
  assert.equal(canTransition("closed", "active"), false);
});
