import { prisma } from "../config/prisma.js";
import { Prisma } from "@prisma/client";

// Fire-and-forget: an audit log failure should never break the request that
// triggered it. Used for things like role changes, deletions, and booking
// status changes so a multi-organizer team has some accountability trail.
export function recordAuditLog(params: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  meta?: Record<string, unknown>;
}): void {
  prisma.auditLog
    .create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        meta: params.meta as Prisma.InputJsonValue | undefined,
      },
    })
    .catch((err) => console.error("[auditLog] Failed to record:", err));
}