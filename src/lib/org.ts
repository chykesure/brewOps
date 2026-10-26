// Server-only org identity reader — company name + report logo + branches.
// Backs every printed document (WO report, daily report, machine status log).
import "server-only";
import { db } from "@/lib/db";
import type { BranchDTO, OrgDTO } from "@/lib/types";

export const DEFAULT_ORG_NAME = "INTERNATIONAL BREWERIES PLC.";

export async function readOrg(): Promise<OrgDTO> {
  const [rows, branches] = await Promise.all([
    db.settings.findMany({ where: { key: { in: ["orgName", "logoUrl"] } } }),
    db.branch.findMany({ orderBy: { name: "asc" } }),
  ]);
  const get = (k: string) => rows.find((r) => r.key === k)?.value ?? null;
  const branchDTOs: BranchDTO[] = branches.map((b) => ({
    id: b.id, name: b.name, location: b.location, active: b.active,
  }));
  return {
    name: get("orgName") || DEFAULT_ORG_NAME,
    logoUrl: get("logoUrl") || null,
    branches: branchDTOs,
  };
}
