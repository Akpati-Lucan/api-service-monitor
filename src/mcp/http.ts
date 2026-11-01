import { Router } from "express";
import type { DatabaseApi } from "../db/database.js";
import { AppError, unauthorized } from "../utils/errors.js";
import { getStatusDocument } from "../status/pageData.js";
import type { Logger } from "../utils/logger.js";
import type { Monitor } from "../services/monitor.js";
import type { AppConfig, AuthContext } from "../types/index.js";
import {
  createMcpPrompts,
  createMcpResources,
  createMcpTools,
  readMcpResource,
  renderPrompt,
} from "./registry.js";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
    uri?: string;
    _meta?: Record<string, unknown>;
  };
}

export function createMcpRouter({
  db,
  config,
  monitor,
  logger,
}: {
  db: DatabaseApi;
  config: AppConfig;
  monitor?: Monitor;
  logger?: Logger;
}) {
  const router = Router();
  if (config.AUTH_MODE !== "enabled") {
    logger?.warn("MCP auth is disabled; treating callers as admin");
  }

  router.post("/", async (req, res) => {
    const body = req.body as JsonRpcRequest;
    const id = body?.id ?? null;

    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      res.status(400).json(rpcError(id, -32600, "Invalid Request"));
      return;
    }

    const auth = res.locals.auth as AuthContext | undefined;
    if (!auth && !isPublicStatusRequest(body)) {
      const error = unauthorized("Bearer token is required");
      res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
      return;
    }

    try {
      if (!auth) {
        const result = await publicStatusResult(db, body);
        res.json({ jsonrpc: "2.0", id, result });
        return;
      }
      const tools = createMcpTools(db, monitor, auth, config.ENABLED_PROBES);
      const result = await dispatch(body, tools, db, monitor, auth);
      res.json({ jsonrpc: "2.0", id, result });
    } catch (error) {
      if (error instanceof AppError) {
        res.json({
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [{ type: "text", text: error.message }],
            structuredContent: { error: { code: error.code, message: error.message } },
          },
        });
        return;
      }
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message === "METHOD_NOT_FOUND") {
        res.json(rpcError(id, -32601, "Method not found"));
        return;
      }
      if (message === "INVALID_PARAMS") {
        res.json(rpcError(id, -32602, "Invalid params"));
        return;
      }
      logger?.error({ err: error }, "mcp request failed");
      res.json(rpcError(id, -32603, "Internal error"));
    }
  });

  return router;
}

async function dispatch(
  body: JsonRpcRequest,
  tools: ReturnType<typeof createMcpTools>,
  db: DatabaseApi,
  monitor: Monitor | undefined,
  auth: AuthContext,
) {
  const params = body.params ?? {};
  if (body.method === "tools/list") {
    return {
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    };
  }

  if (body.method === "tools/call") {
    if (!params.name) {
      throw new Error("INVALID_PARAMS");
    }
    const tool = tools.find((item) => item.name === params.name);
    if (!tool) {
      throw new AppError("NOT_FOUND", `Tool ${params.name} does not exist`, 404);
    }
    const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};
    const structuredContent = await tool.call(args);
    return {
      content: [{ type: "text", text: summarize(params.name, structuredContent) }],
      structuredContent,
      isError: false,
    };
  }

  if (body.method === "resources/list") {
    return { resources: createMcpResources() };
  }

  if (body.method === "resources/read") {
    if (!params.uri) {
      throw new Error("INVALID_PARAMS");
    }
    const structuredContent = await readMcpResource(db, params.uri, monitor, auth);
    return {
      contents: [{
        uri: params.uri,
        mimeType: "application/json",
        text: JSON.stringify(structuredContent),
      }],
    };
  }

  if (body.method === "prompts/list") {
    return { prompts: createMcpPrompts() };
  }

  if (body.method === "prompts/get") {
    if (!params.name) {
      throw new Error("INVALID_PARAMS");
    }
    const text = renderPrompt(params.name, params.arguments ?? {});
    return {
      description: createMcpPrompts().find((prompt) => prompt.name === params.name)?.description,
      messages: [{ role: "user", content: { type: "text", text } }],
    };
  }

  throw new Error("METHOD_NOT_FOUND");
}

function summarize(name: string, value: unknown): string {
  if (Array.isArray(value)) {
    return `${name} returned ${value.length} item${value.length === 1 ? "" : "s"}.`;
  }
  if (value && typeof value === "object" && "status" in value) {
    return `${name} status is ${String((value as { status: unknown }).status)}.`;
  }
  return `${name} completed.`;
}

function isPublicStatusRequest(body: JsonRpcRequest): boolean {
  const params = body.params ?? {};
  if (body.method === "tools/call" && params.name === "status.get") {
    return true;
  }
  return body.method === "resources/read" && typeof params.uri === "string" && params.uri.startsWith("monitor://status/");
}

async function publicStatusResult(db: DatabaseApi, body: JsonRpcRequest) {
  const params = body.params ?? {};
  if (body.method === "tools/call") {
    const slug = params.arguments?.slug;
    if (typeof slug !== "string" || slug.trim().length === 0) {
      throw new AppError("VALIDATION_ERROR", "slug is required", 400);
    }
    const structuredContent = getStatusDocument(db, slug, null);
    return {
      content: [{ type: "text", text: `status.get status is ${structuredContent.status}.` }],
      structuredContent,
      isError: false,
    };
  }
  const uri = params.uri ?? "";
  const match = /^monitor:\/\/status\/([^/]+)$/.exec(uri);
  if (!match) {
    throw new AppError("NOT_FOUND", `Resource ${uri} does not exist`, 404);
  }
  const structuredContent = getStatusDocument(db, decodeURIComponent(match[1]), null);
  return {
    contents: [{
      uri,
      mimeType: "application/json",
      text: JSON.stringify(structuredContent),
    }],
  };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
