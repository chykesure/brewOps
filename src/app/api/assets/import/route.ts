import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { parseCsv, numOrNull } from "@/lib/csv";
import { PM_CYCLES } from "@/lib/types";
import { tagCodeFor } from "@/lib/geo";

const HEADERS = ["type", "code", "name", "department", "location", "functionalLoc", "equipmentNo", "pmCycle", "pmDay", "ownerEmail", "lat", "lng", "machineCode", "partCode", "category"] as const;

const TEMPLATE = [
  HEADERS.join(","),
  `MACHINE,P-210,Mash Tun Agitator,Brewhouse,Brewhouse Hall A,1Nl-B-BR1-P210-MAT,10000210,WEEKLY,1,yusuf@brewops.ng,,,`,
  `MACHINE,CT-204,Glycol Transfer Pump,Cellars,Cellar 2,1Nl-B-CL1-CT204-GTP,10000211,WEEKLY,5,eze@brewops.ng,7.6167,4.7333,,`,
  `COMPONENT,,Gearbox Oil Seal,,,,,,,,,,P-210,SK-12,Seal`,
  `COMPONENT,,Agitator Drive Motor,,,,,,,,,,P-210,MTR-315,Electrical`,
].join("\n");

// GET /api/assets/import?template=1 — download the CSV template for bulk equipment loading
export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  return new NextResponse(TEMPLATE, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="brewops-equipment-import-template.csv"',
    },
  });
}

interface RowResult {
  row: number;
  type: string;
  code: string;
  name: string;
  status: "CREATE" | "UPDATE" | "ERROR";
  message: string;
}

// POST /api/assets/import — bulk-load real machines & sub-components (validate, then commit)
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  try {
    const body = await req.json();
    const csv = String(body?.csv ?? "");
    const commit = body?.commit === true;
    if (!csv.trim()) return NextResponse.json({ error: "Paste CSV text or attach a .csv file first." }, { status: 400 });

    const rows = parseCsv(csv);
    if (rows.length < 2) return NextResponse.json({ error: "CSV needs a header row and at least one data row." }, { status: 400 });

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx: Record<string, number> = {};
    HEADERS.forEach((h) => { idx[h] = header.indexOf(h.toLowerCase()); });
    if (idx.type < 0 || idx.name < 0) {
      return NextResponse.json({ error: `Header row must contain at least "type" and "name" columns.` }, { status: 400 });
    }

    // Prefetch lookups
    const [dbMachines, users, parts, departments] = await Promise.all([
      db.machine.findMany({ select: { code: true, id: true } }),
      db.user.findMany({ select: { email: true, id: true, name: true } }),
      db.part.findMany({ select: { code: true, id: true } }),
      db.department.findMany({ select: { id: true, name: true } }),
    ]);
    const machineByCode = new Map(dbMachines.map((m) => [m.code.toUpperCase(), m.id]));
    const fileMachineCodes = new Set<string>(); // machines declared earlier in this same file
    const fileMachineSeen = new Map<string, number>();
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    const partByCode = new Map(parts.map((p) => [p.code.toUpperCase(), p.id]));
    const deptByName = new Map(departments.map((d) => [d.name.toLowerCase(), d.id]));

    const results: RowResult[] = [];
    const errors: RowResult[] = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const get = (h: (typeof HEADERS)[number]) => (idx[h] >= 0 && idx[h] < cells.length ? cells[idx[h]].trim() : "");
      const type = get("type").toUpperCase();
      const name = get("name");
      const code = get("code").toUpperCase();
      const machineCode = get("machineCode").toUpperCase();
      const base = { row: r + 1, type, code: type === "MACHINE" ? code : machineCode, name };

      const fail = (message: string) => {
        const res: RowResult = { ...base, status: "ERROR", message };
        results.push(res); errors.push(res);
      };

      if (type === "MACHINE") {
        if (!code) { fail("MACHINE row needs a code (e.g. P-210)"); continue; }
        if (!name) { fail("MACHINE row needs a name"); continue; }
        const dept = get("department");
        if (!dept) { fail("MACHINE row needs a department"); continue; }
        const pmCycle = (get("pmCycle") || "WEEKLY").toUpperCase();
        if (!PM_CYCLES.includes(pmCycle as (typeof PM_CYCLES)[number])) { fail(`pmCycle must be one of ${PM_CYCLES.join("/")}`); continue; }
        const pmDay = Math.min(31, Math.max(1, Number(get("pmDay")) || 1));
        if (fileMachineSeen.has(code)) { fail(`Duplicate machine code in file (first on row ${fileMachineSeen.get(code)})`); continue; }
        fileMachineSeen.set(code, r + 1);
        fileMachineCodes.add(code);
        const ownerEmail = get("ownerEmail").toLowerCase();
        if (ownerEmail && !userByEmail.has(ownerEmail)) { fail(`No user with email ${ownerEmail}. Create the artisan first (Team tab)`); continue; }
        const lat = numOrNull(get("lat"));
        const lng = numOrNull(get("lng"));
        if ((lat == null) !== (lng == null)) { fail("Give both lat and lng, or leave both empty"); continue; }
        const exists = machineByCode.has(code);
        const deptWillExist = deptByName.has(dept.toLowerCase());
        results.push({
          ...base, status: exists ? "UPDATE" : "CREATE",
          message: exists
            ? `Update ${code} · ${dept}${ownerEmail ? " · owner " + userByEmail.get(ownerEmail)!.name : ""}`
            : `New machine ${code} · ${dept}${deptWillExist ? "" : " (department will be created)"}${lat != null ? " · GPS set" : ""}`,
        });
        continue;
      }

      if (type === "COMPONENT") {
        if (!machineCode) { fail("COMPONENT row needs machineCode"); continue; }
        if (!name) { fail("COMPONENT row needs a name"); continue; }
        const known = machineByCode.has(machineCode) || fileMachineCodes.has(machineCode);
        if (!known) { fail(`Machine ${machineCode} not found. Add a MACHINE row for it above this one`); continue; }
        const partCode = get("partCode").toUpperCase();
        const willCreatePart = partCode !== "" && !partByCode.has(partCode);
        results.push({
          ...base, status: "CREATE",
          message: `${machineCode} · ${name}${partCode ? ` · part ${partCode}${willCreatePart ? " (will be created, stock 0)" : ""}` : ""}${get("category") ? ` · ${get("category")}` : ""}`,
        });
        continue;
      }

      fail(`type must be MACHINE or COMPONENT (got "${get("type") || "empty"}")`);
    }

    const valid = results.filter((x) => x.status !== "ERROR");
    if (!commit) {
      return NextResponse.json({ ok: true, commit: false, total: rows.length - 1, valid: valid.length, errors: errors.length, results });
    }

    // ---- Commit: machines first (so later COMPONENT rows find them), then components ----
    let createdMachines = 0, updatedMachines = 0, createdComponents = 0, createdParts = 0;
    for (const r of rows.slice(1)) {
      const cells = r;
      const get = (h: (typeof HEADERS)[number]) => (idx[h] >= 0 && idx[h] < cells.length ? cells[idx[h]].trim() : "");
      const type = get("type").toUpperCase();
      const name = get("name");
      const code = get("code").toUpperCase();
      const machineCode = get("machineCode").toUpperCase();
      if (type === "MACHINE" && code && name) {
        const dept = get("department");
        const deptRow = await db.department.upsert({
          where: { name: dept },
          update: {},
          create: { name: dept },
        });
        const ownerEmail = get("ownerEmail").toLowerCase();
        const ownerId = ownerEmail ? userByEmail.get(ownerEmail)?.id ?? null : null;
        const lat = numOrNull(get("lat"));
        const lng = numOrNull(get("lng"));
        const existing = await db.machine.findUnique({ where: { code } });
        const data = {
          name, departmentId: deptRow.id,
          location: get("location") || null,
          functionalLoc: get("functionalLoc") || null,
          equipmentNo: get("equipmentNo") || null,
          pmCycle: (get("pmCycle") || "WEEKLY").toUpperCase(),
          pmDay: Math.min(31, Math.max(1, Number(get("pmDay")) || 1)),
          ...(ownerId !== null ? { ownerId } : {}),
          ...(lat != null && lng != null ? { lat, lng } : {}),
        };
        if (existing) { await db.machine.update({ where: { id: existing.id }, data }); updatedMachines++; }
        else {
          await db.machine.create({ data: { code, ...data, checkinCode: tagCodeFor(code + Date.now()) } });
          createdMachines++;
          machineByCode.set(code, "new");
        }
      } else if (type === "COMPONENT" && machineCode && name) {
        let machineId = machineByCode.get(machineCode);
        if (!machineId || machineId === "new") {
          const m = await db.machine.findUnique({ where: { code: machineCode }, select: { id: true } });
          if (!m) continue;
          machineId = m.id;
          machineByCode.set(machineCode, m.id);
        }
        const partCode = get("partCode").toUpperCase();
        let partId: string | null = null;
        if (partCode) {
          const existingPart = partByCode.get(partCode);
          if (existingPart) partId = existingPart;
          else {
            const np = await db.part.create({ data: { code: partCode, name, stock: 0, reorderLevel: 1 } });
            partByCode.set(partCode, np.id);
            partId = np.id;
            createdParts++;
          }
        }
        await db.component.create({
          data: { machineId, name, partCode: partCode || null, category: get("category") || null, partId },
        });
        createdComponents++;
      }
    }

    return NextResponse.json({
      ok: true, commit: true,
      createdMachines, updatedMachines, createdComponents, createdParts,
      errors: errors.map((e) => `Row ${e.row}: ${e.message}`),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed." }, { status: 500 });
  }
}
