import { createHash } from "node:crypto";

export type TenantDoc = {
  /** Stable id from the source system (help-center article id, contract id, ...). */
  docId: string;
  title: string;
  body: string;
  /** "public" docs are searchable by every seat; "admin" docs only by admins. */
  audience: "public" | "admin";
  revision: string;
};

export type Chunk = {
  id: string;
  text: string;
  metadata: {
    tenant_id: string;
    doc_id: string;
    audience: "public" | "admin";
    revision: string;
    ordinal: number;
    title: string;
  };
};

const MAX_CHARS = 900;
const OVERLAP_CHARS = 120;

/**
 * Split on paragraph boundaries, then pack paragraphs up to MAX_CHARS.
 * A paragraph longer than MAX_CHARS is sliced with a fixed overlap, so a sentence
 * that straddles a cut still appears whole in one of the two neighbours.
 */
export function splitDocument(body: string): string[] {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHARS) {
      pieces.push(paragraph);
      continue;
    }
    for (let start = 0; start < paragraph.length; start += MAX_CHARS - OVERLAP_CHARS) {
      pieces.push(paragraph.slice(start, start + MAX_CHARS).trim());
      if (start + MAX_CHARS >= paragraph.length) break;
    }
  }

  const packed: string[] = [];
  let buffer = "";
  for (const piece of pieces) {
    if (!buffer) buffer = piece;
    else if (buffer.length + piece.length + 2 <= MAX_CHARS) buffer += "\n\n" + piece;
    else {
      packed.push(buffer);
      buffer = piece;
    }
  }
  if (buffer) packed.push(buffer);
  return packed;
}

/**
 * The vector id is derived from tenant + doc + revision + ordinal, so re-running an
 * ingest for the same revision writes the same rows again instead of duplicating them,
 * and a new revision lands on fresh ids.
 */
export function chunkId(tenantId: string, doc: TenantDoc, ordinal: number): string {
  const digest = createHash("sha256")
    .update([tenantId, doc.docId, doc.revision, String(ordinal)].join(" "))
    .digest("hex")
    .slice(0, 32);
  return doc.docId + "-" + ordinal + "-" + digest;
}

export function planChunks(tenantId: string, doc: TenantDoc): Chunk[] {
  return splitDocument(doc.body).map((text, ordinal) => ({
    id: chunkId(tenantId, doc, ordinal),
    text,
    metadata: {
      tenant_id: tenantId,
      doc_id: doc.docId,
      audience: doc.audience,
      revision: doc.revision,
      ordinal,
      title: doc.title,
    },
  }));
}
