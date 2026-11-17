import type { AlertEvent, Service, Incident } from "../types/index.js";
import type { Logger } from "../utils/logger.js";

export interface PushPayload {
  incidentId: string;
  serviceName: string;
  kind: "opened" | "resolved";
  reason: string;
}

export interface PushSink {
  push(payload: PushPayload): Promise<void>;
}

export class LoggingPushSink implements PushSink {
  constructor(private readonly logger: Logger) {}

  async push(payload: PushPayload): Promise<void> {
    this.logger.info(payload, "push notification");
  }
}

export interface AlertSink {
  notify(event: {
    service: Service;
    incident: Incident;
    kind: "opened" | "resolved";
  }): Promise<void>;
}

export class LoggingAlertSink implements AlertSink {
  constructor(private readonly logger: Logger) {}

  async notify(event: {
    service: Service;
    incident: Incident;
    kind: "opened" | "resolved";
  }): Promise<void> {
    this.logger.info(
      {
        service: event.service.name,
        serviceId: event.service.id,
        incidentId: event.incident.id,
        kind: event.kind,
        reason: event.incident.reason,
      },
      "alert notification emitted",
    );
  }
}
