import { readFileSync, writeFileSync, existsSync } from "node:fs";

export type TenantStatus = "onboarding" | "active" | "suspended" | "closed";

export type TenantRecord = {
  tenantId: string;
  collection: string;
  status: TenantStatus;
  docCount: number;
};

const STATE_FILE = process.env.TENANT_STATE_FILE ?? "tenants.json";

/** Which transitions an admin call is allowed to make. */
const ALLOWED: Record<TenantStatus, TenantStatus[]> = {
  onboarding: ["active", "closed"],
  active: ["suspended", "closed"],
  suspended: ["active", "closed"],
  closed: [],
};

export function canTransition(from: TenantStatus, to: TenantStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** One collection per tenant: the tenant id is the isolation boundary, not a filter. */
export function collectionFor(tenantId: string): string {
  return "tenant-docs-" + tenantId;
}

function load(): Record<string, TenantRecord> {
  if (!existsSync(STATE_FILE)) return {};
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as Record<string, TenantRecord>;
}

function save(state: Record<string, TenantRecord>): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function getTenant(tenantId: string): TenantRecord | undefined {
  return load()[tenantId];
}

export function putTenant(record: TenantRecord): TenantRecord {
  const state = load();
  state[record.tenantId] = record;
  save(state);
  return record;
}

export function setStatus(tenantId: string, next: TenantStatus): TenantRecord {
  const record = getTenant(tenantId);
  if (!record) throw new Error("unknown tenant " + tenantId);
  if (!canTransition(record.status, next)) {
    throw new Error("cannot move tenant " + tenantId + " from " + record.status + " to " + next);
  }
  return putTenant({ ...record, status: next });
}
