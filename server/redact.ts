import { createHash } from "node:crypto";
import type { McpServerConfig } from "../shared/contracts";

function maskSecretValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (/^\$\{[A-Za-z0-9_]+\}$/.test(trimmed)) return trimmed;
  const bearerMatch = /^(Bearer|Basic|Token)\s+(.+)$/i.exec(trimmed);
  if (bearerMatch) {
    const scheme = bearerMatch[1];
    const token = bearerMatch[2];
    if (token.length <= 6) return `${scheme} ****`;
    return `${scheme} ${token.slice(0, 2)}****${token.slice(-4)}`;
  }
  if (trimmed.length <= 6) return "****";
  return `${trimmed.slice(0, 2)}****${trimmed.slice(-4)}`;
}

function maskUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|key|secret|auth|pass|sig/i.test(key)) {
        parsed.searchParams.set(key, "****");
      }
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function maskConfig(config: McpServerConfig): McpServerConfig {
  if (config.type === "http") {
    const maskedHeaders = config.headers
      ? Object.fromEntries(
          Object.entries(config.headers).map(([k, v]) => [k, maskSecretValue(v)]),
        )
      : undefined;
    return {
      ...config,
      url: maskUrl(config.url),
      ...(maskedHeaders ? { headers: maskedHeaders } : {}),
    };
  }
  const maskedEnv = config.env
    ? Object.fromEntries(
        Object.entries(config.env).map(([k, v]) => [k, maskSecretValue(v)]),
      )
    : undefined;
  return {
    ...config,
    ...(maskedEnv ? { env: maskedEnv } : {}),
  };
}

export function summarizeEndpoint(config: McpServerConfig): string {
  if (config.type === "http") {
    return maskUrl(config.url);
  }
  const args = config.args?.length ? ` ${config.args.join(" ")}` : "";
  return `${config.command}${args}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function fingerprintConfig(config: McpServerConfig): string {
  // Normalize core connection semantics so minor client-specific metadata differences
  // (like timeout or transportType) do not cause noisy false diffs.
  const core =
    config.type === "http"
      ? {
          type: "http",
          url: config.url.trim(),
          headers: config.headers ?? {},
        }
      : {
          type: "stdio",
          command: config.command.trim(),
          args: config.args ?? [],
          env: config.env ?? {},
        };
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(core)))
    .digest("hex")
    .slice(0, 16);
}
