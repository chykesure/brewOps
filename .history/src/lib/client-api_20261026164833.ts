"use client";

import type { BootstrapData, DayReport, MachinePmHistory, SecurityOverview, StatusReportData, TrendsData } from "@/lib/types";

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body ?? {};
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 401) throw new ApiError("Not authenticated", 401);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error || "Request failed", res.status, json);
  return json as T;
}

// ---- Device fingerprint (device-synchronization model) ----
// A stable UUID kept in localStorage identifies this browser/device. The server
// keeps a trusted-device registry keyed by it: a synchronized device signs in
// with the PIN; a new one must prove ownership with the work password.
const DEVICE_KEY = "brewops_device_id";

export interface DeviceInfo {
  id: string;
  name: string;
  platform: string;
  mobile: boolean;
}

function devicePlatform(ua: string): string {
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macOS";
  if (/Linux/i.test(ua)) return "Linux";
  return "Unknown";
}

export function getDeviceInfo(): DeviceInfo {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  let id = "";
  try {
    id = localStorage.getItem(DEVICE_KEY) ?? "";
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
      localStorage.setItem(DEVICE_KEY, id);
    }
  } catch {
    id = `anon-${Date.now().toString(36)}`;
  }
  const platform = devicePlatform(ua);
  const mobile = /Mobi|Android|iPhone|iPad/i.test(ua);
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return { id, name: `${platform} · ${browser}${mobile ? " (mobile)" : ""}`, platform, mobile };
}

// The device's IANA timezone — sent with every dated request so the server draws
// day boundaries on the wall clock the reporting user actually sees.
export const CLIENT_TZ = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;

export async function fetchBootstrap(date?: string, tz?: string | null): Promise<BootstrapData> {
  const q = new URLSearchParams();
  if (date) q.set("date", date);
  if (tz) q.set("tz", tz);
  const res = await fetch(`/api/bootstrap${q.toString() ? `?${q.toString()}` : ""}`, { cache: "no-store" });
  return handle<BootstrapData>(res);
}

export interface Pulse {
  rev: string;
  at: string;
}

// Revision fingerprint of the plant's data — the live-feed heartbeat.
export async function fetchPulse(): Promise<Pulse> {
  const res = await fetch("/api/pulse", { cache: "no-store" });
  return handle<Pulse>(res);
}

export async function login(email: string, pin: string, password?: string): Promise<void> {
  const device = getDeviceInfo();
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, pin, ...(password ? { password } : {}), device }),
  });
  await handle<{ user: unknown }>(res);
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}

// ---- Security module ----

export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean; othersSignedOut: number }> {
  const res = await fetch("/api/auth/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return handle(res);
}

export async function fetchSecurity(): Promise<SecurityOverview> {
  const res = await fetch("/api/devices", { cache: "no-store" });
  return handle<SecurityOverview>(res);
}

export async function deviceAction(payload: { action: string; deviceId?: string }): Promise<{ ok: boolean; signedOut?: number; signedOutSessions?: number }> {
  const res = await fetch("/api/devices", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function patchProfile(payload: { name?: string; avatarUrl?: string | null }): Promise<void> {
  const res = await fetch("/api/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

// ---- Organisation identity (logo on reports) & branches ----

export async function patchOrg(payload: { orgName?: string; logoUrl?: string | null }): Promise<void> {
  const res = await fetch("/api/org", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function createBranch(name: string, location?: string): Promise<void> {
  const res = await fetch("/api/org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, location }),
  });
  await handle(res);
}

export async function patchBranch(payload: { id: string; name?: string; location?: string | null; active?: boolean }): Promise<void> {
  const res = await fetch("/api/org", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ branch: payload }),
  });
  await handle(res);
}

// ---- Machine status log report (printable) ----

export async function fetchStatusReport(machineId: string, from: string, to: string, tz?: string | null): Promise<StatusReportData> {
  const q = new URLSearchParams({ machineId, from, to });
  if (tz) q.set("tz", tz);
  const res = await fetch(`/api/statuslog-report?${q.toString()}`, { cache: "no-store" });
  return handle<StatusReportData>(res);
}

export async function logStatus(payload: { componentId: string; status: string; note?: string; photo?: string; lat?: number; lng?: number }): Promise<void> {
  const res = await fetch("/api/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function woCheckIn(id: string, payload: { method: string; code?: string; lat?: number; lng?: number; acc?: number | null; photo?: string | null }): Promise<{ result: string; distanceM?: number | null; reasons?: string[] }> {
  const res = await fetch(`/api/workorders/${id}/checkin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function woAction<T = { ok: boolean; flags?: string[] }>(id: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(`/api/workorders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<T>(res);
}

export async function createWorkOrder(payload: Record<string, unknown>): Promise<{ code: string }> {
  const res = await fetch("/api/workorders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ code: string }>(res);
}

export async function patchMachine(id: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/machines/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function createMachine(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/machines", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function createComponent(payload: Record<string, unknown>): Promise<{ partCode: string | null }> {
  const res = await fetch("/api/components", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ ok: boolean; id: string; partCode: string | null }>(res);
}

export async function patchPart(id: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/parts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function downtimeAction(payload: Record<string, unknown>, close = false): Promise<void> {
  const res = await fetch("/api/downtime", {
    method: close ? "PATCH" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function runSchedulerNow(): Promise<{ created: { code: string; machine: string; cycle: string }[]; skipped: number }> {
  const res = await fetch("/api/scheduler", { method: "POST" });
  return handle(res);
}

export async function createTemplate(payload: Record<string, unknown>): Promise<{ code: string }> {
  const res = await fetch("/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ code: string }>(res);
}

export async function patchTemplate(id: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/templates/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function deleteTemplate(id: string): Promise<void> {
  const res = await fetch(`/api/templates/${id}`, { method: "DELETE" });
  await handle(res);
}

export async function createArtisan(payload: Record<string, unknown>): Promise<{ name: string; licenseKey?: string }> {
  const res = await fetch("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle<{ name: string; licenseKey?: string }>(res);
}

export async function patchUser(id: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await handle(res);
}

export async function uploadPhoto(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: form });
  const json = await handle<{ url: string }>(res);
  return json.url;
}

export async function fetchDayReport(date: string, tz?: string | null): Promise<DayReport> {
  const q = new URLSearchParams({ date });
  if (tz) q.set("tz", tz);
  const res = await fetch(`/api/report?${q.toString()}`, { cache: "no-store" });
  return handle<DayReport>(res);
}

export async function fetchTrends(days: number, machineId?: string | null): Promise<TrendsData> {
  const q = new URLSearchParams({ days: String(days) });
  if (machineId) q.set("machineId", machineId);
  const res = await fetch(`/api/trends?${q.toString()}`, { cache: "no-store" });
  return handle<TrendsData>(res);
}

export async function fetchMachineHistory(machineId: string): Promise<MachinePmHistory> {
  const res = await fetch(`/api/machines/${machineId}/history`, { cache: "no-store" });
  return handle<MachinePmHistory>(res);
}

export async function createEscalation(payload: Record<string, unknown>): Promise<{ id: string; severity: string }> {
  const res = await fetch("/api/escalations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export async function escalationAction(id: string, payload: Record<string, unknown>): Promise<{ ok: boolean; woCode?: string; reroutedTo?: string }> {
  const res = await fetch(`/api/escalations/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return handle(res);
}

export interface ImportRow {
  row: number; type: string; code: string; name: string;
  status: "CREATE" | "UPDATE" | "ERROR"; message: string;
}
export interface ImportPreview {
  commit: false; total: number; valid: number; errors: number; results: ImportRow[];
}
export interface ImportCommitResult {
  commit: true;
  createdMachines: number; updatedMachines: number; createdComponents: number; createdParts: number;
  errors: string[];
}

export async function importAssets(csv: string, commit: boolean): Promise<ImportPreview | ImportCommitResult> {
  const res = await fetch("/api/assets/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ csv, commit }),
  });
  return handle(res);
}

// ---- Developer console (the owner's private back door) ----

export interface DevStats {
  users: number; artisans: number; admins: number; machines: number; components: number;
  statusLogs: number; workOrders: number; openWorkOrders: number; downtimes: number;
  parts: number; escalations: number; devices: number; unlicensed: number; inactiveLicenses: number;
  dbSize: number;
  activeSessions: number;
  maintenance: boolean;
  quickSignIn: boolean;
}

export interface DevLicenseUser {
  id: string; name: string; email: string; role: string; trade: string | null; shift: string | null;
  active: boolean; licenseKey: string | null; licenseActive: boolean; createdAt: string;
}

// ---- Dev console Pro: trends, sessions, restore points, audit trail ----

export interface DevTrendPoint {
  date: string; logs: number; wosCreated: number; wosCompleted: number; downtimes: number;
}

export interface DevTrends {
  days: number;
  series: DevTrendPoint[];
  totals: { logs: number; wosCreated: number; wosCompleted: number; downtimes: number; checkIns: number; escalations: number };
}

export interface DevSessionRow {
  id: string; userName: string; userEmail: string; role: string;
  deviceName: string | null; platform: string | null; ip: string | null;
  createdAt: string; lastSeenAt: string; expiresAt: string;
}

export interface DevDeviceRow {
  id: string; userName: string; userEmail: string; name: string;
  platform: string | null; mobile: boolean; approved: boolean;
  lastSeenAt: string; createdAt: string;
}

export interface DevSessionsData {
  sessions: DevSessionRow[];
  devices: DevDeviceRow[];
}

export interface DevBackupMeta {
  file: string; size: number; createdAt: string; rows: number;
  counts: Record<string, number>;
}

export interface DevAuditEvent {
  id: string; action: string; detail: string | null; createdAt: string;
}

export interface DevAuditData {
  events: DevAuditEvent[];
  total: number;
  shown: number;
  counts: Record<string, number>;
}

export async function devStatus(): Promise<{ unlocked: boolean }> {
  return handle(await fetch("/api/dev/session", { cache: "no-store" }));
}

export async function devUnlock(pin: string): Promise<void> {
  // Deliberately NOT routed through handle(): a wrong PIN is a normal 401 with
  // a friendly body ("Incorrect PIN." / lockout notice), not an auth failure.
  const res = await fetch("/api/dev/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || "Incorrect PIN.");
}

export async function devLock(): Promise<void> {
  await handle(await fetch("/api/dev/session", { method: "DELETE" }));
}

export async function devStats(): Promise<DevStats> {
  return handle(await fetch("/api/dev/stats", { cache: "no-store" }));
}

export async function devLicenses(): Promise<{ users: DevLicenseUser[] }> {
  return handle(await fetch("/api/dev/licenses", { cache: "no-store" }));
}

export async function devLicensePatch(payload: { userId?: string; licenseActive?: boolean; regenerate?: boolean; fillMissing?: boolean }): Promise<{ ok: boolean; filled?: number; licenseKey?: string }> {
  return handle(await fetch("/api/dev/licenses", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function devReset(mode: "activity" | "factory", confirm: string): Promise<{ ok: boolean; deleted: Record<string, number> }> {
  return handle(await fetch("/api/dev/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, confirm }),
  }));
}

export async function devRestore(backup: unknown, confirm: string): Promise<{ ok: boolean; restored: Record<string, number> }> {
  return handle(await fetch("/api/dev/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ backup, confirm }),
  }));
}

// ---- Dev console Pro fetchers ----

export async function devTrends(days: number): Promise<DevTrends> {
  return handle(await fetch(`/api/dev/trends?days=${days}`, { cache: "no-store" }));
}

export async function devSessions(): Promise<DevSessionsData> {
  return handle(await fetch("/api/dev/sessions", { cache: "no-store" }));
}

export async function devSessionPatch(payload: { sessionId?: string; userId?: string; deviceId?: string; all?: boolean }): Promise<{ ok: boolean; revoked?: number }> {
  return handle(await fetch("/api/dev/sessions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

export async function devBackups(): Promise<{ backups: DevBackupMeta[] }> {
  return handle(await fetch("/api/dev/backups", { cache: "no-store" }));
}

export async function devBackupCreate(): Promise<{ ok: boolean; file: string; rows: number }> {
  return handle(await fetch("/api/dev/backups", { method: "POST" }));
}

export async function devBackupDelete(file: string): Promise<{ ok: boolean }> {
  return handle(await fetch(`/api/dev/backups?file=${encodeURIComponent(file)}`, { method: "DELETE" }));
}

export async function devBackupRestorePoint(file: string, confirm: string): Promise<{ ok: boolean; restored: Record<string, number> }> {
  return handle(await fetch("/api/dev/backups/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file, confirm }),
  }));
}

export async function devAudit(): Promise<DevAuditData> {
  return handle(await fetch("/api/dev/audit", { cache: "no-store" }));
}

export async function devAuditClear(confirm: string): Promise<{ ok: boolean; deleted: number }> {
  return handle(await fetch("/api/dev/audit", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm }),
  }));
}

export async function devMaintenance(): Promise<{ on: boolean }> {
  return handle(await fetch("/api/dev/maintenance", { cache: "no-store" }));
}

export async function devMaintenanceSet(on: boolean): Promise<{ ok: boolean; on: boolean }> {
  return handle(await fetch("/api/dev/maintenance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ on }),
  }));
}

export async function devQuickSignIn(): Promise<{ on: boolean }> {
  return handle(await fetch("/api/dev/quick-signin", { cache: "no-store" }));
}

export async function devQuickSignInSet(on: boolean): Promise<{ ok: boolean; on: boolean }> {
  return handle(await fetch("/api/dev/quick-signin", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ on }),
  }));
}

// ---- PWA install (login-opts is public & cosmetic) ----

export async function fetchLoginOpts(): Promise<{ quickSignIn: boolean }> {
  return handle(await fetch("/api/login-opts", { cache: "no-store" }));
}
