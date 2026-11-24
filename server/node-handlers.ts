import os from "node:os";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PaseoApi } from "@getpaseo/client";
import {
  type AggregatedServer,
  type ClientTarget,
  type McpServerConfig,
  type NodeInventory,
  type nodeGetConfigRpc,
  type nodeInventoryRpc,
  type nodeProbeRpc,
  type nodeRemoveRpc,
  type nodeUpsertRpc,
} from "../shared/contracts";
import {
  readAllTargets,
  readTarget,
  removeFromTarget,
  upsertInTarget,
  type RawTargetEntry,
} from "./adapters";
import { probeMcpServer } from "./probe";
import { fingerprintConfig, maskConfig, summarizeEndpoint } from "./redact";

async function resolveSelfIdentity(paseo: PaseoApi): Promise<{ hostId: string; label: string }> {
  try {
    const dir = await paseo.hosts.list();
    return {
      hostId: dir.self.serverId,
      label: dir.self.label || os.hostname(),
    };
  } catch {
    return {
      hostId: `local:${os.hostname()}`,
      label: os.hostname(),
    };
  }
}

export async function handleNodeInventory(
  _input: RpcInput<typeof nodeInventoryRpc>,
  paseo: PaseoApi,
): Promise<NodeInventory> {
  const self = await resolveSelfIdentity(paseo);
  const results = readAllTargets();
  const targets = results.map((r) => r.status);

  const byName = new Map<string, RawTargetEntry[]>();
  for (const res of results) {
    for (const entry of res.entries) {
      const list = byName.get(entry.name) ?? [];
      list.push(entry);
      byName.set(entry.name, list);
    }
  }

  const servers: AggregatedServer[] = [];
  for (const [name, rawEntries] of byName.entries()) {
    const entries = rawEntries.map((entry) => ({
      target: entry.target,
      enabled: entry.enabled,
      fingerprint: fingerprintConfig(entry.config),
      maskedConfig: maskConfig(entry.config),
    }));

    const primary =
      rawEntries.find((e) => e.enabled) ?? rawEntries[0];
    const primaryFp = fingerprintConfig(primary.config);
    const uniqueFps = new Set(entries.map((e) => e.fingerprint));

    servers.push({
      name,
      type: primary.config.type,
      endpointPreview: summarizeEndpoint(primary.config),
      primaryTarget: primary.target,
      fingerprint: primaryFp,
      hasTargetDrift: uniqueFps.size > 1,
      entries,
    });
  }

  servers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    hostId: self.hostId,
    label: self.label,
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    collectedAt: new Date().toISOString(),
    targets,
    servers,
  };
}

function findServerEntry(name: string, target?: ClientTarget): RawTargetEntry {
  if (target) {
    const found = readTarget(target).entries.find((e) => e.name === name);
    if (!found) {
      throw new Error(`未在 ${target} 中找到 MCP "${name}"`);
    }
    return found;
  }
  for (const res of readAllTargets()) {
    const enabledMatch = res.entries.find((e) => e.name === name && e.enabled);
    if (enabledMatch) return enabledMatch;
  }
  for (const res of readAllTargets()) {
    const anyMatch = res.entries.find((e) => e.name === name);
    if (anyMatch) return anyMatch;
  }
  throw new Error(`未找到 MCP "${name}"`);
}

export async function handleNodeGetConfig(
  input: RpcInput<typeof nodeGetConfigRpc>,
): Promise<RpcOutput<typeof nodeGetConfigRpc>> {
  const found = findServerEntry(input.name, input.target);
  return {
    name: found.name,
    target: found.target,
    enabled: found.enabled,
    config: found.config,
  };
}

export async function handleNodeUpsert(
  input: RpcInput<typeof nodeUpsertRpc>,
): Promise<RpcOutput<typeof nodeUpsertRpc>> {
  const name = input.name.trim();
  if (!name) throw new Error("MCP 名称不能为空");

  const lookupName = input.previousName ?? name;
  let fallbackConfig: McpServerConfig | undefined = input.config;
  if (!fallbackConfig) {
    const found = findServerEntry(lookupName, input.sourceTargetForClone);
    fallbackConfig = found.config;
  }

  const appliedTargets: ClientTarget[] = [];
  const warnings: string[] = [];

  for (const target of input.targets) {
    try {
      let targetConfig = input.config;
      if (!targetConfig) {
        const existingInTarget = readTarget(target).entries.find((e) => e.name === lookupName);
        targetConfig = existingInTarget?.config ?? fallbackConfig;
      }
      upsertInTarget(target, name, targetConfig, input.enabled, input.previousName);
      appliedTargets.push(target);
    } catch (error) {
      warnings.push(
        `${target}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (appliedTargets.length === 0 && warnings.length > 0) {
    throw new Error(`写入失败: ${warnings.join("; ")}`);
  }

  return {
    ok: true,
    name,
    appliedTargets,
    warnings,
  };
}

export async function handleNodeRemove(
  input: RpcInput<typeof nodeRemoveRpc>,
): Promise<RpcOutput<typeof nodeRemoveRpc>> {
  const removedTargets: ClientTarget[] = [];
  for (const target of input.targets) {
    removeFromTarget(target, input.name);
    removedTargets.push(target);
  }
  return {
    ok: true,
    removedTargets,
  };
}

export async function handleNodeProbe(
  input: RpcInput<typeof nodeProbeRpc>,
): Promise<RpcOutput<typeof nodeProbeRpc>> {
  const config =
    input.configOverride ?? findServerEntry(input.name, input.target).config;
  return probeMcpServer(config);
}
