import type { McpServerConfig, NodeInventory } from "./contracts";

const APP_INTERNAL_PATH_PATTERNS = [
  /\.app\/Contents\/(?:SharedSupport|Resources|MacOS|Frameworks|Helpers|PlugIns)\//i,
  /^\.\/[^/]+\.app\//i,
  /\/Contents\/Resources\/app\.asar\.unpacked\//i,
  /[/\\]resources[/\\]app\.asar\.unpacked[/\\]/i,
];

/**
 * Returns true when a stdio MCP points into a desktop application's internal bundle
 * (e.g. macOS `.app/Contents/SharedSupport/...`, `.app/Contents/Resources/...`,
 * or Electron `resources/app.asar.unpacked/...`).
 * These entries are managed by their host app and should be left untouched.
 */
export function isInternalStdioConfig(config: McpServerConfig): boolean {
  if (config.type !== "stdio") return false;
  const cmd = config.command.trim();
  if (APP_INTERNAL_PATH_PATTERNS.some((re) => re.test(cmd))) {
    return true;
  }
  if (config.args?.some((arg) => APP_INTERNAL_PATH_PATTERNS.some((re) => re.test(arg)))) {
    return true;
  }
  return false;
}

/**
 * Filters out app-internal stdio entries from a NodeInventory (including inventories
 * returned by older remote peers over Relay) and recalculates per-target counts.
 */
export function filterInternalFromInventory(inventory: NodeInventory): NodeInventory {
  const servers = inventory.servers
    .map((srv) => {
      const entries = srv.entries.filter((e) => !isInternalStdioConfig(e.maskedConfig));
      if (entries.length === 0) return null;
      const primary = entries.find((e) => e.enabled) ?? entries[0];
      const uniqueFps = new Set(entries.map((e) => e.fingerprint));
      return {
        ...srv,
        type: primary.maskedConfig.type,
        primaryTarget: primary.target,
        fingerprint: primary.fingerprint,
        hasTargetDrift: uniqueFps.size > 1,
        entries,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const countByTarget = new Map<string, number>();
  for (const srv of servers) {
    for (const entry of srv.entries) {
      countByTarget.set(entry.target, (countByTarget.get(entry.target) ?? 0) + 1);
    }
  }

  const targets = inventory.targets.map((t) => ({
    ...t,
    serverCount: countByTarget.get(t.target) ?? 0,
  }));

  return {
    ...inventory,
    targets,
    servers,
  };
}
