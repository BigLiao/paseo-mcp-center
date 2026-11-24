import type { PaseoApi } from "@getpaseo/client";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import {
  type FleetNode,
  type FleetOverview,
  type MigrateItemPreview,
  type NodeInventory,
  type fleetExecuteMigrateRpc,
  type fleetGetConfigRpc,
  type fleetOverviewRpc,
  type fleetPreviewMigrateRpc,
  type fleetProbeRpc,
  type fleetRemoveRpc,
  type fleetUpsertRpc,
  nodeGetConfigRpc,
  nodeInventoryRpc,
  nodeProbeRpc,
  nodeRemoveRpc,
  nodeUpsertRpc,
} from "../shared/contracts";
import {
  handleNodeGetConfig,
  handleNodeInventory,
  handleNodeProbe,
  handleNodeRemove,
  handleNodeUpsert,
} from "./node-handlers";
import {
  classifyRemoteError,
  getSelfHostId,
  invokeRemoteNodeRpc,
  readStoredHosts,
} from "./relay";
import { fingerprintConfig } from "./redact";
import { filterInternalFromInventory } from "../shared/internal-filter";

async function getHostInventory(hostId: string, paseo: PaseoApi): Promise<NodeInventory> {
  const self = await getSelfHostId(paseo);
  const raw =
    hostId === self.hostId
      ? await handleNodeInventory({}, paseo)
      : await invokeRemoteNodeRpc(hostId, nodeInventoryRpc, {});
  return filterInternalFromInventory(raw);
}

async function getHostConfig(
  hostId: string,
  input: RpcInput<typeof nodeGetConfigRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof nodeGetConfigRpc>> {
  const self = await getSelfHostId(paseo);
  if (hostId === self.hostId) {
    return handleNodeGetConfig(input);
  }
  return invokeRemoteNodeRpc(hostId, nodeGetConfigRpc, input);
}

async function upsertOnHost(
  hostId: string,
  input: RpcInput<typeof nodeUpsertRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof nodeUpsertRpc>> {
  const self = await getSelfHostId(paseo);
  if (hostId === self.hostId) {
    return handleNodeUpsert(input);
  }
  return invokeRemoteNodeRpc(hostId, nodeUpsertRpc, input);
}

async function removeOnHost(
  hostId: string,
  input: RpcInput<typeof nodeRemoveRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof nodeRemoveRpc>> {
  const self = await getSelfHostId(paseo);
  if (hostId === self.hostId) {
    return handleNodeRemove(input);
  }
  return invokeRemoteNodeRpc(hostId, nodeRemoveRpc, input);
}

async function probeOnHost(
  hostId: string,
  input: RpcInput<typeof nodeProbeRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof nodeProbeRpc>> {
  const self = await getSelfHostId(paseo);
  if (hostId === self.hostId) {
    return handleNodeProbe(input);
  }
  return invokeRemoteNodeRpc(hostId, nodeProbeRpc, input);
}

export async function handleFleetOverview(
  _input: RpcInput<typeof fleetOverviewRpc>,
  paseo: PaseoApi,
): Promise<FleetOverview> {
  const selfInventory = await handleNodeInventory({}, paseo);
  const selfNode: FleetNode = {
    hostId: selfInventory.hostId,
    label: selfInventory.label,
    isSelf: true,
    status: "online",
    inventory: selfInventory,
  };

  let remoteHosts: {
    serverId: string;
    label: string;
    enabled: boolean;
    status: string;
    targetDescription?: string;
  }[] = [];

  try {
    const dir = await paseo.hosts.list();
    remoteHosts = dir.hosts
      .filter((h): h is typeof h & { serverId: string } => typeof h.serverId === "string" && h.serverId.length > 0)
      .map((h) => ({
        serverId: h.serverId,
        label: h.label || h.serverId,
        enabled: h.enabled,
        status: h.status,
        targetDescription: h.targetDescription,
      }));
  } catch {
    remoteHosts = readStoredHosts().map((h) => ({
      serverId: h.serverId,
      label: h.label || h.serverId,
      enabled: h.enabled,
      status: h.status ?? "unknown",
      targetDescription: h.targetDescription,
    }));
  }

  const remoteNodes = await Promise.all(
    remoteHosts
      .filter((h) => h.serverId !== selfInventory.hostId && h.enabled)
      .map(async (host): Promise<FleetNode> => {
        if (host.status === "offline") {
          return {
            hostId: host.serverId,
            label: host.label,
            isSelf: false,
            status: "offline",
            targetDescription: host.targetDescription,
            error: "主机当前离线",
          };
        }
        try {
          const rawInventory = await invokeRemoteNodeRpc(host.serverId, nodeInventoryRpc, {});
          const inventory = filterInternalFromInventory(rawInventory);
          return {
            hostId: host.serverId,
            label: host.label,
            isSelf: false,
            status: "online",
            targetDescription: host.targetDescription,
            inventory,
          };
        } catch (error) {
          const classified = classifyRemoteError(error);
          return {
            hostId: host.serverId,
            label: host.label,
            isSelf: false,
            status: classified.kind,
            targetDescription: host.targetDescription,
            error: classified.message,
          };
        }
      }),
  );

  return {
    selfHostId: selfInventory.hostId,
    nodes: [selfNode, ...remoteNodes],
  };
}

export async function handleFleetGetConfig(
  input: RpcInput<typeof fleetGetConfigRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof fleetGetConfigRpc>> {
  return getHostConfig(
    input.hostId,
    { name: input.name, target: input.target },
    paseo,
  );
}

export async function handleFleetUpsert(
  input: RpcInput<typeof fleetUpsertRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof fleetUpsertRpc>> {
  return upsertOnHost(
    input.hostId,
    {
      name: input.name,
      previousName: input.previousName,
      config: input.config,
      enabled: input.enabled,
      targets: input.targets,
      sourceTargetForClone: input.sourceTargetForClone,
    },
    paseo,
  );
}

export async function handleFleetRemove(
  input: RpcInput<typeof fleetRemoveRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof fleetRemoveRpc>> {
  return removeOnHost(
    input.hostId,
    { name: input.name, targets: input.targets },
    paseo,
  );
}

export async function handleFleetProbe(
  input: RpcInput<typeof fleetProbeRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof fleetProbeRpc>> {
  return probeOnHost(
    input.hostId,
    {
      name: input.name,
      target: input.target,
      configOverride: input.configOverride,
    },
    paseo,
  );
}

export async function handleFleetPreviewMigrate(
  input: RpcInput<typeof fleetPreviewMigrateRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof fleetPreviewMigrateRpc>> {
  const [fromInv, toInv] = await Promise.all([
    getHostInventory(input.fromHostId, paseo),
    input.fromHostId === input.toHostId
      ? Promise.resolve(null)
      : getHostInventory(input.toHostId, paseo),
  ]);
  const targetInv = toInv ?? fromInv;
  const crossOs = fromInv.platform !== targetInv.platform;

  const targetByName = new Map(targetInv.servers.map((s) => [s.name, s]));

  const items: MigrateItemPreview[] = await Promise.all(
    input.items.map(async (item) => {
      const full = await getHostConfig(
        input.fromHostId,
        { name: item.name, target: item.sourceTarget },
        paseo,
      );
      const sourceFp = fingerprintConfig(full.config);
      const targetExisting = targetByName.get(item.name);
      const relation: "new" | "same" | "diff" = !targetExisting
        ? "new"
        : targetExisting.fingerprint === sourceFp
          ? "same"
          : "diff";

      return {
        name: item.name,
        sourceTarget: full.target,
        sourceConfig: full.config,
        sourceFingerprint: sourceFp,
        relation,
        targetExistingTargets: targetExisting
          ? targetExisting.entries.map((e) => e.target)
          : [],
        targetFingerprint: targetExisting?.fingerprint,
        crossOsStdioWarning: crossOs && full.config.type === "stdio",
      };
    }),
  );

  return {
    fromHostId: fromInv.hostId,
    fromPlatform: fromInv.platform,
    toHostId: targetInv.hostId,
    toPlatform: targetInv.platform,
    crossOs,
    items,
  };
}

export async function handleFleetExecuteMigrate(
  input: RpcInput<typeof fleetExecuteMigrateRpc>,
  paseo: PaseoApi,
): Promise<RpcOutput<typeof fleetExecuteMigrateRpc>> {
  const targetInv = await getHostInventory(input.toHostId, paseo);
  const existingNames = new Set(targetInv.servers.map((s) => s.name));

  const results: RpcOutput<typeof fleetExecuteMigrateRpc>["results"] = [];

  for (const item of input.items) {
    let finalName = item.renameTo?.trim() || item.name;
    try {
      const existsOnTarget = existingNames.has(finalName);

      if (existsOnTarget && input.conflictMode === "skip") {
        results.push({
          name: item.name,
          finalName,
          status: "skipped",
          appliedTargets: [],
        });
        continue;
      }

      if (existsOnTarget && input.conflictMode === "rename") {
        let suffix = 2;
        while (existingNames.has(`${finalName}-${suffix}`)) {
          suffix += 1;
        }
        finalName = `${finalName}-${suffix}`;
      }

      const config =
        item.configOverride ??
        (
          await getHostConfig(
            input.fromHostId,
            { name: item.name, target: item.sourceTarget },
            paseo,
          )
        ).config;

      const res = await upsertOnHost(
        input.toHostId,
        {
          name: finalName,
          config,
          enabled: input.enabledAfterMigrate,
          targets: input.targetClients,
        },
        paseo,
      );

      existingNames.add(finalName);
      results.push({
        name: item.name,
        finalName,
        status: "migrated",
        appliedTargets: res.appliedTargets,
        ...(res.warnings.length > 0 ? { error: res.warnings.join("; ") } : {}),
      });
    } catch (error) {
      results.push({
        name: item.name,
        finalName,
        status: "error",
        appliedTargets: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { results };
}
