// Server-only — idempotent seeding of the two weekly maintenance checklist
// templates, digitised 1:1 from the scanned paper sheets (Nov 2026).
// Runs at most once per server process; creates rows ONLY when the checklist
// table is still empty, so the Engineer's later edits are never overwritten.
import "server-only";
import { db } from "@/lib/db";

type SeedRow = [machine: string, task: string, mins: number];

// ---- Sheet 1: Weekly Maintenance Electrical Inspection Checklist (260 mins) ----
const ELECTRICAL_ROWS: SeedRow[] = [
  ["Buck Malt", "Weekly Electrical Inspection Of The Buck Malt", 10],
  ["Destoner", "Check That Terminal Covers Are Well Tightened", 10],
  ["Destoner", "Ensure That Foundation/Assembly Bolts Are Well Tightened", 10],
  ["Drum Sieve", "Check Condition Of The Purging System And The Motor Cable Gland, Should Be Firm", 5],
  ["ELO3", "Check The Status Of The Belt Deviation Sensors And Retighten If Found Loose", 10],
  ["ELO4", "Check The Status Of The Belt Deviation Sensors And Retighten If Found Loose", 10],
  ["ELO6", "Check The Status Of The Belt Deviation Sensors And Retighten If Found Loose", 10],
  ["Dust Cyclone", "Weekly Cleaning Schedule For The Dust Cyclone", 15],
  ["Grain Transport Blower 1", "Weekly Electrical Inspection Of Blower And Retighten Electrical Terminals Once Loose", 15],
  ["Grain Transport Blower 2", "Weekly Electrical Inspection Of Blower And Retighten Electrical Terminals Once Loose", 15],
  ["Extraction Scale", "Weekly Cleaning Weighing Scale Interior", 15],
  ["Reception Scale", "Weekly Cleaning Weighing Scale Interior", 15],
  ["Malt Hammer Mill", "Ensure That Foundation/Assembly Bolts Are Well Tightened", 15],
  ["Malt Hammer Mill", "Check That Terminal Covers Are Well Tightened", 10],
  ["Malt Hammer Mill", "Check Condition Of Cable Gland, Should Be Firm", 10],
  ["Malt Grist Bin", "Check The Functionality Of The Purging System", 10],
  ["Adjunct Hammer Mill", "Ensure That Foundation/Assembly Bolts Are Well Tightened", 15],
  ["Adjunct Hammer Mill", "Check That Terminal Covers Are Well Tightened", 10],
  ["Adjunct Hammer Mill", "Check Condition Of Cable Gland, Should Be Firm", 10],
  ["Mechamasher", "Open The Inlet Channels Both Malt & Maize And Clean", 10],
  ["Mechamasher", "Check Condition Of Jamming Switches On Both Maize And Malt Infeed Conveyor", 15],
  ["Mechamasher", "Check Proximity Sensors", 15],
];

// ---- Sheet 2: Weekly Maintenance Mechanical Inspection Checklist (345 mins) ----
// (The paper's hand-written total said 335 — the app auto-totals the rows.)
const MECHANICAL_ROWS: SeedRow[] = [
  ["Buck Malt", "Cleaning Of The Spiral Base Sprocket", 10],
  ["Destoner", "Cleaning Of Destoner Mechanism, Inspect & Cleaning", 15],
  ["Destoner", "Cleaning Of Inlet Destoner Magnet", 10],
  ["ELO3", "Weekly Cleaning Magnet - Elevator 03", 10],
  ["ELO3", "Inspect The Belt For Deviation Or Wear", 10],
  ["ELO4", "Weekly Cleaning Magnet - Elevator 04", 10],
  ["ELO4", "Inspect The Belt And Cup For Deviation Or Wear", 20],
  ["ELO6", "Weekly Cleaning Magnet - Elevator 06", 10],
  ["ELO6", "Inspect The Belt And Cup For Deviation Or Wear", 20],
  ["Dust Cyclone", "Weekly Cleaning Schedule For The Dust Cyclone", 15],
  ["Grain Transport Blower 1", "Inspection For Any Defect & Clean The Accumulated Dust Filter Using Compressed Air", 15],
  ["Grain Transport Blower 1", "Check Filter For Contamination, Replace If Necessary, Max. -45 Bar", 10],
  ["Grain Transport Blower 2", "Inspection For Any Defect & Clean The Accumulated Dust Filter Using Compressed Air", 15],
  ["Grain Transport Blower 2", "Check Filter For Contamination, Replace If Necessary, Max. -45 Bar", 10],
  ["Extraction Scale", "Weekly Cleaning Weighing Scale Interior", 15],
  ["Reception Scale", "Weekly Cleaning Weighing Scale Interior", 15],
  ["Malt Hammer Mill", "Open The Flexible Feeding Unit To The Hammer Mill And Clean All Channels", 15],
  ["Malt Hammer Mill", "Clean Airlock Motor", 10],
  ["Malt Hammer Mill", "Clean Rotor Motor", 10],
  ["Malt Hammer Mill", "Clean The Magnet", 10],
  ["Drum Sieve", "Clean The Sorghum Drum Sieve", 10],
  ["Malt Grist Bin", "Check The Explosion Vent On The Malt Grist Bin, There Must Not Be Leakage", 10],
  ["Adjunct Hammer Mill", "Open The Magnet Access Hatch, Loosen The Magnet Fixation Screws, Rotate The Magnet Downwards", 15],
  ["Adjunct Hammer Mill", "Clean The Magnet Weight", 10],
  ["Adjunct Hammer Mill", "Check The Infeed Line To The Milling Chamber", 10],
  ["Adjunct Hammer Mill", "Remove Any Metal Debris On Magnet And Close The Hatch", 10],
  ["Mechamasher", "Open The Inlet Channels Both Malt & Maize And Clear", 10],
  ["Mechamasher", "Remove All Cakes Within", 15],
];

let seeding: Promise<void> | null = null;

async function seedOnce(): Promise<void> {
  const existing = await db.checklistTemplate.count();
  if (existing > 0) return; // already seeded (or the Engineer built their own) — never touch
  await db.checklistTemplate.create({
    data: {
      title: "Weekly Maintenance Electrical Inspection Checklist",
      trade: "ELECTRICAL",
      rows: {
        create: ELECTRICAL_ROWS.map(([machineName, task, plannedMin], i) => ({
          idx: (i + 1) * 10,
          machineName,
          task,
          plannedMin,
        })),
      },
    },
  });
  await db.checklistTemplate.create({
    data: {
      title: "Weekly Maintenance Mechanical Inspection Checklist",
      trade: "MECHANICAL",
      rows: {
        create: MECHANICAL_ROWS.map(([machineName, task, plannedMin], i) => ({
          idx: (i + 1) * 10,
          machineName,
          task,
          plannedMin,
        })),
      },
    },
  });
}

/**
 * Ensures the two scanned paper templates exist. Safe to call on every
 * request: the actual work happens once per process and only when the table
 * is empty (so factory resets re-seed, but live edits are never clobbered).
 */
export function ensureChecklistSeed(): Promise<void> {
  if (!seeding) {
    seeding = seedOnce().catch((err) => {
      seeding = null; // allow a retry on the next request
      throw err;
    });
  }
  return seeding;
}