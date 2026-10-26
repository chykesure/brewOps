// Access-license keys — every artisan account registered through the app is
// issued one unique key. The key does not block sign-in; it identifies the
// account, and the owner activates (or revokes) the access from the dev console.
import { randomInt } from "crypto";

// Unambiguous alphabet: no I/L/O/0/1 — keys are read aloud over the phone
// and typed from paper, so lookalike characters are deliberately excluded.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function group(): string {
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export function newLicenseKey(): string {
  return `BOPS-${group()}-${group()}-${group()}`;
}

export function isLicenseKeyFormat(v: string): boolean {
  return /^BOPS-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(v);
}
