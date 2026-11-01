import type { DatabaseApi } from "../db/database.js";
import { AppError } from "../utils/errors.js";
import { getServiceMetrics } from "../application/metrics.js";
import { getGroupView, listGroups } from "../application/groups.js";
import { loadStatusDocument } from "../status/pageData.js";
import {
  buildHealth,
  getIncidentView,
  getMonitorView,
  listMonitorViews,
  listOpenIncidentViews,
} from "../application/readModels.js";
import { listWorkloads } from "../application/workloads.js";
import { requireGroup, requireScope, requestedGroup, visibleService } from "../auth/access.js";
import type { Monitor } from "../services/monitor.js";
import type { AuthContext, AuthScope, ServiceStatus } from "../types/index.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope?: AuthScope;
  call: (args: Record<string, unknown>) => Promise<unknown>;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export function createMcpTools(
  db: DatabaseApi,
  monitor: (Pick<Monitor, "isRunning" | "activeServiceCount"> & Partial<Pick<Monitor, "runOnce">>) | undefined,
  auth: AuthContext,
  enabledProbes: readonly string[] = [],
): McpTool[] {
  const tools: McpTool[] = [
    {
      name: "health.get",
      description: "Process health: database connectivity, scheduler liveness, and active monitor count.",
      inputSchema: objectSchema({}),
      async call() {
        return buildHealth(db, monitor).body;
      },
    },
    {
      name: "monitors.list",
      description: "List monitors with the latest status. Omits secrets and probe config.",
      inputSchema: objectSchema({
        groupId: { type: "string" },
        kind: { type: "string" },
        status: { type: "string", enum: ["UP", "DEGRADED", "DOWN", "UNKNOWN"] },
      }),
      async call(args) {
        return listMonitorViews(db, {
          groupId: requestedGroup(auth, optionalString(args.groupId)),
          kind: optionalString(args.kind),
          status: optionalString(args.status) as ServiceStatus | undefined,
        });
      },
    },
    {
      name: "monitors.get",
      description: "One monitor, including thresholds and redacted config.",
      inputSchema: objectSchema({ id: { type: "string" } }, ["id"]),
      async call(args) {
        const id = requireString(args.id, "id");
        visibleService(db, auth, id);
        return getMonitorView(db, id);
      },
    },
    {
      name: "incidents.list_open",
      description: "Open incidents with service name, reason, error class, and age.",
      inputSchema: objectSchema({ groupId: { type: "string" } }),
      async call(args) {
        return listOpenIncidentViews(db, requestedGroup(auth, optionalString(args.groupId)));
      },
    },
    {
      name: "incidents.get",
      description: "One incident, its timeline, and acknowledgements.",
      inputSchema: objectSchema({ id: { type: "string" } }, ["id"]),
      async call(args) {
        const view = getIncidentView(db, requireString(args.id, "id"));
        const service = db.getService(view.serviceId);
        if (!service) {
          throw new AppError("NOT_FOUND", `Service ${view.serviceId} does not exist`, 404);
        }
        requireGroup(auth, service.groupId);
        return view;
      },
    },
    {
      name: "incidents.list_for_monitor",
      description: "Newest incidents for one monitor, open or resolved.",
      inputSchema: objectSchema({
        serviceId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      }, ["serviceId"]),
      async call(args) {
        const service = visibleService(db, auth, requireString(args.serviceId, "serviceId"));
        const limit = clampLimit(args.limit);
        return db.listIncidents(service.id).slice(0, limit);
      },
    },
    {
      name: "checks.latest",
      description: "The newest saved check for a monitor, or null.",
      inputSchema: objectSchema({ serviceId: { type: "string" } }, ["serviceId"]),
      async call(args) {
        const service = visibleService(db, auth, requireString(args.serviceId, "serviceId"));
        return db.getLatestHealthCheck(service.id) ?? null;
      },
    },
    {
      name: "checks.recent",
      description: "Newest saved checks for a monitor.",
      inputSchema: objectSchema({
        serviceId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      }, ["serviceId"]),
      async call(args) {
        const service = visibleService(db, auth, requireString(args.serviceId, "serviceId"));
        return db.getRecentHealthChecks(service.id, clampLimit(args.limit));
      },
    },
    {
      name: "metrics.get",
      description: "Check-ratio uptime, duration-weighted uptime, latency, and incident counts for a window.",
      inputSchema: objectSchema({
        serviceId: { type: "string" },
        window: { type: "string", enum: ["1h", "24h", "7d", "30d"] },
      }, ["serviceId"]),
      async call(args) {
        const service = visibleService(db, auth, requireString(args.serviceId, "serviceId"));
        return getServiceMetrics(db, service.id, optionalString(args.window) ?? "24h");
      },
    },
    {
      name: "groups.list",
      description: "Groups the caller can see.",
      inputSchema: objectSchema({}),
      async call() {
        return listGroups(db, auth);
      },
    },
    {
      name: "groups.get",
      description: "One group and monitor counts by status.",
      inputSchema: objectSchema({ id: { type: "string" } }, ["id"]),
      async call(args) {
        return getGroupView(db, auth, requireString(args.id, "id"));
      },
    },
    {
      name: "status.get",
      description: "Public or private status document for a page slug. Public pages do not require a key.",
      inputSchema: objectSchema({ slug: { type: "string" } }, ["slug"]),
      async call(args) {
        return loadStatusDocument(db, auth, requireString(args.slug, "slug"));
      },
    },
    {
      name: "checks.run",
      description: "Run one check now, including retries and incident evaluation. Returns the check result even when the target is down.",
      scope: "write",
      inputSchema: objectSchema({ serviceId: { type: "string" } }, ["serviceId"]),
      async call(args) {
        if (!monitor?.runOnce) {
          throw new AppError("INTERNAL_ERROR", "Scheduler is not running", 503);
        }
        const service = visibleService(db, auth, requireString(args.serviceId, "serviceId"));
        const outcome = await monitor.runOnce(service.id);
        return outcome.result;
      },
    },
  ];

  if (enabledProbes.some((kind) => kind.startsWith("k8s."))) {
    tools.push({
      name: "workloads.list",
      description: "Kubernetes watches registered with this monitor, and their last status. This does not list arbitrary cluster objects.",
      inputSchema: objectSchema({}),
      async call() {
        return listWorkloads(db, auth);
      },
    });
  }

  return tools.map((tool) => ({
    ...tool,
    async call(args: Record<string, unknown>) {
      requireScope(auth, tool.scope ?? "read");
      return tool.call(args);
    },
  }));
}

export function createMcpResources() {
  return [
    { uri: "monitor://health", name: "health", description: "Process health.", mimeType: "application/json" },
    { uri: "monitor://summary", name: "summary", description: "Counts by status and open incidents.", mimeType: "application/json" },
    {
      uriTemplate: "monitor://services/{id}",
      name: "service",
      description: "One monitor.",
      mimeType: "application/json",
    },
    { uri: "monitor://incidents/open", name: "open-incidents", description: "Open incidents.", mimeType: "application/json" },
    {
      uriTemplate: "monitor://status/{slug}",
      name: "status",
      description: "Status document for a page slug.",
      mimeType: "application/json",
    },
  ];
}

export function createMcpPrompts() {
  return [
    {
      name: "explain-open-incidents",
      description: "Ask the client to explain every open incident from tool data.",
      arguments: [],
    },
    {
      name: "explain-incident",
      description: "Ask the client to explain one incident without inventing a cause.",
      arguments: [{ name: "incidentId", description: "Incident id", required: true }],
    },
  ];
}

export async function readMcpResource(
  db: DatabaseApi,
  uri: string,
  monitor: Pick<Monitor, "isRunning" | "activeServiceCount"> | undefined,
  auth: AuthContext,
) {
  requireScope(auth, "read");
  if (uri === "monitor://health") {
    return buildHealth(db, monitor).body;
  }
  if (uri === "monitor://summary") {
    const monitors = listMonitorViews(db, { groupId: auth.groupId ?? undefined });
    return {
      up: monitors.filter((item) => item.status === "UP").length,
      degraded: monitors.filter((item) => item.status === "DEGRADED").length,
      down: monitors.filter((item) => item.status === "DOWN").length,
      unknown: monitors.filter((item) => item.status === "UNKNOWN").length,
      openIncidents: listOpenIncidentViews(db, auth.groupId ?? undefined).length,
    };
  }
  if (uri === "monitor://incidents/open") {
    return listOpenIncidentViews(db, auth.groupId ?? undefined);
  }
  const statusMatch = /^monitor:\/\/status\/([^/]+)$/.exec(uri);
  if (statusMatch) {
    return loadStatusDocument(db, auth, decodeURIComponent(statusMatch[1]));
  }
  const serviceMatch = /^monitor:\/\/services\/([^/]+)$/.exec(uri);
  if (serviceMatch) {
    const id = decodeURIComponent(serviceMatch[1]);
    visibleService(db, auth, id);
    return getMonitorView(db, id);
  }
  throw new AppError("NOT_FOUND", `Resource ${uri} does not exist`, 404);
}

export function renderPrompt(name: string, args: Record<string, unknown>) {
  if (name === "explain-open-incidents") {
    return "Call incidents.list_open, then checks.latest for each affected service. Answer with the service, reason, error class, age, and whether the role is dependency. Use only the tool results.";
  }
  if (name === "explain-incident") {
    const incidentId = requireString(args.incidentId, "incidentId");
    return `Call incidents.get for ${incidentId} and checks.recent for its service. Describe the streak using the evidence. Do not invent a cause that is not in the tool results.`;
  }
  throw new AppError("NOT_FOUND", `Prompt ${name} does not exist`, 404);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AppError("VALIDATION_ERROR", `${name} is required`, 400);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_ERROR", "expected a string", 400);
  }
  return value;
}

function clampLimit(value: unknown): number {
  if (value == null) return 20;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new AppError("VALIDATION_ERROR", "limit must be an integer from 1 to 100", 400);
  }
  return value;
}
