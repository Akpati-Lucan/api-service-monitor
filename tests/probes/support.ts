import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import type { CheckResult } from "../../src/types/index.js";
import type { ProbeContext } from "../../src/probes/types.js";
import { createNoopLogger } from "../../src/utils/logger.js";

const exec = promisify(execFile);

export const PASSWORD = "probe-secret";

export function openContext(timeoutMs: number, secret?: string): ProbeContext & { stop: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    timeoutMs,
    signal: controller.signal,
    secret,
    log: createNoopLogger(),
    stop() {
      clearTimeout(timer);
    },
  };
}

export async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address && typeof address !== "string" ? address.port : 0);
    });
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

export async function silentPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const port = await new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address && typeof address !== "string" ? address.port : 0);
    });
  });
  return {
    port,
    close() {
      for (const socket of sockets) socket.destroy();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export async function runContainer(input: {
  image: string;
  containerPort: number;
  env?: string[];
  command?: string[];
}): Promise<{ host: string; port: number; stop: () => Promise<void> }> {
  const name = `apimon-${process.pid}-${Math.random().toString(16).slice(2, 8)}`;
  const hostPort = await closedPort();
  const args = ["run", "-d", "--name", name, "-p", `127.0.0.1:${hostPort}:${input.containerPort}`];
  for (const entry of input.env ?? []) args.push("-e", entry);
  args.push(input.image);
  if (input.command) args.push(...input.command);
  try {
    await exec("docker", args);
  } catch (error) {
    await exec("docker", ["rm", "-f", name]).catch(() => undefined);
    throw error;
  }
  return {
    host: "127.0.0.1",
    port: hostPort,
    async stop() {
      await exec("docker", ["rm", "-f", name]).catch(() => undefined);
    },
  };
}

export async function waitForUp(check: () => Promise<CheckResult>, timeoutMs = 90000): Promise<CheckResult> {
  const started = Date.now();
  let last: CheckResult | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await check();
    if (last.status === "UP") return last;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`database did not become ready: ${last?.errorClass ?? "unknown"} ${last?.error ?? ""}`.replaceAll(PASSWORD, "[redacted]"));
}
