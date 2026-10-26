"use client";

import type { Status } from "@/lib/types";
import { STATUS_META } from "@/lib/status";

export function StatusBadge({ status, size = "sm" }: { status: Status; size?: "sm" | "xs" }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap ${meta.badge} ${size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-1.5 py-0.5 text-[9px]"}`}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-2.5 w-2.5"} />
      {meta.label}
    </span>
  );
}

export function StatusDot({ status }: { status: Status }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${STATUS_META[status].dot}`} aria-hidden />;
}
