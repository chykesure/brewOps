import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { haversineM } from "@/lib/geo";

// PATCH /api/workorders/[id] — accept / start / toggle step / complete / override / reassign / extend / cancel
// Evidence gates: start & steps require an on-site check-in; completion requires photo evidence.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { id } = await ctx.params;

  try {
    const body = await req.json();
    const action = String(body?.action ?? "");

    const wo = await db.workOrder.findUnique({ where: { id }, include: { steps: true, machine: true } });
    if (!wo) return NextResponse.json({ error: "Work order not found." }, { status: 404 });

    const isAdmin = user.role === "ADMIN";
    const isAssignee = wo.assignedToId === user.id;
    if (!isAdmin && !isAssignee) return NextResponse.json({ error: "Not your work order." }, { status: 403 });

    const verified = wo.verification === "VERIFIED" || wo.verification === "OVERRIDE";

    switch (action) {
      case "accept": {
        if (wo.status !== "PENDING") return NextResponse.json({ error: "Only pending orders can be accepted." }, { status: 400 });
        await db.workOrder.update({ where: { id }, data: { status: "ACCEPTED" } });
        break;
      }
      case "start": {
        if (!["PENDING", "ACCEPTED"].includes(wo.status)) return NextResponse.json({ error: "Cannot start this order." }, { status: 400 });
        // ---- ANTI OFFICE-FRAUD GATE ----
        // No on-site check-in → no start. The artisan must prove they are at the machine
        // (GPS geofence or the machine's nameplate number) before the checklist unlocks.
        if (!verified && !isAdmin) {
          return NextResponse.json(
            { error: "Check in at " + wo.machine.code + " first: use your GPS position or the machine's nameplate number.", needsCheckIn: true },
            { status: 403 },
          );
        }
        await db.workOrder.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: wo.startedAt ?? new Date() } });
        break;
      }
      case "toggleStep": {
        const stepId = String(body.stepId ?? "");
        const step = await db.woStep.findUnique({ where: { id: stepId } });
        if (!step || step.workOrderId !== id) return NextResponse.json({ error: "Step not found." }, { status: 404 });
        if (wo.status === "COMPLETED" || wo.status === "CANCELLED") {
          return NextResponse.json({ error: "This work order is closed." }, { status: 400 });
        }
        if (!verified && !isAdmin) {
          return NextResponse.json(
            { error: "Check in at the machine before ticking steps.", needsCheckIn: true },
            { status: 403 },
          );
        }
        // GPS stamp at tick time — server computes the distance from the machine tag
        const lat = typeof body.lat === "number" && isFinite(body.lat) ? body.lat : null;
        const lng = typeof body.lng === "number" && isFinite(body.lng) ? body.lng : null;
        const distanceM =
          lat != null && lng != null && wo.machine.lat != null && wo.machine.lng != null
            ? haversineM(lat, lng, wo.machine.lat, wo.machine.lng)
            : null;
        await db.woStep.update({
          where: { id: stepId },
          data: {
            doneAt: step.doneAt ? null : new Date(),
            lat: step.doneAt ? null : lat,
            lng: step.doneAt ? null : lng,
            distanceM: step.doneAt ? null : distanceM,
          },
        });
        if (wo.status === "PENDING" || wo.status === "ACCEPTED") {
          await db.workOrder.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: wo.startedAt ?? new Date() } });
        }
        break;
      }
      case "complete": {
        if (wo.status === "COMPLETED") return NextResponse.json({ error: "Already completed." }, { status: 400 });
        const remaining = (await db.woStep.findMany({ where: { workOrderId: id, doneAt: null } })).length;
        if (remaining > 0) return NextResponse.json({ error: `${remaining} step(s) not done yet.` }, { status: 400 });
        if (!verified && !isAdmin) {
          return NextResponse.json(
            { error: "Check in at the machine before signing off.", needsCheckIn: true },
            { status: 403 },
          );
        }
        // ---- Photo evidence is mandatory for artisans ----
        const evidenceIn = Array.isArray(body.evidence) ? body.evidence.map((u: unknown) => String(u)).filter(Boolean).slice(0, 6) : [];
        const flags: string[] = [];
        if (evidenceIn.length === 0) {
          if (isAdmin) flags.push("No photo evidence (completed by Engineer)");
          else return NextResponse.json({ error: "Attach at least one photo of the work as evidence before signing off.", needsEvidence: true }, { status: 403 });
        }
        // ---- Time-floor review flag: N steps ticked in an implausibly short sitting ----
        const startRef = wo.startedAt ?? wo.createdAt;
        const durationMin = (Date.now() - new Date(startRef).getTime()) / 60000;
        const minMin = Math.max(2, Math.ceil(wo.steps.length * 0.5));
        if (durationMin < minMin) {
          flags.push(`Signed off ${Math.max(1, Math.round(durationMin))} min after start for ${wo.steps.length} steps. Verify on-site execution`);
        }
        // Executioner Feedback — free text captured at sign-off (paper form footer)
        const feedback = body.feedback ? String(body.feedback).slice(0, 1000) : null;
        await db.workOrder.update({
          where: { id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(),
            feedback,
            evidence: JSON.stringify(evidenceIn),
            verification: wo.verification === "OVERRIDE" ? "OVERRIDE" : flags.length > 0 ? "FLAGGED" : wo.verification,
            flagReasons: flags.length > 0 ? [...(wo.flagReasons ? wo.flagReasons.split("\n") : []), ...flags].join("\n") : wo.flagReasons,
          },
        });
        return NextResponse.json({ ok: true, flags });
      }
      case "override": {
        // Engineer accepts flagged / missing evidence with a recorded reason
        if (!isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
        const reason = String(body.reason ?? "").trim().slice(0, 300);
        if (!reason) return NextResponse.json({ error: "An override reason is required." }, { status: 400 });
        await db.workOrder.update({
          where: { id },
          data: { verification: "OVERRIDE", overrideReason: reason, overrideByName: user.name },
        });
        break;
      }
      case "comment": {
        // Supervisor Comments — Engineer review note on the executed order
        if (!isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
        const comment = String(body.comment ?? "").trim().slice(0, 1000);
        if (!comment) return NextResponse.json({ error: "Comment cannot be empty." }, { status: 400 });
        await db.workOrder.update({ where: { id }, data: { supervisorComment: comment } });
        break;
      }
      case "acknowledge": {
        // Engineer approval of a completed order — closes the artisan's follow-up loop
        if (!isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
        if (wo.status !== "COMPLETED") return NextResponse.json({ error: "Only completed orders can be acknowledged." }, { status: 400 });
        await db.workOrder.update({
          where: { id },
          data: {
            acknowledgedAt: new Date(),
            acknowledgedById: user.id,
            ...(body.comment ? { supervisorComment: String(body.comment).trim().slice(0, 1000) || wo.supervisorComment } : {}),
          },
        });
        break;
      }
      case "nudge": {
        // Artisan follow-up ping — "my submitted work still needs your approval"
        if (!isAssignee) return NextResponse.json({ error: "Only the assigned artisan can follow up." }, { status: 403 });
        if (wo.status !== "COMPLETED") return NextResponse.json({ error: "Follow-up applies to submitted work." }, { status: 400 });
        if (wo.acknowledgedAt) return NextResponse.json({ error: "Already acknowledged by the Engineer." }, { status: 400 });
        const last = wo.lastNudgeAt?.getTime() ?? 0;
        if (Date.now() - last < 4 * 3600_000) {
          return NextResponse.json({ error: "You already followed up recently. Give the Engineer a moment." }, { status: 429 });
        }
        await db.workOrder.update({
          where: { id },
          data: { followUpCount: { increment: 1 }, lastNudgeAt: new Date() },
        });
        break;
      }
      case "reassign": {
        if (!isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
        const assignedToId = body.assignedToId ? String(body.assignedToId) : null;
        await db.workOrder.update({ where: { id }, data: { assignedToId, status: wo.status === "COMPLETED" ? wo.status : "PENDING" } });
        break;
      }
      case "extend": {
        if (!isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
        const due = new Date(String(body.dueDate));
        if (isNaN(due.getTime())) return NextResponse.json({ error: "Invalid date." }, { status: 400 });
        await db.workOrder.update({ where: { id }, data: { dueDate: due } });
        break;
      }
      case "cancel": {
        if (!isAdmin) return NextResponse.json({ error: "Admin access required." }, { status: 403 });
        await db.workOrder.update({ where: { id }, data: { status: "CANCELLED" } });
        break;
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Update failed." }, { status: 500 });
  }
}
