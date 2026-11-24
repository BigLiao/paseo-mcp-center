import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  fleetExecuteMigrateRpc,
  fleetGetConfigRpc,
  fleetOverviewRpc,
  fleetPreviewMigrateRpc,
  fleetProbeRpc,
  fleetRemoveRpc,
  fleetUpsertRpc,
  nodeGetConfigRpc,
  nodeInventoryRpc,
  nodeProbeRpc,
  nodeRemoveRpc,
  nodeUpsertRpc,
} from "./shared/contracts";
import {
  handleFleetExecuteMigrate,
  handleFleetGetConfig,
  handleFleetOverview,
  handleFleetPreviewMigrate,
  handleFleetProbe,
  handleFleetRemove,
  handleFleetUpsert,
} from "./server/fleet-handlers";
import { registerSessionInjection } from "./server/inject";
import {
  handleNodeGetConfig,
  handleNodeInventory,
  handleNodeProbe,
  handleNodeRemove,
  handleNodeUpsert,
} from "./server/node-handlers";
import { disposeAllRelayClients } from "./server/relay";

export default function contribute(server: PluginServerContext) {
  // Node-level RPCs (used locally and invoked remotely over Paseo Relay)
  server.handle(nodeInventoryRpc, (input, { paseo }) => handleNodeInventory(input, paseo));
  server.handle(nodeGetConfigRpc, (input) => handleNodeGetConfig(input));
  server.handle(nodeUpsertRpc, (input) => handleNodeUpsert(input));
  server.handle(nodeRemoveRpc, (input) => handleNodeRemove(input));
  server.handle(nodeProbeRpc, (input) => handleNodeProbe(input));

  // Fleet-level RPCs (UI entrypoints with automatic Relay routing)
  server.handle(fleetOverviewRpc, (input, { paseo }) => handleFleetOverview(input, paseo));
  server.handle(fleetGetConfigRpc, (input, { paseo }) => handleFleetGetConfig(input, paseo));
  server.handle(fleetUpsertRpc, (input, { paseo }) => handleFleetUpsert(input, paseo));
  server.handle(fleetRemoveRpc, (input, { paseo }) => handleFleetRemove(input, paseo));
  server.handle(fleetProbeRpc, (input, { paseo }) => handleFleetProbe(input, paseo));
  server.handle(fleetPreviewMigrateRpc, (input, { paseo }) =>
    handleFleetPreviewMigrate(input, paseo),
  );
  server.handle(fleetExecuteMigrateRpc, (input, { paseo }) =>
    handleFleetExecuteMigrate(input, paseo),
  );

  // Paseo runtime dynamic MCP injection
  const removeHook = registerSessionInjection(server);

  return async () => {
    removeHook();
    await disposeAllRelayClients();
  };
}
