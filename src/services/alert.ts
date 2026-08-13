import type { AlertEvent, Service, Incident } from "../types/index.js";
import type { Logger } from "../utils/logger.js";

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
