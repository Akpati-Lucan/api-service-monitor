import type { DatabaseApi } from "../db/database.js";
import type { AlertRoute, AlertEvent } from "../types/index.js";
import type { AlertSink } from "../services/alert.js";
import type { Logger } from "../utils/logger.js";
import { resolveSecret, scrubSecret } from "../probes/secrets.js";
import { sendSmtp } from "./smtp.js";

export class RoutingAlertSink implements AlertSink {
  constructor(private readonly options: {
    db: DatabaseApi;
    logger: Logger;
    statusBaseUrl: string;
    smtpUrl: string;
    smtpFrom: string;
    fallback: AlertSink;
  }) {}

  async notify(event: AlertEvent): Promise<void> {
    try {
      await this.options.fallback.notify(event);
    } catch (error) {
      this.options.logger.error({ err: error, incidentId: event.incident.id }, "alert sink failed");
    }

    const routes = this.options.db.listEnabledAlertRoutes().filter((route) => route.groupId == null || route.groupId === event.service.groupId);
    for (const route of routes) {
      try {
        await deliver(route, event, this.options);
        this.options.db.insertAlertDelivery({
          routeId: route.id,
          incidentId: event.incident.id,
          kind: event.kind,
          status: "sent",
        });
      } catch (error) {
        const secret = resolveSecret(route.secretRef);
        const message = scrubSecret(error instanceof Error ? error.message : "alert delivery failed", secret).slice(0, 500);
        this.options.logger.error({ err: error, routeId: route.id, incidentId: event.incident.id }, "alert sink failed");
        this.options.db.insertAlertDelivery({
          routeId: route.id,
          incidentId: event.incident.id,
          kind: event.kind,
          status: "failed",
          error: message,
        });
      }
    }
  }
}

async function deliver(
  route: AlertRoute,
  event: AlertEvent,
  options: { db: DatabaseApi; statusBaseUrl: string; smtpUrl: string; smtpFrom: string },
): Promise<void> {
  if (route.kind === "log") {
    return;
  }
  const secret = route.secretRef ? resolveSecret(route.secretRef) : undefined;
  if (route.secretRef && !secret) {
    throw new Error("secret not available");
  }
  const group = event.service.groupId ? options.db.getGroup(event.service.groupId) : undefined;
  const pageSlug = options.db.listPublicSlugsForService(event.service.id)[0];
  const pageUrl = pageSlug ? `${options.statusBaseUrl.replace(/\/$/, "")}/status/${pageSlug}` : undefined;
  const text = [
    `${event.service.name} (${group?.name ?? "ungrouped"}) ${event.kind}: ${event.incident.reason}`,
    pageUrl ?? "",
  ].filter((line) => line.length > 0).join("\n");

  if (route.kind === "webhook") {
    const url = route.config.url;
    if (typeof url !== "string") {
      throw new Error("webhook url is missing");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: JSON.stringify({
        service: {
          id: event.service.id,
          name: event.service.name,
          kind: event.service.kind,
          role: event.service.role,
          groupId: event.service.groupId,
        },
        incident: {
          id: event.incident.id,
          reason: event.incident.reason,
          errorClass: event.incident.errorClass ?? null,
          startedAt: event.incident.startedAt,
          resolvedAt: event.incident.resolvedAt ?? null,
        },
        kind: event.kind,
        group: group ? { id: group.id, name: group.name } : null,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`webhook status ${response.status}`);
    }
    return;
  }

  if (route.kind === "slack") {
    if (!secret) {
      throw new Error("secret not available");
    }
    const channel = typeof route.config.channel === "string" ? route.config.channel : undefined;
    const response = await fetch(secret, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, ...(channel ? { channel } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`slack status ${response.status}`);
    }
    return;
  }

  const to = route.config.to;
  if (!Array.isArray(to) || to.some((item) => typeof item !== "string")) {
    throw new Error("email recipients are missing");
  }
  if (!options.smtpUrl || !options.smtpFrom) {
    throw new Error("SMTP_URL is not configured");
  }
  await sendSmtp({
    smtpUrl: options.smtpUrl,
    from: options.smtpFrom,
    to: to as string[],
    subject: `[${event.kind}] ${event.service.name}`,
    text,
  });
}
