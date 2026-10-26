// ---- Shared types & constants (client + server safe) ----

export const STATUSES = [
  "WORKING", "STANDBY", "SIMULATION", "BYPASS", "FAULTY",
  "MAINTENANCE", "AWAITING_SPARES", "BROKEN", "LOTO", "COMMISSIONING",
] as const;
export type Status = (typeof STATUSES)[number];

export const ROLES = ["ADMIN", "ARTISAN"] as const;
export type Role = (typeof ROLES)[number];

// Artisan trades — artisans are categorised into Electrical and Mechanical
export const TRADES = ["MECHANICAL", "ELECTRICAL"] as const;
export type Trade = (typeof TRADES)[number];

// PM plan frequencies — mirrors the paper WO template family
// (daily, weekly, biweekly, 3-weekly, monthly and the likes)
export const FREQUENCIES = ["DAILY", "WEEKLY", "BIWEEKLY", "THREE_WEEKLY", "MONTHLY", "QUARTERLY", "HALFYEARLY", "YEARLY"] as const;
export type PmFrequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_META: Record<PmFrequency, { label: string; short: string; days: number }> = {
  DAILY:       { label: "Daily",        short: "Daily",  days: 1 },
  WEEKLY:      { label: "Weekly",       short: "Wkly",   days: 7 },
  BIWEEKLY:    { label: "Biweekly",     short: "2-Wkly", days: 14 },
  THREE_WEEKLY:{ label: "3-Weekly",     short: "3-Wkly", days: 21 },
  MONTHLY:     { label: "Monthly",      short: "Mthly",  days: 30 },
  QUARTERLY:   { label: "Quarterly",    short: "Qtrly",  days: 91 },
  HALFYEARLY:  { label: "Half-Yearly",  short: "6-Mth",  days: 182 },
  YEARLY:      { label: "Yearly",       short: "Yearly", days: 365 },
};

export const WO_SOURCES = ["MANUAL", "PM_PLAN", "SCHEDULER"] as const;
export type WoSource = (typeof WO_SOURCES)[number];

// Artisan escalation categories — the floor's feedback vocabulary to the Engineer
export const ESCALATION_CATEGORIES = ["NEEDS_SPARES", "CANNOT_FIX", "FOUND_MORE", "REROUTE", "SAFETY", "OTHER"] as const;
export type EscalationCategory = (typeof ESCALATION_CATEGORIES)[number];
export const ESCALATION_META: Record<EscalationCategory, { label: string; hint: string }> = {
  NEEDS_SPARES: { label: "Need spares",      hint: "A part is required to finish the job" },
  CANNOT_FIX:   { label: "Cannot fix",       hint: "Needs technical support or a senior hand" },
  FOUND_MORE:   { label: "Found more faults", hint: "Additional fault(s) discovered on the machine" },
  REROUTE:      { label: "Reroute this job",  hint: "Wrong job for me / wrong trade, please reassign" },
  SAFETY:       { label: "Safety concern",    hint: "Unsafe condition, work stopped. Engineer now" },
  OTHER:        { label: "Other",             hint: "Anything else the Engineer must know" },
};
export function isEscalationCategory(v: string): v is EscalationCategory {
  return (ESCALATION_CATEGORIES as readonly string[]).includes(v);
}

export const PM_CYCLES = ["NONE", "DAILY", "WEEKLY", "MONTHLY"] as const;
export type PmCycle = (typeof PM_CYCLES)[number];

export const WO_TYPES = ["PM", "CORRECTIVE"] as const;
export type WoType = (typeof WO_TYPES)[number];

export const WO_STATUSES = ["PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];

// Organisation identity & multi-site scaffolding (departments → branch → org)
export interface BranchDTO {
  id: string;
  name: string;
  location: string | null;
  active: boolean;
}
export interface OrgDTO {
  name: string;
  logoUrl: string | null; // company logo, printed on every report
  branches: BranchDTO[];
}

// Evidence-chain states — how strongly the system believes the work happened at the machine
export const VERIFICATIONS = ["PENDING", "VERIFIED", "FLAGGED", "OVERRIDE"] as const;
export type Verification = (typeof VERIFICATIONS)[number];
export const CHECKIN_METHODS = ["QR", "CODE", "GPS"] as const;
export type CheckInMethod = (typeof CHECKIN_METHODS)[number];

export const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Statuses that instantly alert the Brewing Engineer */
export const ALERTING_STATUSES: Status[] = ["BROKEN", "BYPASS", "SIMULATION", "LOTO", "FAULTY", "AWAITING_SPARES"];
export const CRITICAL_STATUSES: Status[] = ["BROKEN", "BYPASS", "SIMULATION", "LOTO"];

export function isStatus(v: string): v is Status {
  return (STATUSES as readonly string[]).includes(v);
}
export function isWoStatus(v: string): v is WoStatus {
  return (WO_STATUSES as readonly string[]).includes(v);
}
export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}
export function isPriority(v: string): v is Priority {
  return (PRIORITIES as readonly string[]).includes(v);
}
export function isWoType(v: string): v is WoType {
  return (WO_TYPES as readonly string[]).includes(v);
}
export function isPmCycle(v: string): v is PmCycle {
  return (PM_CYCLES as readonly string[]).includes(v);
}
export function isTrade(v: string): v is Trade {
  return (TRADES as readonly string[]).includes(v);
}
export function isFrequency(v: string): v is PmFrequency {
  return (FREQUENCIES as readonly string[]).includes(v);
}

// ---- DTOs (dates serialized as ISO strings) ----

export interface UserDTO {
  id: string;
  name: string;
  email: string;
  role: Role;
  trade: string | null;
  shift: string | null;
  avatarUrl: string | null; // profile photo, shown wherever the name appears
  departmentId: string | null; // home department — the artisan's department-wide round
  hasPassword: boolean; // a work password is set (device sync credential)
  pwdChangedAt: string | null; // null = still on the initial password, Security nudges a change
  licenseKey?: string | null; // access license issued at registration (BOPS-XXXX-XXXX-XXXX)
  licenseActive?: boolean; // false = the artisan sees the activation notice until the owner activates
}

export interface StatusLogDTO {
  id: string;
  status: Status;
  note: string | null;
  photo: string | null;
  distanceM: number | null; // on-site GPS evidence — meters from the machine tag
  userId: string;
  userName: string;
  createdAt: string;
}

export interface ComponentDTO {
  id: string;
  machineId: string;
  name: string;
  partCode: string | null;
  category: string | null;
  currentStatus: Status;
  updatedAt: string;
  reportedToday?: boolean;
  lastLog?: StatusLogDTO | null;
}

export interface PartDTO {
  id: string;
  code: string;
  name: string;
  stock: number;
  reorderLevel: number;
}

export interface MachineDTO {
  id: string;
  code: string;
  name: string;
  departmentId: string;
  departmentName: string;
  location: string | null;
  functionalLoc: string | null;
  equipmentNo: string | null;
  pmCycle: PmCycle;
  pmDay: number;
  lat: number | null;
  lng: number | null;
  geoRadiusM: number;
  checkinCode: string | null; // machine nameplate check-in code — Engineer only
  ownerId: string | null;
  ownerName: string | null;
  components: ComponentDTO[];
}

export interface WoStepDTO {
  id: string;
  idx: number;
  text: string;
  opIdx: number | null;
  opName: string | null;
  doneAt: string | null;
  distanceM: number | null; // GPS evidence at tick time
}

export interface WorkOrderDTO {
  id: string;
  code: string;
  title: string;
  description: string | null;
  type: WoType;
  priority: Priority;
  source: WoSource;
  frequency: PmFrequency | null;
  templateCode: string | null;
  machineId: string;
  machineCode: string;
  machineName: string;
  assignedToId: string | null;
  assignedToName: string | null;
  assignedToTrade: string | null;
  status: WoStatus;
  dueDate: string;
  startedAt: string | null;
  completedAt: string | null;
  feedback: string | null;
  supervisorComment: string | null;
  createdByName: string | null;
  createdAt: string;
  // Evidence chain
  verification: Verification;
  checkInMethod: CheckInMethod | null;
  checkInAt: string | null;
  checkInDistanceM: number | null;
  checkInPhoto: string | null; // live photo of the machine taken at check-in
  flagReasons: string[];
  evidence: string[]; // photo URLs
  overrideReason: string | null;
  overrideByName: string | null;
  checkInAttempts: number; // total attempts incl. rejected (tamper signal)
  // Approval loop — "awaiting the Engineer's approval" until acknowledged
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  followUpCount: number; // artisan follow-up nudges sent
  lastNudgeAt: string | null;
  steps: WoStepDTO[];
}

// ---- Machine PM history (search a machine → every PM carried on it + who took them) ----

export interface PmArtisanSummary {
  userId: string;
  name: string;
  trade: string | null;
  shift: string | null;
  pmCount: number;
  correctiveCount: number;
  lastPmAt: string | null;
  lastWoCode: string | null;
}

export interface MachinePmHistory {
  machine: {
    id: string;
    code: string;
    name: string;
    departmentName: string;
    location: string | null;
    functionalLoc: string | null;
    equipmentNo: string | null;
    ownerName: string | null;
  };
  orders: WorkOrderDTO[];
  artisans: PmArtisanSummary[];
  summary: {
    pmTotal: number;
    completedPm: number;
    openPm: number;
    pmsLast30d: number;
    lastPmAt: string | null;
    lastPmCode: string | null;
  };
}

// ---- PM plan templates (digitised paper WO templates) ----

export interface PmOperationDTO {
  id: string;
  idx: number;
  subAssembly: string;
  trade: Trade;
  tasks: string[];
}

export interface PmTemplateDTO {
  id: string;
  code: string;
  title: string;
  frequency: PmFrequency;
  priority: Priority;
  trade: Trade;
  durationMin: number | null;
  machineId: string;
  machineCode: string;
  machineName: string;
  active: boolean;
  nextDueAt: string;
  lastRunAt: string | null;
  operations: PmOperationDTO[];
  openCount: number;
}

export interface AlertItem {
  kind: "STATUS" | "OVERDUE_WO" | "LOW_STOCK" | "DOWNTIME" | "FLAGGED_WO" | "ESCALATION" | "APPROVAL";
  severity: "CRITICAL" | "HIGH" | "MEDIUM";
  title: string;
  detail: string;
  at: string;
  refId: string;
  machineId?: string;
  machineCode?: string;
  status?: Status;
}

// ---- Escalations (artisan feedback loop → Engineer quick-fix / reroute) ----

export interface EscalationDTO {
  id: string;
  machineId: string;
  machineCode: string;
  machineName: string;
  componentId: string | null;
  componentName: string | null;
  workOrderId: string | null;
  workOrderCode: string | null;
  workOrderStatus: WoStatus | null;
  raisedById: string;
  raisedByName: string;
  category: EscalationCategory;
  message: string;
  photo: string | null;
  status: "OPEN" | "ACK" | "RESOLVED";
  severity: "CRITICAL" | "HIGH" | "NORMAL";
  handledByName: string | null;
  handledAt: string | null;
  response: string | null;
  reroutedToName: string | null;
  createdAt: string;
}

export interface StatsDTO {
  openWorkOrders: number;
  overdueWorkOrders: number;
  completionRate7d: number;
  downComponents: number;
  reportedToday: number;
  totalComponents: number;
  avgCompletionHours: number | null;
  lowStockCount: number;
  verifiedRate7d: number | null; // % of completed orders (7d) with on-site evidence
  flaggedCount: number; // completed orders currently flagged for review
  closureRate: number | null; // % of completed orders (30d) acknowledged by the Engineer
  pendingApprovalCount: number; // completed orders still awaiting the Engineer's approval
}

export interface DowntimeDTO {
  id: string;
  machineId: string;
  machineCode: string;
  machineName: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  reportedByName: string;
}

export interface BootstrapData {
  user: UserDTO;
  machines: MachineDTO[];
  workOrders: WorkOrderDTO[];
  parts: PartDTO[];
  artisans: UserDTO[];
  alerts: AlertItem[];
  stats: StatsDTO;
  downtimes: DowntimeDTO[];
  notReportedToday: { machineId: string; machineCode: string; machineName: string; components: string[] }[];
  recentActivity: (StatusLogDTO & { componentName: string; machineCode: string })[];
  pmTemplates: PmTemplateDTO[];
  team: (UserDTO & { active: boolean; openWos: number; machines: number })[];
  escalations: EscalationDTO[]; // admin: all recent · artisan: own raised issues (loop closure)
  org: OrgDTO; // company identity + branches — printed on reports
  maintenance: boolean; // true = artisans are locked out behind the maintenance screen (dev console toggle)
}

// ---- Security module (trusted devices, sessions, audit feed) ----

export interface DeviceDTO {
  id: string;
  name: string;
  platform: string | null;
  mobile: boolean;
  approved: boolean;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface SessionDTO {
  id: string;
  deviceName: string;
  ip: string | null;
  lastSeenAt: string;
  createdAt: string;
  isCurrent: boolean;
}

export interface SecurityEventDTO {
  id: string;
  kind: string;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

export interface SecurityOverview {
  currentSessionId: string;
  devices: DeviceDTO[];
  sessions: SessionDTO[];
  events: SecurityEventDTO[];
}

// ---- Machine status log report (printable, with the company letterhead) ----

export interface StatusReportData {
  machine: {
    id: string; code: string; name: string;
    departmentName: string;
    location: string | null;
    functionalLoc: string | null;
    equipmentNo: string | null;
    ownerName: string | null;
    ownerTrade: string | null;
    componentCount: number;
  };
  from: string;
  to: string;
  summary: { total: number; byStatus: Record<string, number>; reporters: string[] };
  logs: {
    id: string;
    componentName: string;
    partCode: string | null;
    category: string | null;
    status: Status;
    note: string | null;
    distanceM: number | null;
    userName: string;
    trade: string | null;
    createdAt: string;
  }[];
  org: OrgDTO;
}

export interface DayReport {
  date: string;
  summary: Record<string, number>;
  machines: {
    machineId: string;
    code: string;
    name: string;
    departmentName?: string;
    logs: (StatusLogDTO & { componentName: string; componentPartCode: string | null; componentCategory?: string | null })[];
    missing: { name: string; partCode: string | null }[];
  }[];
  workOrders: {
    code: string; title: string; machine: string; status: string; type: string;
    priority?: string; assignedTo?: string | null; dueDate?: string; completedAt?: string | null;
    verification?: string;
  }[];
  downtimes?: {
    machineCode: string; machineName: string; reason: string;
    startedAt: string; endedAt: string | null; minutes: number | null; open: boolean; reportedBy: string;
  }[];
  spares?: { code: string; name: string; stock: number; reorderLevel: number }[];
  totalLogs: number;
  totalComponents: number;
}

// ---- Trend analytics ----

export type TrendVerdict = "FINE" | "WATCH" | "DEGRADING";
export type TrendDirection = "IMPROVING" | "STABLE" | "WORSENING";

export interface TrendDay {
  date: string;
  uptimePct: number;
  downtimeMin: number;
  faults: number;
  reportedPct: number;
}

export interface MachineTrend {
  machineId: string;
  code: string;
  name: string;
  departmentName: string;
  ownerName: string | null;
  currentIssueCount: number;
  uptimePct: number;
  uptime7: number;
  uptimePrev7: number;
  faults7: number;
  faultsPrev7: number;
  downtimeMin7: number;
  verdict: TrendVerdict;
  direction: TrendDirection;
  topIssue: string | null;
  spark: number[];
}

export interface TrendComponent {
  id: string;
  name: string;
  partCode: string | null;
  category: string | null;
  currentStatus: Status;
  logs: number;
  faults: number;
  cleanPct: number;
  lastNote: string | null;
  lastAt: string | null;
}

export interface TrendIncident {
  id: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  open: boolean;
}

export interface TrendsData {
  windowDays: number;
  days: string[];
  kpis: {
    uptimePct: number;
    downtimeHours: number;
    faultEvents: number;
    mtbfHours: number | null;
    mttrHours: number | null;
  };
  fleetDaily: TrendDay[];
  machines: MachineTrend[];
  detail: {
    machine: MachineTrend;
    daily: TrendDay[];
    statusMix: { status: Status; count: number }[];
    components: TrendComponent[];
    incidents: TrendIncident[];
  } | null;
}
