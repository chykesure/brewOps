// Machine & component code auto-generation — shared by the Engineer Registry and
// the artisan shop-floor registration form.
//
// Format: PREFIX-XXXX   (e.g. BRE-7K3M, CIP-Q4XN, M-A9PL)
//   PREFIX — first 3 letters of the department name, so codes stay meaningful
//            ("Brewhouse" → BRE-…, "CIP Plant" → CIP-…). Falls back to "M".
//   XXXX   — 4 random characters mixing LETTERS and NUMBERS, drawn from an
//            unambiguous alphabet (no O/0, no I/1) so codes stay readable when
//            read aloud on the floor or typed from a nameplate.
//
// Component part codes follow the same letters+numbers style: CP-7K3M, CP-Q4XN…

export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function deptPrefixFromName(name: string): string {
  const letters = String(name ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (letters.length < 2) return "M";
  return letters.slice(0, 3);
}

function randomTail(len = 4): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export function nextMachineCode(prefix: string, existingCodes: string[]): string {
  const p = (prefix || "M").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "M";
  const taken = new Set(existingCodes.map((c) => String(c).trim().toUpperCase()));
  // Random letters+numbers tail, collision-checked against every code in the plant
  for (let guard = 0; guard < 500; guard++) {
    const candidate = `${p}-${randomTail(4)}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Astronomically unlikely; deterministic fallback keeps registration unblocked
  return `${p}-${Date.now().toString(36).slice(-4).toUpperCase().replace(/[O0]/g, "X")}`;
}

// Auto part code for a sub-component — letters + numbers, unique against the
// part codes already on the plant floor.
export function suggestPartCode(existingPartCodes: string[]): string {
  const taken = new Set(existingPartCodes.map((c) => String(c).trim().toUpperCase()));
  for (let guard = 0; guard < 500; guard++) {
    const candidate = `CP-${randomTail(4)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `CP-${Date.now().toString(36).slice(-4).toUpperCase().replace(/[O0]/g, "X")}`;
}

// Convenience: suggest a machine code for a department against the machines already
// loaded in the client (bootstrap data).
export function suggestMachineCode(
  departmentName: string | null | undefined,
  machines: { code: string }[],
): string {
  const prefix = departmentName ? deptPrefixFromName(departmentName) : "M";
  return nextMachineCode(prefix, machines.map((m) => m.code));
}

// Convenience: suggest a component part code against every part code already
// loaded in the client (bootstrap data).
export function suggestComponentPartCode(machines: { components: { partCode: string | null }[] }[]): string {
  const codes = machines.flatMap((m) => m.components.map((c) => c.partCode ?? "")).filter(Boolean);
  return suggestPartCode(codes);
}