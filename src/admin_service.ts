import { createServer } from "node:http";
import { z } from "zod";
import { InfraiError } from "./infrai_rest.ts";
import { provisionTenant, ingestDocs } from "./tenant_ingest.ts";
import { searchTenantDocs } from "./tenant_search.ts";
import { getTenant, setStatus, type TenantStatus } from "./tenant_registry.ts";
import type { TenantDoc } from "./chunk_plan.ts";

const OnboardBody = z.object({
  tenantId: z.string().regex(/^[a-z0-9-]{3,40}$/),
  collection: z.string().min(1),
});

const IngestBody = z.object({
  tenantId: z.string().min(1),
  docs: z
    .array(
      z.object({
        docId: z.string().min(1),
        title: z.string().min(1),
        body: z.string().min(1),
        audience: z.enum(["public", "admin"]),
        revision: z.string().min(1),
      }),
    )
    .min(1),
});

const SearchBody = z.object({
  tenantId: z.string().min(1),
  question: z.string().min(3),
  role: z.enum(["member", "admin"]).default("member"),
});

const StatusBody = z.object({
  tenantId: z.string().min(1),
  status: z.enum(["onboarding", "active", "suspended", "closed"]),
});

async function readJson(stream: NodeJS.ReadableStream): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const routes: Record<string, (body: unknown) => Promise<unknown>> = {
  "/tenants/onboard": async (body) => {
    const input = OnboardBody.parse(body);
    return provisionTenant(input.tenantId, input.collection);
  },
  "/tenants/ingest": async (body) => {
    const input = IngestBody.parse(body);
    return { chunksWritten: await ingestDocs(input.tenantId, input.docs as TenantDoc[]) };
  },
  "/tenants/search": async (body) => {
    const input = SearchBody.parse(body);
    return { answers: await searchTenantDocs(input.tenantId, input.question, input.role) };
  },
  "/tenants/status": async (body) => {
    const input = StatusBody.parse(body);
    return setStatus(input.tenantId, input.status as TenantStatus);
  },
  "/tenants/get": async (body) => getTenant(z.object({ tenantId: OnboardBody.shape.tenantId }).parse(body).tenantId) ?? null,
};

export const server = createServer(async (req, res) => {
  const handler = req.method === "POST" ? routes[req.url ?? ""] : undefined;
  const send = (status: number, payload: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  if (!handler) return send(404, { error: "no such route" });

  try {
    send(200, await handler(await readJson(req)));
  } catch (err) {
    if (err instanceof z.ZodError) return send(400, { error: "invalid body", issues: err.issues });
    // A rejection carried in the envelope is the caller's problem, so it stays a 4xx here.
    if (err instanceof InfraiError) return send(err.status < 500 ? 422 : 502, { error: err.code, detail: err.detail });
    send(409, { error: (err as Error).message });
  }
});

if (process.argv[1]?.endsWith("admin_service.ts")) {
  const port = Number(process.env.PORT ?? 8080);
  server.listen(port, () => console.log("admin service on http://localhost:" + port));
}
