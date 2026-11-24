import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PaseoApi } from "@getpaseo/client";
import { createHostClient } from "@getpaseo/client/node";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { PluginRpcContract, RpcInput, RpcOutput } from "@getpaseo/plugin";
import { PLUGIN_ID } from "../shared/contracts";
import { getPaseoHome } from "./adapters";

export interface StoredHostEntry {
  registrationId: string;
  serverId: string;
  label: string;
  enabled: boolean;
  status?: string;
  targetDescription?: string;
  connection?: string;
}

function sanitizeErrorText(text: string): string {
  return text.replace(/([?&](?:password|key|token|secret)=)[^&\s]+/gi, "$1<REDACTED>");
}

export function readStoredHosts(): StoredHostEntry[] {
  const hostsFile = path.join(getPaseoHome(), "hosts.json");
  if (!fs.existsSync(hostsFile)) return [];
  try {
    const raw = fs.readFileSync(hostsFile, "utf8").trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredHostEntry =>
        Boolean(item && typeof item === "object" && typeof item.serverId === "string"),
    );
  } catch {
    return [];
  }
}

export async function getSelfHostId(paseo: PaseoApi): Promise<{ hostId: string; label: string }> {
  const dir = await paseo.hosts.list();
  return {
    hostId: dir.self.serverId,
    label: dir.self.label || dir.self.serverId,
  };
}

interface PooledClient {
  connection: string;
  client: DaemonClient;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const IDLE_CLOSE_MS = 90_000;
const CONNECT_TIMEOUT_MS = 10_000;
const pool = new Map<string, PooledClient>();

function scheduleIdleClose(serverId: string, entry: PooledClient): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    void closePeerClient(serverId);
  }, IDLE_CLOSE_MS);
}

async function closePeerClient(serverId: string): Promise<void> {
  const existing = pool.get(serverId);
  if (!existing) return;
  pool.delete(serverId);
  if (existing.idleTimer) clearTimeout(existing.idleTimer);
  try {
    await existing.client.close();
  } catch {
    // ignore close errors
  }
}

export async function disposeAllRelayClients(): Promise<void> {
  const ids = [...pool.keys()];
  await Promise.all(ids.map((id) => closePeerClient(id)));
}

async function getPeerClient(serverId: string): Promise<DaemonClient> {
  const stored = readStoredHosts().find((h) => h.serverId === serverId);
  if (!stored || !stored.connection) {
    throw new Error(`未在 hosts.json 中找到主机 ${serverId} 的连接信息`);
  }

  const existing = pool.get(serverId);
  if (existing && existing.connection === stored.connection) {
    if (existing.client.getConnectionState().status === "connected") {
      scheduleIdleClose(serverId, existing);
      return existing.client;
    }
    await closePeerClient(serverId);
  } else if (existing) {
    await closePeerClient(serverId);
  }

  const client = createHostClient(stored.connection, {
    clientId: `mcp-center-${randomUUID().slice(0, 8)}`,
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    reconnect: { enabled: false },
  });

  try {
    await client.connect();
  } catch (error) {
    try {
      await client.close();
    } catch {
      // ignore
    }
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(sanitizeErrorText(msg));
  }

  const pooled: PooledClient = {
    connection: stored.connection,
    client,
    idleTimer: null,
  };
  pool.set(serverId, pooled);
  scheduleIdleClose(serverId, pooled);
  return client;
}

export function classifyRemoteError(error: unknown): {
  kind: "offline" | "plugin_missing" | "error";
  message: string;
} {
  const raw = error instanceof Error ? error.message : String(error);
  const clean = sanitizeErrorText(raw);
  const lower = clean.toLowerCase();

  if (
    lower.includes("plugin") &&
    (lower.includes("not found") ||
      lower.includes("not running") ||
      lower.includes("not available") ||
      lower.includes("disabled") ||
      lower.includes("unavailable") ||
      lower.includes("unknown plugin") ||
      lower.includes("method"))
  ) {
    const prefix = `远端主机未安装或未启用 ${PLUGIN_ID} 插件`;
    return {
      kind: "plugin_missing",
      message: clean.startsWith(prefix) ? clean : `${prefix}（${clean}）`,
    };
  }

  if (
    lower.includes("offline") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("econnrefused") ||
    lower.includes("closed") ||
    lower.includes("unreachable") ||
    lower.includes("not connected")
  ) {
    return {
      kind: "offline",
      message: clean,
    };
  }

  return { kind: "error", message: clean };
}

export async function invokeRemoteNodeRpc<
  Contract extends PluginRpcContract<any, any>,
>(
  serverId: string,
  contract: Contract,
  input: RpcInput<Contract>,
): Promise<RpcOutput<Contract>> {
  const client = await getPeerClient(serverId);
  try {
    const rawResult = await client.invokePluginRpc(PLUGIN_ID, contract.name, input);
    return contract.output.parse(rawResult) as RpcOutput<Contract>;
  } catch (error) {
    const classified = classifyRemoteError(error);
    if (classified.kind === "offline") {
      await closePeerClient(serverId);
    }
    throw new Error(classified.message);
  }
}
