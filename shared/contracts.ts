import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PLUGIN_ID = "paseo-mcp-center";

export const CLIENT_TARGETS = [
  "claude",
  "claude-internal",
  "codex",
  "cursor",
  "antigravity",
  "agents",
  "paseo",
] as const;

export const ClientTargetSchema = z.enum(CLIENT_TARGETS);
export type ClientTarget = z.infer<typeof ClientTargetSchema>;

export const CLIENT_TARGET_META: Record<
  ClientTarget,
  { label: string; shortLabel: string; defaultPath: string; format: "json" | "toml" | "paseo" }
> = {
  claude: {
    label: "Claude Code",
    shortLabel: "Claude",
    defaultPath: "~/.claude.json",
    format: "json",
  },
  "claude-internal": {
    label: "Claude Internal",
    shortLabel: "Claude-Int",
    defaultPath: "~/.claude-internal/.claude.json",
    format: "json",
  },
  codex: {
    label: "Codex",
    shortLabel: "Codex",
    defaultPath: "~/.codex/config.toml",
    format: "toml",
  },
  cursor: {
    label: "Cursor",
    shortLabel: "Cursor",
    defaultPath: "~/.cursor/mcp.json",
    format: "json",
  },
  antigravity: {
    label: "Antigravity",
    shortLabel: "AGY",
    defaultPath: "~/.gemini/config/mcp_config.json",
    format: "json",
  },
  agents: {
    label: "Agents",
    shortLabel: "Agents",
    defaultPath: "~/.agents/mcp.json",
    format: "json",
  },
  paseo: {
    label: "Paseo 动态注入",
    shortLabel: "Paseo",
    defaultPath: "~/.paseo/plugin-data/paseo-mcp-center/paseo-inject.json",
    format: "paseo",
  },
};

export const McpHttpConfigSchema = z.object({
  type: z.literal("http"),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  timeout: z.number().int().positive().optional(),
  transportType: z.string().optional(),
  alwaysLoad: z.boolean().optional(),
});

export const McpStdioConfigSchema = z.object({
  type: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeout: z.number().int().positive().optional(),
  alwaysLoad: z.boolean().optional(),
});

export const McpServerConfigSchema = z.discriminatedUnion("type", [
  McpHttpConfigSchema,
  McpStdioConfigSchema,
]);
export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const TargetStatusSchema = z.object({
  target: ClientTargetSchema,
  path: z.string(),
  exists: z.boolean(),
  serverCount: z.number().int().nonnegative(),
  parseError: z.string().optional(),
});
export type TargetStatus = z.infer<typeof TargetStatusSchema>;

export const ServerTargetEntrySchema = z.object({
  target: ClientTargetSchema,
  enabled: z.boolean(),
  fingerprint: z.string(),
  maskedConfig: McpServerConfigSchema,
});
export type ServerTargetEntry = z.infer<typeof ServerTargetEntrySchema>;

export const AggregatedServerSchema = z.object({
  name: z.string(),
  type: z.enum(["http", "stdio"]),
  endpointPreview: z.string(),
  primaryTarget: ClientTargetSchema,
  fingerprint: z.string(),
  hasTargetDrift: z.boolean(),
  entries: z.array(ServerTargetEntrySchema),
});
export type AggregatedServer = z.infer<typeof AggregatedServerSchema>;

export const NodeInventorySchema = z.object({
  hostId: z.string(),
  label: z.string(),
  hostname: z.string(),
  platform: z.string(),
  arch: z.string(),
  collectedAt: z.string(),
  targets: z.array(TargetStatusSchema),
  servers: z.array(AggregatedServerSchema),
});
export type NodeInventory = z.infer<typeof NodeInventorySchema>;

export const FleetNodeSchema = z.object({
  hostId: z.string(),
  label: z.string(),
  isSelf: z.boolean(),
  status: z.enum(["online", "offline", "plugin_missing", "error"]),
  targetDescription: z.string().optional(),
  error: z.string().optional(),
  inventory: NodeInventorySchema.optional(),
});
export type FleetNode = z.infer<typeof FleetNodeSchema>;

export const FleetOverviewSchema = z.object({
  selfHostId: z.string(),
  nodes: z.array(FleetNodeSchema),
});
export type FleetOverview = z.infer<typeof FleetOverviewSchema>;

export const ProbeToolSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
});

export const ProbeResultSchema = z.object({
  ok: z.boolean(),
  latencyMs: z.number().nonnegative(),
  transport: z.enum(["http", "stdio"]),
  serverInfo: z
    .object({
      name: z.string().optional(),
      version: z.string().optional(),
    })
    .optional(),
  tools: z.array(ProbeToolSchema),
  error: z.string().optional(),
});
export type ProbeResult = z.infer<typeof ProbeResultSchema>;

export const ConflictModeSchema = z.enum(["overwrite", "skip", "rename"]);
export type ConflictMode = z.infer<typeof ConflictModeSchema>;

export const MigrateItemPreviewSchema = z.object({
  name: z.string(),
  sourceTarget: ClientTargetSchema,
  sourceConfig: McpServerConfigSchema,
  sourceFingerprint: z.string(),
  relation: z.enum(["new", "same", "diff"]),
  targetExistingTargets: z.array(ClientTargetSchema),
  targetFingerprint: z.string().optional(),
  crossOsStdioWarning: z.boolean(),
});
export type MigrateItemPreview = z.infer<typeof MigrateItemPreviewSchema>;

export const MigratePreviewOutputSchema = z.object({
  fromHostId: z.string(),
  fromPlatform: z.string(),
  toHostId: z.string(),
  toPlatform: z.string(),
  crossOs: z.boolean(),
  items: z.array(MigrateItemPreviewSchema),
});
export type MigratePreviewOutput = z.infer<typeof MigratePreviewOutputSchema>;

export const MigrateItemExecutionResultSchema = z.object({
  name: z.string(),
  finalName: z.string(),
  status: z.enum(["migrated", "skipped", "error"]),
  appliedTargets: z.array(ClientTargetSchema),
  error: z.string().optional(),
});

export const MigrateExecuteOutputSchema = z.object({
  results: z.array(MigrateItemExecutionResultSchema),
});
export type MigrateExecuteOutput = z.infer<typeof MigrateExecuteOutputSchema>;

// ============================================================================
// Node-level RPCs (also invoked cross-host via Paseo Relay)
// ============================================================================

export const nodeInventoryRpc = defineRpc({
  name: "node.inventory",
  input: z.object({}),
  output: NodeInventorySchema,
});

export const nodeGetConfigRpc = defineRpc({
  name: "node.get_config",
  input: z.object({
    name: z.string().min(1),
    target: ClientTargetSchema.optional(),
  }),
  output: z.object({
    name: z.string(),
    target: ClientTargetSchema,
    enabled: z.boolean(),
    config: McpServerConfigSchema,
  }),
});

export const nodeUpsertRpc = defineRpc({
  name: "node.upsert",
  input: z.object({
    name: z.string().min(1),
    previousName: z.string().min(1).optional(),
    config: McpServerConfigSchema.optional(),
    enabled: z.boolean(),
    targets: z.array(ClientTargetSchema).min(1),
    sourceTargetForClone: ClientTargetSchema.optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    name: z.string(),
    appliedTargets: z.array(ClientTargetSchema),
    warnings: z.array(z.string()),
  }),
});

export const nodeRemoveRpc = defineRpc({
  name: "node.remove",
  input: z.object({
    name: z.string().min(1),
    targets: z.array(ClientTargetSchema).min(1),
  }),
  output: z.object({
    ok: z.boolean(),
    removedTargets: z.array(ClientTargetSchema),
  }),
});

export const nodeProbeRpc = defineRpc({
  name: "node.probe",
  input: z.object({
    name: z.string().min(1),
    target: ClientTargetSchema.optional(),
    configOverride: McpServerConfigSchema.optional(),
  }),
  output: ProbeResultSchema,
});

// ============================================================================
// Fleet-level RPCs (called by UI; routes to self or remote host via Relay)
// ============================================================================

export const fleetOverviewRpc = defineRpc({
  name: "fleet.overview",
  input: z.object({}),
  output: FleetOverviewSchema,
});

export const fleetGetConfigRpc = defineRpc({
  name: "fleet.get_config",
  input: z.object({
    hostId: z.string().min(1),
    name: z.string().min(1),
    target: ClientTargetSchema.optional(),
  }),
  output: z.object({
    name: z.string(),
    target: ClientTargetSchema,
    enabled: z.boolean(),
    config: McpServerConfigSchema,
  }),
});

export const fleetUpsertRpc = defineRpc({
  name: "fleet.upsert",
  input: z.object({
    hostId: z.string().min(1),
    name: z.string().min(1),
    previousName: z.string().min(1).optional(),
    config: McpServerConfigSchema.optional(),
    enabled: z.boolean(),
    targets: z.array(ClientTargetSchema).min(1),
    sourceTargetForClone: ClientTargetSchema.optional(),
  }),
  output: z.object({
    ok: z.boolean(),
    name: z.string(),
    appliedTargets: z.array(ClientTargetSchema),
    warnings: z.array(z.string()),
  }),
});

export const fleetRemoveRpc = defineRpc({
  name: "fleet.remove",
  input: z.object({
    hostId: z.string().min(1),
    name: z.string().min(1),
    targets: z.array(ClientTargetSchema).min(1),
  }),
  output: z.object({
    ok: z.boolean(),
    removedTargets: z.array(ClientTargetSchema),
  }),
});

export const fleetProbeRpc = defineRpc({
  name: "fleet.probe",
  input: z.object({
    hostId: z.string().min(1),
    name: z.string().min(1),
    target: ClientTargetSchema.optional(),
    configOverride: McpServerConfigSchema.optional(),
  }),
  output: ProbeResultSchema,
});

export const fleetPreviewMigrateRpc = defineRpc({
  name: "fleet.preview_migrate",
  input: z.object({
    fromHostId: z.string().min(1),
    toHostId: z.string().min(1),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          sourceTarget: ClientTargetSchema.optional(),
        }),
      )
      .min(1),
  }),
  output: MigratePreviewOutputSchema,
});

export const fleetExecuteMigrateRpc = defineRpc({
  name: "fleet.execute_migrate",
  input: z.object({
    fromHostId: z.string().min(1),
    toHostId: z.string().min(1),
    targetClients: z.array(ClientTargetSchema).min(1),
    conflictMode: ConflictModeSchema,
    enabledAfterMigrate: z.boolean(),
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          sourceTarget: ClientTargetSchema.optional(),
          configOverride: McpServerConfigSchema.optional(),
          renameTo: z.string().min(1).optional(),
        }),
      )
      .min(1),
  }),
  output: MigrateExecuteOutputSchema,
});
