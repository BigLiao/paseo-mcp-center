import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { McpCenterScreen } from "./client/McpCenterScreen";

function McpCenterSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Cable"
      label="MCP Center"
      active={currentScreen?.screenId === "mcp-center"}
      onPress={() => openScreen({ screenId: "mcp-center" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({
    id: "mcp-center",
    title: "MCP Center",
    Component: McpCenterScreen,
  });
  client.addSidebarHeaderItem({
    id: "mcp-center",
    title: "MCP Center",
    Component: McpCenterSidebarItem,
  });
  client.addCommandCenterItem({
    id: "open-mcp-center",
    title: "打开 MCP Center",
    icon: "Cable",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "mcp-center" });
    },
  });
  return () => {};
}
