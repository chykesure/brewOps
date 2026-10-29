/**
 * BrewOps · Digital Work Order & PM System
 * Seed data modeled on the "Digital Work Order & PM System" pitch deck:
 * Mash Kettle Pump P-101, Lauter Rake Drive, Whirlpool, etc.
 */
import { PrismaClient } from "@prisma/client";
import { randomBytes, scryptSync } from "crypto";

const prisma = new PrismaClient();

function hashPin(pin: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(pin, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function at(dayOffset: number, hour: number, minute = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

async function main() {
  // Safety guard — never wipe a database that already holds accounts unless
  // the operator explicitly asked for it. Protects production data on the cloud DB.
  const force = process.argv.includes("--force");
  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !force) {
    console.log(`Seed cancelled — the database already holds ${existingUsers} user(s).`);
    console.log("To WIPE everything and reseed the demo data, run:  bun prisma/seed.ts --force");
    return;
  }
  console.log("Clearing existing data…");
  // Escalation rows reference machines / users through database-enforced
  // foreign keys on PostgreSQL — they must be cleared first.
  await prisma.escalation.deleteMany();
  await prisma.statusLog.deleteMany();
  await prisma.woStep.deleteMany();
  await prisma.workOrder.deleteMany();
  await prisma.pmOperation.deleteMany();
  await prisma.pmTemplate.deleteMany();
  await prisma.downtime.deleteMany();
  await prisma.component.deleteMany();
  await prisma.machine.deleteMany();
  await prisma.department.deleteMany();
  await prisma.part.deleteMany();
  await prisma.user.deleteMany();
  await prisma.seq.deleteMany();
  await prisma.securityEvent.deleteMany();
  await prisma.session.deleteMany();
  await prisma.device.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.branch.deleteMany();

  // ---------- Organisation identity & branches (multi-site scaffolding) ----------
  await prisma.settings.create({ data: { key: "orgName", value: "INTERNATIONAL BREWERIES PLC." } });
  await prisma.settings.create({ data: { key: "logoUrl", value: "" } });
  const branchIlesha = await prisma.branch.create({ data: { name: "Ilesha Brewery", location: "Ilesha, Osun State" } });

  // ---------- Users ----------
  // Initial work password equals the PIN — the Security module nudges a change
  // (pwdChangedAt stays null until the user sets their own strong password).
  const PIN = hashPin("1234");
  const engineer = await prisma.user.create({
    data: { name: "Engr. T. Adewale", email: "engineer@brewops.ng", pinHash: PIN, passwordHash: PIN, role: "ADMIN", trade: null, shift: "A", branchId: branchIlesha.id },
  });
  const yusuf = await prisma.user.create({
    data: { name: "A. Yusuf", email: "yusuf@brewops.ng", pinHash: PIN, passwordHash: PIN, role: "ARTISAN", trade: "MECHANICAL", shift: "A", branchId: branchIlesha.id },
  });
  const bello = await prisma.user.create({
    data: { name: "M. Bello", email: "bello@brewops.ng", pinHash: PIN, passwordHash: PIN, role: "ARTISAN", trade: "MECHANICAL", shift: "A", branchId: branchIlesha.id },
  });
  const okafor = await prisma.user.create({
    data: { name: "C. Okafor", email: "okafor@brewops.ng", pinHash: PIN, passwordHash: PIN, role: "ARTISAN", trade: "ELECTRICAL", shift: "B", branchId: branchIlesha.id },
  });
  const eze = await prisma.user.create({
    data: { name: "T. Eze", email: "eze@brewops.ng", pinHash: PIN, passwordHash: PIN, role: "ARTISAN", trade: "ELECTRICAL", shift: "B", branchId: branchIlesha.id },
  });

  // ---------- Parts ----------
  const mkPart = (code: string, name: string, stock: number, reorderLevel = 1) =>
    prisma.part.create({ data: { code, name, stock, reorderLevel } });
  const pSK12 = await mkPart("SK-12", "Mechanical Seal SK-12", 3);
  const pBRG2205 = await mkPart("BRG-2205", "Bearing Set BRG-2205", 0);
  const pORK8 = await mkPart("ORK-8", "O-Ring Kit 8in", 4, 2);
  const pSK9 = await mkPart("SK-9", "Mechanical Seal SK-9", 2);
  const pSK14 = await mkPart("SK-14", "Mechanical Seal SK-14", 1);
  const pSK5 = await mkPart("SK-5", "Seal Kit SK-5", 1);
  const pSK20 = await mkPart("SK-20", "Mechanical Seal SK-20", 1);
  const pAF401 = await mkPart("AF-401", "Air Filter Element AF-401", 2);
  const pPH302 = await mkPart("PH-302", "pH Probe PH-302", 1);
  const pBRG2208 = await mkPart("BRG-2208", "Bearing Set BRG-2208", 1);

  // ---------- Departments & Machines ----------
  const deptBrew = await prisma.department.create({ data: { name: "Brewhouse", branchId: branchIlesha.id } });
  const deptCellar = await prisma.department.create({ data: { name: "Cellars", branchId: branchIlesha.id } });
  const deptCIP = await prisma.department.create({ data: { name: "CIP Plant", branchId: branchIlesha.id } });
  const deptUtil = await prisma.department.create({ data: { name: "Utilities" } });

  type Comp = { name: string; partCode?: string; category?: string; partId?: string };
  type MachineDef = {
    code: string; name: string; dept: string; location: string;
    owner: string; pmCycle: string; pmDay: number; comps: Comp[];
  };

  const machines: MachineDef[] = [
    {
      code: "P-101", name: "Mash Kettle Pump", dept: "Brewhouse", location: "Brewhouse Hall A", owner: yusuf.id, pmCycle: "WEEKLY", pmDay: 1,
      comps: [
        { name: "Drive Motor", partCode: "MTR-15kW", category: "Rotating" },
        { name: "Mechanical Seal", partCode: "SK-12", category: "Seal", partId: pSK12.id },
        { name: "Bearing Set", partCode: "BRG-2205", category: "Bearing", partId: pBRG2205.id },
        { name: "O-Ring Kit 8in", partCode: "ORK-8", category: "Gasket", partId: pORK8.id },
        { name: "Discharge Pressure Transmitter", partCode: "PT-101", category: "Instrument" },
        { name: "Inlet Butterfly Valve", partCode: "BV-101", category: "Valve" },
        { name: "Vibration Sensor", partCode: "VS-101", category: "Instrument" },
      ],
    },
    {
      code: "LT-102", name: "Lauter Rake Drive", dept: "Brewhouse", location: "Brewhouse Hall A", owner: yusuf.id, pmCycle: "WEEKLY", pmDay: 1,
      comps: [
        { name: "Rake Drive Motor", partCode: "MTR-22kW", category: "Rotating" },
        { name: "Gearbox", partCode: "GB-220", category: "Rotating" },
        { name: "Rake Lift Actuator", partCode: "ACT-102", category: "Valve" },
        { name: "Plough Position Sensor", partCode: "SN-102", category: "Instrument" },
        { name: "CIP Spray Ball", partCode: "SPB-102", category: "Rotating" },
      ],
    },
    {
      code: "WP-103", name: "Whirlpool Pump", dept: "Brewhouse", location: "Brewhouse Hall B", owner: bello.id, pmCycle: "WEEKLY", pmDay: 2,
      comps: [
        { name: "Drive Motor", partCode: "MTR-11kW", category: "Rotating" },
        { name: "Mechanical Seal", partCode: "SK-9", category: "Seal", partId: pSK9.id },
        { name: "Suction Strainer", partCode: "STR-103", category: "Rotating" },
      ],
    },
    {
      code: "HK-104", name: "Hot Liquor Tank", dept: "Brewhouse", location: "Brewhouse Hall B", owner: okafor.id, pmCycle: "MONTHLY", pmDay: 1,
      comps: [
        { name: "Level Transmitter", partCode: "LT-104", category: "Instrument" },
        { name: "Temperature Probe", partCode: "TT-104", category: "Instrument" },
        { name: "Steam Control Valve", partCode: "SCV-104", category: "Valve" },
        { name: "Safety Relief Valve", partCode: "SRV-104H", category: "Valve" },
      ],
    },
    {
      code: "HX-105", name: "Heat Exchanger", dept: "Brewhouse", location: "Brewhouse Hall B", owner: okafor.id, pmCycle: "MONTHLY", pmDay: 1,
      comps: [
        { name: "Plate Pack", partCode: "PP-105", category: "Rotating" },
        { name: "Inlet Temp Sensor", partCode: "TT-105A", category: "Instrument" },
        { name: "Outlet Temp Sensor", partCode: "TT-105B", category: "Instrument" },
        { name: "Flow Switch", partCode: "FS-105", category: "Instrument" },
      ],
    },
    {
      code: "FT-201", name: "Fermenter F1 Agitator", dept: "Cellars", location: "Cellar 1", owner: eze.id, pmCycle: "WEEKLY", pmDay: 3,
      comps: [
        { name: "Agitator Motor", partCode: "MTR-7.5kW", category: "Rotating" },
        { name: "VFD Drive", partCode: "VFD-201", category: "Electrical" },
        { name: "Bearing Set", partCode: "BRG-2208", category: "Bearing", partId: pBRG2208.id },
        { name: "Temperature Probe", partCode: "TT-201", category: "Instrument" },
      ],
    },
    {
      code: "BRT-202", name: "Bright Beer Tank Valve Cluster", dept: "Cellars", location: "Cellar 2", owner: bello.id, pmCycle: "WEEKLY", pmDay: 4,
      comps: [
        { name: "Tank Outlet Valve", partCode: "BV-202A", category: "Valve" },
        { name: "CIP Return Valve", partCode: "BV-202B", category: "Valve" },
        { name: "Gas Relief Valve", partCode: "BV-202C", category: "Valve" },
        { name: "Sample Valve", partCode: "SV-202", category: "Valve" },
        { name: "Pressure Gauge", partCode: "PG-202", category: "Instrument" },
      ],
    },
    {
      code: "CT-203", name: "Glycol Chiller Pump", dept: "Cellars", location: "Cellar 2", owner: eze.id, pmCycle: "WEEKLY", pmDay: 5,
      comps: [
        { name: "Glycol Pump Motor", partCode: "MTR-5.5kW", category: "Rotating" },
        { name: "Seal Kit", partCode: "SK-5", category: "Seal", partId: pSK5.id },
        { name: "Solenoid Valve", partCode: "SV-203", category: "Valve" },
      ],
    },
    {
      code: "CIP-301", name: "CIP Supply Pump", dept: "CIP Plant", location: "CIP Skid", owner: okafor.id, pmCycle: "DAILY", pmDay: 1,
      comps: [
        { name: "Drive Motor", partCode: "MTR-18.5kW", category: "Rotating" },
        { name: "Mechanical Seal", partCode: "SK-14", category: "Seal", partId: pSK14.id },
        { name: "Conductivity Sensor", partCode: "CD-301", category: "Instrument" },
      ],
    },
    {
      code: "CIP-302", name: "Caustic Dosing Skid", dept: "CIP Plant", location: "CIP Skid", owner: bello.id, pmCycle: "WEEKLY", pmDay: 6,
      comps: [
        { name: "Dosing Pump", partCode: "DP-302", category: "Rotating" },
        { name: "Calibration Cylinder", partCode: "CAL-302", category: "Rotating" },
        { name: "pH Probe", partCode: "PH-302", category: "Instrument", partId: pPH302.id },
      ],
    },
    {
      code: "CMP-401", name: "Air Compressor", dept: "Utilities", location: "Compressor House", owner: eze.id, pmCycle: "MONTHLY", pmDay: 15,
      comps: [
        { name: "Compressor Motor", partCode: "MTR-45kW", category: "Rotating" },
        { name: "Oil Separator", partCode: "OS-401", category: "Rotating" },
        { name: "Air Filter Element", partCode: "AF-401", category: "Rotating", partId: pAF401.id },
        { name: "Pressure Switch", partCode: "PS-401", category: "Instrument" },
      ],
    },
    {
      code: "BLW-402", name: "Boiler Feed Pump", dept: "Utilities", location: "Boiler House", owner: okafor.id, pmCycle: "WEEKLY", pmDay: 1,
      comps: [
        { name: "Feed Pump Motor", partCode: "MTR-30kW", category: "Rotating" },
        { name: "Mechanical Seal", partCode: "SK-20", category: "Seal", partId: pSK20.id },
        { name: "Check Valve", partCode: "CV-402", category: "Valve" },
      ],
    },
  ];

  const deptMap: Record<string, string> = {
    Brewhouse: deptBrew.id, Cellars: deptCellar.id, "CIP Plant": deptCIP.id, Utilities: deptUtil.id,
  };

  const createdMachines: Record<string, { id: string; comps: Record<string, string> }> = {};
  const DEPT_PREFIX: Record<string, string> = { Brewhouse: "BR", Cellars: "CL", "CIP Plant": "CE", Utilities: "UT" };
  const nameInitials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase().slice(0, 3) || "GEN";
  let eqNo = 151;

  // Evidence chain: plant layout coords (International Breweries Ilesha area) + check-in tag codes
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const tagCodeFor = (seed: string) => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    h >>>= 0;
    let out = "";
    for (let i = 0; i < 6; i++) { out += CODE_ALPHABET[h % CODE_ALPHABET.length]; h = Math.floor(h / CODE_ALPHABET.length) + (h >>> 8) + 0x9e37; h >>>= 0; }
    return out;
  };
  const PLANT = { lat: 7.6167, lng: 4.7333 };
  const GEO: Record<string, [number, number]> = {
    "P-101": [-0.00012, 0.00008], "LT-102": [-0.00026, 0.00008], "WP-103": [-0.0004, 0.0001],
    "HK-104": [0.00005, 0.00022], "HX-105": [0.00018, 0.00024],
    "FT-201": [-0.0002, -0.0003], "BRT-202": [-0.00034, -0.00042], "CT-203": [-0.00008, -0.00048],
    "CIP-301": [0.00028, -0.00012], "CIP-302": [0.0004, -0.0002],
    "CMP-401": [0.00042, 0.00016], "BLW-402": [0.0003, 0.0003],
  };

  for (const m of machines) {
    const prefix = DEPT_PREFIX[m.dept] ?? m.dept.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
    const off = GEO[m.code] ?? [0.0001, 0.0001];
    const created = await prisma.machine.create({
      data: {
        code: m.code, name: m.name, departmentId: deptMap[m.dept], location: m.location,
        ownerId: m.owner, pmCycle: m.pmCycle, pmDay: m.pmDay,
        functionalLoc: `1Nl-B-${prefix}1-${m.code.replace(/-/g, "")}-${nameInitials(m.name)}`,
        equipmentNo: `10000${eqNo++}`,
        lat: PLANT.lat + off[0], lng: PLANT.lng + off[1], geoRadiusM: 150,
        checkinCode: null, // set after create (needs the id)
      },
    });
    await prisma.machine.update({ where: { id: created.id }, data: { checkinCode: tagCodeFor(created.id + m.code) } });
    const compIds: Record<string, string> = {};
    for (const c of m.comps) {
      const comp = await prisma.component.create({
        data: {
          machineId: created.id, name: c.name, partCode: c.partCode ?? null,
          category: c.category ?? null, partId: c.partId ?? null, currentStatus: "WORKING",
        },
      });
      compIds[c.name] = comp.id;
    }
    createdMachines[m.code] = { id: created.id, comps: compIds };
  }

  // ---------- Status history (last 3 days) ----------
  const log = (componentId: string, status: string, userId: string, when: Date, note?: string) =>
    prisma.statusLog.create({ data: { componentId, status, userId, createdAt: when, note: note ?? null } });

  // Day -2 & -1: everything working (sample)
  const p101 = createdMachines["P-101"].comps;
  const lt102 = createdMachines["LT-102"].comps;
  const wp103 = createdMachines["WP-103"].comps;
  const hx105 = createdMachines["HX-105"].comps;
  const cip301 = createdMachines["CIP-301"].comps;
  const cmp401 = createdMachines["CMP-401"].comps;
  const brt202 = createdMachines["BRT-202"].comps;

  await log(p101["Drive Motor"], "WORKING", yusuf.id, at(-2, 6, 5));
  await log(p101["Mechanical Seal"], "WORKING", yusuf.id, at(-2, 6, 6));
  await log(lt102["Rake Drive Motor"], "WORKING", yusuf.id, at(-2, 6, 10));
  await log(lt102["Plough Position Sensor"], "WORKING", yusuf.id, at(-2, 6, 12));
  await log(wp103["Mechanical Seal"], "WORKING", bello.id, at(-2, 6, 20));
  await log(cip301["Drive Motor"], "WORKING", okafor.id, at(-2, 7, 0));

  await log(p101["Drive Motor"], "WORKING", yusuf.id, at(-1, 6, 2));
  await log(p101["Mechanical Seal"], "WORKING", yusuf.id, at(-1, 6, 3));
  await log(lt102["Rake Drive Motor"], "WORKING", yusuf.id, at(-1, 6, 8));
  await log(lt102["Plough Position Sensor"], "FAULTY", yusuf.id, at(-1, 6, 9), "Intermittent signal · suspected loose connector, monitoring.");
  await log(hx105["Flow Switch"], "BYPASS", okafor.id, at(-1, 7, 30), "Bypassed during CIP validation · to review with Control Eng.");
  await log(wp103["Mechanical Seal"], "WORKING", bello.id, at(-1, 6, 25));

  // Today: the interesting ones
  await log(p101["Drive Motor"], "WORKING", yusuf.id, at(0, 6, 0), "Running normal, 1450 rpm.");
  await log(p101["Mechanical Seal"], "WORKING", yusuf.id, at(0, 6, 1), "No leaks. Flush line clear.");
  await log(p101["Discharge Pressure Transmitter"], "SIMULATION", yusuf.id, at(0, 6, 2), "DCS card in simulate mode during comms test · flagged to Control.");
  await log(lt102["Rake Drive Motor"], "WORKING", yusuf.id, at(0, 6, 10));
  await log(cip301["Mechanical Seal"], "BROKEN", okafor.id, at(0, 7, 12), "Heavy weeping from seal faces · pump isolated. Needs SK-14 from store.");
  await log(cip301["Drive Motor"], "WORKING", okafor.id, at(0, 7, 13));
  await log(cmp401["Air Filter Element"], "AWAITING_SPARES", eze.id, at(0, 6, 45), "Delta-p high. AF-401 shows 0 on shelf · reorder raised.");
  await log(brt202["Sample Valve"], "MAINTENANCE", bello.id, at(0, 7, 40), "Repacking valve stem, back in service by noon.");
  await log(hx105["Flow Switch"], "BYPASS", okafor.id, at(0, 7, 50), "Still bypassed · awaiting control review (day 2).");
  await log(wp103["Drive Motor"], "WORKING", bello.id, at(0, 6, 30));

  // Update component current statuses to match latest logs
  await prisma.component.update({ where: { id: lt102["Plough Position Sensor"] }, data: { currentStatus: "FAULTY" } });
  await prisma.component.update({ where: { id: hx105["Flow Switch"] }, data: { currentStatus: "BYPASS" } });
  await prisma.component.update({ where: { id: p101["Discharge Pressure Transmitter"] }, data: { currentStatus: "SIMULATION" } });
  await prisma.component.update({ where: { id: cip301["Mechanical Seal"] }, data: { currentStatus: "BROKEN" } });
  await prisma.component.update({ where: { id: cmp401["Air Filter Element"] }, data: { currentStatus: "AWAITING_SPARES" } });
  await prisma.component.update({ where: { id: brt202["Sample Valve"] }, data: { currentStatus: "MAINTENANCE" } });

  // ---------- Downtime (auto-created when BROKEN reported) ----------
  await prisma.downtime.create({
    data: {
      machineId: createdMachines["CIP-301"].id,
      reason: "CIP supply pump down · mechanical seal failure (SK-14).",
      startedAt: at(0, 7, 12),
      reportedById: okafor.id,
    },
  });

  // ---------- Work Orders ----------
  const seqStart = async (key: string, start: number) => prisma.seq.create({ data: { key, value: start } });
  await seqStart("WO", 1004);
  let woN = 1001;
  const mkWO = async (data: {
    title: string; machineCode: string; type: string; priority: string; assignedToId: string;
    status: string; due: Date; steps: string[]; doneCount?: number; startedAt?: Date; completedAt?: Date; description?: string;
  }) => {
    const code = `WO-${woN++}`;
    const wo = await prisma.workOrder.create({
      data: {
        code, title: data.title, description: data.description ?? null, type: data.type, priority: data.priority,
        machineId: createdMachines[data.machineCode].id, assignedToId: data.assignedToId, createdById: engineer.id,
        status: data.status, dueDate: data.due, startedAt: data.startedAt ?? null, completedAt: data.completedAt ?? null,
      },
    });
    let i = 1;
    for (const s of data.steps) {
      const done = i <= (data.doneCount ?? 0);
      await prisma.woStep.create({
        data: { workOrderId: wo.id, idx: i, text: s, doneAt: done ? new Date(data.due.getTime() - 3600_000 + i * 300_000) : null },
      });
      i++;
    }
    return wo;
  };

  const PM_STEPS = [
    "Visual inspection · leaks, unusual noise, vibration",
    "Check & record operating parameters",
    "Check lubrication level & condition",
    "Inspect seals, couplings & fasteners",
    "Verify guards & safety devices in place",
    "Test run & confirm normal operation",
  ];

  // The deck's example task: Lauter Rake Drive PM · due today, in progress, step 4 of 7
  await mkWO({
    title: "Lauter Rake Drive PM", machineCode: "LT-102", type: "PM", priority: "HIGH", assignedToId: yusuf.id,
    status: "IN_PROGRESS", due: at(0, 17, 0), startedAt: at(0, 8, 31), doneCount: 4,
    steps: [
      "Visual inspection of rake blades & drive coupling",
      "Check gearbox oil level & leaks",
      "Grease rake lift bearings",
      "Inspect plough sensor mounting & cable",
      "Verify lift actuator full stroke",
      "Test run at low speed · listen for noise",
      "Record final readings & confirm status",
    ],
  });
  // Mash Kettle Pump PM · completed today 08:42 (the deck's "DONE")
  await mkWO({
    title: "Mash Kettle Pump PM", machineCode: "P-101", type: "PM", priority: "NORMAL", assignedToId: yusuf.id,
    status: "COMPLETED", due: at(0, 12, 0), startedAt: at(0, 8, 5), completedAt: at(0, 8, 42), doneCount: PM_STEPS.length,
    steps: PM_STEPS,
  });
  // Whirlpool Seal Check · OVERDUE (the deck's "OVERDUE · admin alerted")
  await mkWO({
    title: "Whirlpool Seal Check", machineCode: "WP-103", type: "PM", priority: "NORMAL", assignedToId: bello.id,
    status: "PENDING", due: at(-1, 17, 0),
    steps: [
      "Inspect seal faces for wear & scoring",
      "Check flush line flow",
      "Look for weeping at gland",
      "Record seal condition in history",
    ],
  });
  // Corrective: CIP-301 seal replacement · URGENT today
  await mkWO({
    title: "Replace mechanical seal SK-14 (CIP Supply Pump)", machineCode: "CIP-301", type: "CORRECTIVE", priority: "URGENT",
    assignedToId: okafor.id, status: "PENDING", due: at(0, 14, 0),
    description: "Follow-up from status report: seal weeping heavily at 07:12. Pump isolated, LOTO applied to panel.",
    steps: [
      "Confirm LOTO on CIP-301 panel",
      "Drain & flush pump casing",
      "Remove old seal SK-14 & inspect shaft sleeve",
      "Fit new seal from store (1 in stock)",
      "Reassemble & restore power",
      "Test run 10 min · check for leaks",
    ],
  });
  // Monthly PM for HX-105 · due today, pending
  await mkWO({
    title: "Heat Exchanger Monthly PM", machineCode: "HX-105", type: "PM", priority: "NORMAL", assignedToId: okafor.id,
    status: "PENDING", due: at(0, 16, 0),
    steps: [
      "Inspect plate pack gaskets for fouling & scale",
      "Check inlet/outlet temp sensors against portable thermometer",
      "Inspect flow switch operation",
      "Record CIP delta readings",
    ],
  });

  // ---------- PM plan templates (digitised paper WO templates) ----------
  await prisma.pmTemplate.deleteMany();
  await prisma.pmOperation.deleteMany();
  const machineByCode = new Map((await prisma.machine.findMany()).map((m) => [m.code, m]));
  const T = (dayOffset: number, hour: number, minute = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const planDefs = [
    { code: "MP-881", title: "Daily CIP Supply Pump Seal & Param Check", frequency: "DAILY", priority: "HIGH", trade: "MECHANICAL", durationMin: 20, machine: "CIP-301", nextDueAt: T(0, 7), ops: [
      { subAssembly: "MECHANICAL SEAL", trade: "MECHANICAL", tasks: "Inspect The Mechanical Seal For Any Product Or Caustic Leakage\nCheck The Seal Flush Line Is Flowing And Lines Are Not Blocked\nWipe The Seal Area Dry And Mark Today's Inspection Date With Chalk" },
      { subAssembly: "DRIVE MOTOR", trade: "MECHANICAL", tasks: "Check Motor Running Current On The Panel And Compare With Nameplate FLA\nCheck For Abnormal Noise, Heat Or Vibration On The Pump Set\nRecord Discharge Pressure And Tank Conductivity In The Daily Log" },
    ] },
    { code: "MP-882", title: "Mthly Mash Pump P-101 Mech Inspect", frequency: "MONTHLY", priority: "NORMAL", trade: "MECHANICAL", durationMin: 60, machine: "P-101", nextDueAt: T(5, 9), ops: [
      { subAssembly: "PUMP CASING", trade: "MECHANICAL", tasks: "Check The Pump Body For Accumulation Of Solids\nClean The Sump And Strainer Housing, Report Any Abnormal Debris" },
      { subAssembly: "PROXIMITY SENSOR", trade: "ELECTRICAL", tasks: "Check The Condition Of The Proximity Sensor And Clean Accumulated Dust On The Sensor\nCheck The Condition Of Metallic Plate Infront Of The Sensor" },
      { subAssembly: "GEAR BOX", trade: "MECHANICAL", tasks: "Clean Body Of The Main Drives & Machine Area\nColour Indicates Residue And Severe Thermal Decomposition Replace Oil If Any Of These Were Observed\nCheck The Gear Box Oil Levels And The Quality Of The Oil, Cloudy And Floucculent Appearance Indicates Water Contamination\nCheck Main Drive Foundation Bolts For Tightness\nCheck Motor Cable Gland To Terminal Box\nInspect Cable Terminals For Burns\nDocument All Findings & Report Asap Any Abnormality" },
    ] },
    { code: "MP-878", title: "3-Weekly Inspection CIP Tank Elements", frequency: "THREE_WEEKLY", priority: "HIGH", trade: "MECHANICAL", durationMin: 45, machine: "CIP-302", nextDueAt: T(3, 8), ops: [
      { subAssembly: "CAUSTIC SODA TANK", trade: "MECHANICAL", tasks: "Check The Functionality Of Level Transmitter On The HMI And The Level Switch\nCheck For Any Caustic Leakage On The Transmitters, If Any Call For Repair" },
      { subAssembly: "MANUAL DISCHARGE VALVE", trade: "MECHANICAL", tasks: "Inspect The Valve For Any Caustic Leakages, If Any Call For Repair" },
      { subAssembly: "TRANSFER PUMP", trade: "MECHANICAL", tasks: "Inspect The Pump For Any Caustic Leakages And Abnormal Noise, If Any Call For Repair" },
    ] },
    { code: "MP-889", title: "3Wkly Inspectn Conc Caustic Tank Element", frequency: "THREE_WEEKLY", priority: "NORMAL", trade: "MECHANICAL", durationMin: 30, machine: "CIP-302", nextDueAt: T(6, 8), ops: [
      { subAssembly: "LEVEL TRANSMITTER", trade: "ELECTRICAL", tasks: "Check The Functionality Of Level Transmitter On The SCADA" },
      { subAssembly: "DRAINAGE PNEUMATIC VALVE", trade: "MECHANICAL", tasks: "Check This Pilot Air Hose Supply To The Valves, If Properly Connected\nCheck For Air Leakages And Rectify\nInspect The Valve For Any Caustic Leakages, If Any Call For Repair" },
    ] },
    { code: "MP-233", title: "Wkly Brewhouse Panel & Sensor Electrical Inspect", frequency: "WEEKLY", priority: "NORMAL", trade: "ELECTRICAL", durationMin: 40, machine: "HX-105", nextDueAt: T(4, 10), ops: [
      { subAssembly: "TEMP SENSOR PANEL", trade: "ELECTRICAL", tasks: "Check Terminal Tightness On The Temperature Transmitter Panel\nLook For Discoloration Or Burns On Cable Terminals\nConfirm Cable Glands Are Sealed Against Steam Ingress" },
      { subAssembly: "CONTROL PANEL", trade: "ELECTRICAL", tasks: "Test Panel Indicator Lamps And HMI Alarms\nMeasure And Record Panel Supply Voltage\nVerify Earth Bonding Is Intact" },
    ] },
    { code: "MP-510", title: "Biweekly Glycol Chiller Pump Checks", frequency: "BIWEEKLY", priority: "NORMAL", trade: "MECHANICAL", durationMin: 30, machine: "CT-203", nextDueAt: T(7, 9), ops: [
      { subAssembly: "GLYCOL PUMP", trade: "MECHANICAL", tasks: "Inspect Pump Seal For Glycol Weeping, If Any Call For Repair\nCheck Suction And Discharge Pressures And Record Values" },
      { subAssembly: "SOLENOID VALVE", trade: "ELECTRICAL", tasks: "Confirm The Valve Cycles Correctly On The HMI Signal Test\nInspect Coil Housing For Moisture Ingress" },
    ] },
    { code: "MP-470", title: "Annual Air Compressor Major Service", frequency: "YEARLY", priority: "HIGH", trade: "MECHANICAL", durationMin: 240, machine: "CMP-401", nextDueAt: T(23, 7), ops: [
      { subAssembly: "COMPRESSOR UNIT", trade: "MECHANICAL", tasks: "Change Air Filter Element And Oil Separator\nSample And Replace Compressor Oil, Check For Thermal Decomposition\nCheck Belt Tension And Coupling Alignment" },
      { subAssembly: "MOTOR ELECTRICAL", trade: "ELECTRICAL", tasks: "Megger Test Motor Windings And Record Values\nInspect Cable Terminals For Burns\nVerify Overload Relay Settings Against Nameplate FLA" },
      { subAssembly: "SAFETY DEVICES", trade: "MECHANICAL", tasks: "Calibrate Pressure Switch And Record Set Points\nTest Safety Relief Valve, If Faulty Replace Immediately" },
    ] },
  ];
  for (const p of planDefs) {
    const machine = machineByCode.get(p.machine);
    if (!machine) continue;
    await prisma.pmTemplate.create({
      data: {
        code: p.code, title: p.title, frequency: p.frequency, priority: p.priority,
        trade: p.trade, durationMin: p.durationMin, machineId: machine.id, nextDueAt: p.nextDueAt,
        operations: { create: p.ops.map((op, i) => ({ idx: (i + 1) * 10, subAssembly: op.subAssembly, trade: op.trade, tasks: op.tasks })) },
      },
    });
  }
  console.log(`Seeded ${planDefs.length} PM plan templates (Daily → Yearly)`);
  // Completed yesterday: FT-201 weekly PM
  await mkWO({
    title: "Fermenter F1 Agitator PM", machineCode: "FT-201", type: "PM", priority: "NORMAL", assignedToId: eze.id,
    status: "COMPLETED", due: at(-1, 15, 0), startedAt: at(-1, 10, 0), completedAt: at(-1, 11, 5), doneCount: PM_STEPS.length,
    steps: PM_STEPS,
  });

  // ---------- Artisan home departments ----------
  // A craftsman's round covers his whole department, not only machines assigned to him
  await prisma.user.update({ where: { id: yusuf.id }, data: { departmentId: deptBrew.id } });
  await prisma.user.update({ where: { id: bello.id }, data: { departmentId: deptBrew.id } });
  await prisma.user.update({ where: { id: okafor.id }, data: { departmentId: deptCIP.id } });
  await prisma.user.update({ where: { id: eze.id }, data: { departmentId: deptCellar.id } });

  console.log("Seed complete ✔");
  console.log("Login → engineer@brewops.ng / 1234  (Brewing Engineer, admin)");
  console.log("Login → yusuf@brewops.ng / 1234     (A. Yusuf, artisan)");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
