import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { csvEscape } from "@/lib/csv";

// GET /api/assets/export — full asset register as CSV (backup + re-import round-trip).
// Same column layout as the import template: MACHINE rows first, then their COMPONENTs.
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Admin access required." }, { status: 403 });

  const [machines, users] = await Promise.all([
    db.machine.findMany({
      include: { department: true, owner: true, components: { orderBy: { name: "asc" } } },
      orderBy: { code: "asc" },
    }),
    db.user.findMany({ select: { id: true, email: true } }),
  ]);
  const emailById = new Map(users.map((u) => [u.id, u.email]));

  const lines = [
    "type,code,name,department,location,functionalLoc,equipmentNo,pmCycle,pmDay,ownerEmail,lat,lng,machineCode,partCode,category",
  ];
  for (const m of machines) {
    lines.push([
      "MACHINE", m.code, m.name, m.department.name, m.location ?? "", m.functionalLoc ?? "",
      m.equipmentNo ?? "", m.pmCycle, String(m.pmDay), m.ownerId ? emailById.get(m.ownerId) ?? "" : "",
      m.lat != null ? String(m.lat) : "", m.lng != null ? String(m.lng) : "",
      "", "", "",
    ].map(csvEscape).join(","));
    for (const c of m.components) {
      lines.push([
        "COMPONENT", "", c.name, "", "", "", "", "", "", "",
        "", "", m.code, c.partCode ?? "", c.category ?? "",
      ].map(csvEscape).join(","));
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="brewops-assets-${date}.csv"`,
    },
  });
}
