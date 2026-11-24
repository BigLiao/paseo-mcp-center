import { spawn } from "node:child_process";
import type { McpServerConfig, ProbeResult } from "../shared/contracts";

const PROBE_TIMEOUT_MS = 10_000;

interface JsonRpcResponse {
  id?: number | string;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

function parseSseOrJson(text: string): JsonRpcResponse | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as JsonRpcResponse;
  }
  // Handle text/event-stream (Streamable HTTP / SSE MCP servers)
  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      if (payload.startsWith("{")) {
        try {
          return JSON.parse(payload) as JsonRpcResponse;
        } catch {
          // keep looking
        }
      }
    }
  }
  return null;
}

async function probeHttp(config: Extract<McpServerConfig, { type: "http" }>): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(config.headers ?? {}),
    };

    const initRes = await fetch(config.url, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "paseo-mcp-center", version: "0.1.0" },
        },
      }),
      signal: controller.signal,
    });

    if (!initRes.ok) {
      const bodySnippet = (await initRes.text()).slice(0, 200);
      return {
        ok: false,
        latencyMs: Date.now() - started,
        transport: "http",
        tools: [],
        error: `HTTP ${initRes.status}${bodySnippet ? `: ${bodySnippet}` : ""}`,
      };
    }

    const sessionId = initRes.headers.get("mcp-session-id");
    const initText = await initRes.text();
    const initJson = parseSseOrJson(initText);

    if (initJson?.error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        transport: "http",
        tools: [],
        error: initJson.error.message ?? "MCP initialize error",
      };
    }

    const serverInfoRaw = initJson?.result?.serverInfo as
      | { name?: unknown; version?: unknown }
      | undefined;
    const serverInfo = serverInfoRaw
      ? {
          name: typeof serverInfoRaw.name === "string" ? serverInfoRaw.name : undefined,
          version: typeof serverInfoRaw.version === "string" ? serverInfoRaw.version : undefined,
        }
      : undefined;

    const reqHeaders = sessionId
      ? { ...baseHeaders, "mcp-session-id": sessionId }
      : baseHeaders;

    // Best-effort initialized notification
    await fetch(config.url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      signal: controller.signal,
    }).catch(() => {});

    const toolsRes = await fetch(config.url, {
      method: "POST",
      headers: reqHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {},
      }),
      signal: controller.signal,
    });

    let tools: { name: string; description?: string }[] = [];
    if (toolsRes.ok) {
      const toolsJson = parseSseOrJson(await toolsRes.text());
      const rawTools = toolsJson?.result?.tools;
      if (Array.isArray(rawTools)) {
        tools = rawTools
          .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === "object"))
          .map((t) => ({
            name: String(t.name ?? ""),
            description: typeof t.description === "string" ? t.description.slice(0, 160) : undefined,
          }))
          .filter((t) => t.name.length > 0);
      }
    }

    return {
      ok: true,
      latencyMs: Date.now() - started,
      transport: "http",
      ...(serverInfo ? { serverInfo } : {}),
      tools,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      transport: "http",
      tools: [],
      error:
        error instanceof Error && error.name === "AbortError"
          ? `请求超时 (${PROBE_TIMEOUT_MS / 1000}s)`
          : error instanceof Error
            ? error.message
            : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeStdio(config: Extract<McpServerConfig, { type: "stdio" }>): Promise<ProbeResult> {
  const started = Date.now();
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let buffer = "";
    let stderrBuf = "";
    let serverInfo: { name?: string; version?: string } | undefined;

    const child = spawn(config.command, config.args ?? [], {
      env: { ...process.env, ...(config.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });

    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        latencyMs: Date.now() - started,
        transport: "stdio",
        tools: [],
        error: `stdio 探测超时 (${PROBE_TIMEOUT_MS / 1000}s)${stderrBuf ? `: ${stderrBuf.trim().slice(0, 200)}` : ""}`,
      });
    }, PROBE_TIMEOUT_MS);

    child.on("error", (error) => {
      finish({
        ok: false,
        latencyMs: Date.now() - started,
        transport: "stdio",
        tools: [],
        error: error.message,
      });
    });

    child.on("exit", (code) => {
      if (!settled) {
        finish({
          ok: false,
          latencyMs: Date.now() - started,
          transport: "stdio",
          tools: [],
          error: `进程提前退出 (code=${code ?? "null"})${stderrBuf ? `: ${stderrBuf.trim().slice(0, 200)}` : ""}`,
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
      if (stderrBuf.length > 2000) stderrBuf = stderrBuf.slice(-2000);
    });

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("{")) continue;
        let msg: JsonRpcResponse;
        try {
          msg = JSON.parse(trimmed) as JsonRpcResponse;
        } catch {
          continue;
        }
        if (msg.id === 1) {
          if (msg.error) {
            finish({
              ok: false,
              latencyMs: Date.now() - started,
              transport: "stdio",
              tools: [],
              error: msg.error.message ?? "MCP initialize error",
            });
            return;
          }
          const rawInfo = msg.result?.serverInfo as { name?: unknown; version?: unknown } | undefined;
          if (rawInfo) {
            serverInfo = {
              name: typeof rawInfo.name === "string" ? rawInfo.name : undefined,
              version: typeof rawInfo.version === "string" ? rawInfo.version : undefined,
            };
          }
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
          );
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`,
          );
        } else if (msg.id === 2) {
          const rawTools = msg.result?.tools;
          const tools = Array.isArray(rawTools)
            ? rawTools
                .filter((t): t is Record<string, unknown> => Boolean(t && typeof t === "object"))
                .map((t) => ({
                  name: String(t.name ?? ""),
                  description: typeof t.description === "string" ? t.description.slice(0, 160) : undefined,
                }))
                .filter((t) => t.name.length > 0)
            : [];
          finish({
            ok: true,
            latencyMs: Date.now() - started,
            transport: "stdio",
            ...(serverInfo ? { serverInfo } : {}),
            tools,
          });
          return;
        }
      }
    });

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "paseo-mcp-center", version: "0.1.0" },
        },
      })}\n`,
    );
  });
}

export async function probeMcpServer(config: McpServerConfig): Promise<ProbeResult> {
  if (config.type === "http") {
    return probeHttp(config);
  }
  return probeStdio(config);
}
