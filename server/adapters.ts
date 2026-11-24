import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  CLIENT_TARGETS,
  type ClientTarget,
  type McpServerConfig,
  type TargetStatus,
} from "../shared/contracts";
import { isInternalStdioConfig } from "../shared/internal-filter";

export interface RawTargetEntry {
  name: string;
  target: ClientTarget;
  enabled: boolean;
  config: McpServerConfig;
}

export interface TargetReadResult {
  status: TargetStatus;
  entries: RawTargetEntry[];
}

export function getPaseoHome(): string {
  return process.env.PASEO_HOME || path.join(os.homedir(), ".paseo");
}

export function getPluginDataDir(): string {
  return path.join(getPaseoHome(), "plugin-data", "paseo-mcp-center");
}

function getDisabledStorePath(): string {
  return path.join(getPluginDataDir(), "disabled-store.json");
}

export function getPaseoInjectPath(): string {
  return path.join(getPluginDataDir(), "paseo-inject.json");
}

export function resolveTargetPath(target: ClientTarget): string {
  const home = os.homedir();
  switch (target) {
    case "claude":
      return path.join(home, ".claude.json");
    case "claude-internal":
      return path.join(home, ".claude-internal", ".claude.json");
    case "codex":
      return path.join(home, ".codex", "config.toml");
    case "cursor":
      return path.join(home, ".cursor", "mcp.json");
    case "antigravity":
      return path.join(home, ".gemini", "config", "mcp_config.json");
    case "agents":
      return path.join(home, ".agents", "mcp.json");
    case "paseo":
      return getPaseoInjectPath();
  }
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function backupAndAtomicWrite(filePath: string, content: string): void {
  ensureDir(filePath);
  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, "utf8");
      if (existing === content) return;
      const backupPath = `${filePath}.mcp-center.bak`;
      fs.writeFileSync(backupPath, existing, { mode: 0o600 });
    } catch {
      // Best-effort backup; proceed only if write itself is valid.
    }
  }
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmpPath, filePath);
}

// ============================================================================
// Sidecar store for disabled JSON-client servers so toggling OFF preserves config
// ============================================================================

type DisabledStore = Record<string, Record<string, McpServerConfig>>;

function readDisabledStore(): DisabledStore {
  const filePath = getDisabledStorePath();
  if (!fs.existsSync(filePath)) return {};
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as DisabledStore) : {};
  } catch {
    return {};
  }
}

function writeDisabledStore(store: DisabledStore): void {
  const filePath = getDisabledStorePath();
  backupAndAtomicWrite(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

function setDisabledEntry(target: ClientTarget, name: string, config: McpServerConfig | null): void {
  const store = readDisabledStore();
  if (!store[target]) store[target] = {};
  if (config) {
    store[target][name] = config;
  } else {
    delete store[target][name];
  }
  writeDisabledStore(store);
}

// ============================================================================
// Normalization helpers (JSON & TOML <-> McpServerConfig)
// ============================================================================

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = String(v);
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeJsonServer(raw: unknown): { config: McpServerConfig; enabled: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const disabledFlag = obj.disabled === true || obj.enabled === false;
  const enabled = !disabledFlag;

  const url =
    typeof obj.url === "string"
      ? obj.url
      : typeof obj.serverUrl === "string"
        ? obj.serverUrl
        : undefined;

  if (url && url.trim()) {
    const headers = toStringRecord(obj.headers) ?? toStringRecord(obj.httpHeaders);
    const timeout = typeof obj.timeout === "number" && obj.timeout > 0 ? obj.timeout : undefined;
    const transportType =
      typeof obj.transportType === "string"
        ? obj.transportType
        : typeof obj.type === "string" && obj.type !== "stdio"
          ? obj.type
          : undefined;
    const alwaysLoad = typeof obj.alwaysLoad === "boolean" ? obj.alwaysLoad : undefined;
    return {
      enabled,
      config: {
        type: "http",
        url: url.trim(),
        ...(headers ? { headers } : {}),
        ...(timeout ? { timeout } : {}),
        ...(transportType ? { transportType } : {}),
        ...(alwaysLoad !== undefined ? { alwaysLoad } : {}),
      },
    };
  }

  if (typeof obj.command === "string" && obj.command.trim()) {
    const args = Array.isArray(obj.args)
      ? obj.args.map((item) => String(item))
      : undefined;
    const env = toStringRecord(obj.env);
    const timeout = typeof obj.timeout === "number" && obj.timeout > 0 ? obj.timeout : undefined;
    const alwaysLoad = typeof obj.alwaysLoad === "boolean" ? obj.alwaysLoad : undefined;
    return {
      enabled,
      config: {
        type: "stdio",
        command: obj.command.trim(),
        ...(args && args.length ? { args } : {}),
        ...(env ? { env } : {}),
        ...(timeout ? { timeout } : {}),
        ...(alwaysLoad !== undefined ? { alwaysLoad } : {}),
      },
    };
  }

  return null;
}

function serializeJsonServer(target: ClientTarget, config: McpServerConfig): Record<string, unknown> {
  if (config.type === "http") {
    const out: Record<string, unknown> = {
      url: config.url,
    };
    if (target === "antigravity") {
      // Antigravity accepts serverUrl or url; keep url + headers standard.
      out.url = config.url;
    } else if (config.transportType) {
      out.transportType = config.transportType;
    } else if (target === "claude" || target === "claude-internal") {
      out.type = "http";
    }
    if (config.headers && Object.keys(config.headers).length > 0) {
      out.headers = config.headers;
    }
    if (config.timeout) {
      out.timeout = config.timeout;
    }
    if (config.alwaysLoad !== undefined) {
      out.alwaysLoad = config.alwaysLoad;
    }
    return out;
  }

  const out: Record<string, unknown> = {
    command: config.command,
  };
  if (config.args && config.args.length > 0) {
    out.args = config.args;
  }
  if (config.env && Object.keys(config.env).length > 0) {
    out.env = config.env;
  }
  if (config.timeout) {
    out.timeout = config.timeout;
  }
  if (config.alwaysLoad !== undefined) {
    out.alwaysLoad = config.alwaysLoad;
  }
  return out;
}

function normalizeCodexServer(raw: unknown): { config: McpServerConfig; enabled: boolean } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const enabled = obj.enabled !== false;

  if (typeof obj.url === "string" && obj.url.trim()) {
    const headers = toStringRecord(obj.http_headers) ?? toStringRecord(obj.headers);
    const timeoutSec =
      typeof obj.tool_timeout_sec === "number"
        ? obj.tool_timeout_sec * 1000
        : typeof obj.startup_timeout_sec === "number"
          ? obj.startup_timeout_sec * 1000
          : undefined;
    return {
      enabled,
      config: {
        type: "http",
        url: obj.url.trim(),
        ...(headers ? { headers } : {}),
        ...(timeoutSec && timeoutSec > 0 ? { timeout: Math.round(timeoutSec) } : {}),
      },
    };
  }

  if (typeof obj.command === "string" && obj.command.trim()) {
    const args = Array.isArray(obj.args) ? obj.args.map((item) => String(item)) : undefined;
    const env = toStringRecord(obj.env);
    return {
      enabled,
      config: {
        type: "stdio",
        command: obj.command.trim(),
        ...(args && args.length ? { args } : {}),
        ...(env ? { env } : {}),
      },
    };
  }

  return null;
}

function serializeCodexServer(
  config: McpServerConfig,
  enabled: boolean,
  existing?: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = existing ? { ...existing } : {};
  // Clear conflicting transport fields when switching between http and stdio.
  delete out.url;
  delete out.http_headers;
  delete out.command;
  delete out.args;
  delete out.env;

  if (config.type === "http") {
    out.url = config.url;
    if (config.headers && Object.keys(config.headers).length > 0) {
      out.http_headers = config.headers;
    }
  } else {
    out.command = config.command;
    if (config.args && config.args.length > 0) {
      out.args = config.args;
    }
    if (config.env && Object.keys(config.env).length > 0) {
      out.env = config.env;
    }
  }

  if (!enabled) {
    out.enabled = false;
  } else {
    delete out.enabled;
  }
  return out;
}

// ============================================================================
// Paseo Inject Store
// ============================================================================

export interface PaseoInjectStore {
  services: Record<
    string,
    {
      enabled: boolean;
      config: McpServerConfig;
    }
  >;
}

export function readPaseoInjectStore(): PaseoInjectStore {
  const filePath = getPaseoInjectPath();
  if (!fs.existsSync(filePath)) return { services: {} };
  try {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return { services: {} };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.services && typeof parsed.services === "object") {
      return parsed as PaseoInjectStore;
    }
    return { services: {} };
  } catch {
    return { services: {} };
  }
}

function writePaseoInjectStore(store: PaseoInjectStore): void {
  backupAndAtomicWrite(getPaseoInjectPath(), `${JSON.stringify(store, null, 2)}\n`);
}

// ============================================================================
// Target Readers & Writers
// ============================================================================

export function readTarget(target: ClientTarget): TargetReadResult {
  const filePath = resolveTargetPath(target);
  const exists = fs.existsSync(filePath);

  if (target === "paseo") {
    const store = readPaseoInjectStore();
    const entries: RawTargetEntry[] = Object.entries(store.services).map(([name, item]) => ({
      name,
      target: "paseo",
      enabled: item.enabled,
      config: item.config,
    }));
    return {
      status: {
        target,
        path: filePath,
        exists: exists || entries.length > 0,
        serverCount: entries.length,
      },
      entries,
    };
  }

  if (target === "codex") {
    if (!exists) {
      return {
        status: { target, path: filePath, exists: false, serverCount: 0 },
        entries: [],
      };
    }
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      if (!raw.trim()) {
        return { status: { target, path: filePath, exists: true, serverCount: 0 }, entries: [] };
      }
      const doc = parseToml(raw) as Record<string, unknown>;
      const section = doc.mcp_servers;
      const entries: RawTargetEntry[] = [];
      if (section && typeof section === "object" && !Array.isArray(section)) {
        for (const [name, value] of Object.entries(section as Record<string, unknown>)) {
          const normalized = normalizeCodexServer(value);
          if (normalized && !isInternalStdioConfig(normalized.config)) {
            entries.push({
              name,
              target,
              enabled: normalized.enabled,
              config: normalized.config,
            });
          }
        }
      }
      return {
        status: { target, path: filePath, exists: true, serverCount: entries.length },
        entries,
      };
    } catch (error) {
      return {
        status: {
          target,
          path: filePath,
          exists: true,
          serverCount: 0,
          parseError: error instanceof Error ? error.message : String(error),
        },
        entries: [],
      };
    }
  }

  // JSON-based clients
  const disabledStore = readDisabledStore()[target] ?? {};
  const entriesByName = new Map<string, RawTargetEntry>();

  for (const [name, config] of Object.entries(disabledStore)) {
    if (!isInternalStdioConfig(config)) {
      entriesByName.set(name, { name, target, enabled: false, config });
    }
  }

  if (!exists) {
    const entries = [...entriesByName.values()];
    return {
      status: { target, path: filePath, exists: false, serverCount: entries.length },
      entries,
    };
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) {
      const entries = [...entriesByName.values()];
      return {
        status: {
          target,
          path: filePath,
          exists: true,
          serverCount: entries.length,
        },
        entries,
      };
    }
    const doc = JSON.parse(trimmed) as Record<string, unknown>;
    const serversObj = doc.mcpServers;
    if (serversObj && typeof serversObj === "object" && !Array.isArray(serversObj)) {
      for (const [name, value] of Object.entries(serversObj as Record<string, unknown>)) {
        const normalized = normalizeJsonServer(value);
        if (normalized && !isInternalStdioConfig(normalized.config)) {
          entriesByName.set(name, {
            name,
            target,
            enabled: normalized.enabled,
            config: normalized.config,
          });
        }
      }
    }
    const entries = [...entriesByName.values()];
    return {
      status: { target, path: filePath, exists: true, serverCount: entries.length },
      entries,
    };
  } catch (error) {
    const entries = [...entriesByName.values()];
    return {
      status: {
        target,
        path: filePath,
        exists: true,
        serverCount: entries.length,
        parseError: error instanceof Error ? error.message : String(error),
      },
      entries,
    };
  }
}

export function readAllTargets(): TargetReadResult[] {
  return CLIENT_TARGETS.map((target) => readTarget(target));
}

export function upsertInTarget(
  target: ClientTarget,
  name: string,
  config: McpServerConfig,
  enabled: boolean,
  previousName?: string,
): void {
  const filePath = resolveTargetPath(target);

  if (target === "paseo") {
    const store = readPaseoInjectStore();
    if (previousName && previousName !== name) {
      delete store.services[previousName];
    }
    store.services[name] = { enabled, config };
    writePaseoInjectStore(store);
    return;
  }

  if (target === "codex") {
    let doc: Record<string, unknown> = {};
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8");
      if (raw.trim()) {
        doc = parseToml(raw) as Record<string, unknown>;
      }
    }
    const existingServers =
      doc.mcp_servers && typeof doc.mcp_servers === "object" && !Array.isArray(doc.mcp_servers)
        ? ({ ...(doc.mcp_servers as Record<string, unknown>) } as Record<string, unknown>)
        : {};
    if (previousName && previousName !== name) {
      delete existingServers[previousName];
    }
    const prevEntry =
      existingServers[name] && typeof existingServers[name] === "object" && !Array.isArray(existingServers[name])
        ? (existingServers[name] as Record<string, unknown>)
        : undefined;
    existingServers[name] = serializeCodexServer(config, enabled, prevEntry);
    doc.mcp_servers = existingServers;
    backupAndAtomicWrite(filePath, `${stringifyToml(doc)}\n`);
    return;
  }

  // JSON-based client
  let doc: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (raw) {
      doc = JSON.parse(raw) as Record<string, unknown>;
    }
  }
  const existingServers =
    doc.mcpServers && typeof doc.mcpServers === "object" && !Array.isArray(doc.mcpServers)
      ? ({ ...(doc.mcpServers as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  if (previousName && previousName !== name) {
    delete existingServers[previousName];
    setDisabledEntry(target, previousName, null);
  }

  if (enabled) {
    existingServers[name] = serializeJsonServer(target, config);
    setDisabledEntry(target, name, null);
  } else {
    delete existingServers[name];
    setDisabledEntry(target, name, config);
  }

  doc.mcpServers = existingServers;
  backupAndAtomicWrite(filePath, `${JSON.stringify(doc, null, 2)}\n`);
}

export function removeFromTarget(target: ClientTarget, name: string): void {
  const filePath = resolveTargetPath(target);

  if (target === "paseo") {
    const store = readPaseoInjectStore();
    if (name in store.services) {
      delete store.services[name];
      writePaseoInjectStore(store);
    }
    return;
  }

  if (target === "codex") {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return;
    const doc = parseToml(raw) as Record<string, unknown>;
    if (doc.mcp_servers && typeof doc.mcp_servers === "object" && !Array.isArray(doc.mcp_servers)) {
      const section = { ...(doc.mcp_servers as Record<string, unknown>) };
      if (name in section) {
        delete section[name];
        doc.mcp_servers = section;
        backupAndAtomicWrite(filePath, `${stringifyToml(doc)}\n`);
      }
    }
    return;
  }

  // JSON-based client
  setDisabledEntry(target, name, null);
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return;
  const doc = JSON.parse(raw) as Record<string, unknown>;
  if (doc.mcpServers && typeof doc.mcpServers === "object" && !Array.isArray(doc.mcpServers)) {
    const section = { ...(doc.mcpServers as Record<string, unknown>) };
    if (name in section) {
      delete section[name];
      doc.mcpServers = section;
      backupAndAtomicWrite(filePath, `${JSON.stringify(doc, null, 2)}\n`);
    }
  }
}
