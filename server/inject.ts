import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { McpServerConfig } from "../shared/contracts";
import { readPaseoInjectStore } from "./adapters";

function toPaseoMcpEntry(config: McpServerConfig) {
  if (config.type === "http") {
    return {
      type: "http" as const,
      url: config.url,
      ...(config.headers ? { headers: config.headers } : {}),
      ...(config.alwaysLoad !== undefined ? { alwaysLoad: config.alwaysLoad } : {}),
    };
  }
  return {
    type: "stdio" as const,
    command: config.command,
    ...(config.args ? { args: config.args } : {}),
    ...(config.env ? { env: config.env } : {}),
    ...(config.alwaysLoad !== undefined ? { alwaysLoad: config.alwaysLoad } : {}),
  };
}

export function registerSessionInjection(server: PluginServerContext) {
  return server.before("agent.session_open", ({ request }) => {
    const store = readPaseoInjectStore();
    const enabledEntries = Object.entries(store.services).filter(([, item]) => item.enabled);
    if (enabledEntries.length === 0) return;

    const injected: Record<string, ReturnType<typeof toPaseoMcpEntry>> = {};
    for (const [name, item] of enabledEntries) {
      if (name === "paseo") continue;
      injected[name] = toPaseoMcpEntry(item.config);
    }
    if (Object.keys(injected).length === 0) return;

    return {
      ...request,
      mcpServers: {
        ...injected,
        ...request.mcpServers,
      },
    };
  });
}
