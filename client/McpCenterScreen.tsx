import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
  CLIENT_TARGETS,
  CLIENT_TARGET_META,
  fleetGetConfigRpc,
  fleetOverviewRpc,
  fleetProbeRpc,
  fleetRemoveRpc,
  fleetUpsertRpc,
  type AggregatedServer,
  type ClientTarget,
  type FleetNode,
  type McpServerConfig,
  type ProbeResult,
} from "../shared/contracts";
import { DriftModal } from "./DriftModal";
import { EditorModal } from "./EditorModal";
import { MigrateModal } from "./MigrateModal";

type ViewMode = "manage" | "compare";

export function McpCenterScreen({ theme, layout }: PluginScreenProps) {
  const toast = useToast();
  const queryClient = useQueryClient();

  const fetchOverview = useRpc(fleetOverviewRpc);
  const fetchConfig = useRpc(fleetGetConfigRpc);
  const upsertServer = useRpc(fleetUpsertRpc);
  const removeServer = useRpc(fleetRemoveRpc);
  const probeServer = useRpc(fleetProbeRpc);

  const overviewQuery = useQuery({
    queryKey: ["mcp-center", "fleet-overview"],
    queryFn: () => fetchOverview({}),
    staleTime: 15_000,
  });

  const nodes = overviewQuery.data?.nodes ?? [];
  const selfHostId = overviewQuery.data?.selfHostId ?? "";

  const [viewMode, setViewMode] = useState<ViewMode>("manage");
  const [selectedHostId, setSelectedHostId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [targetFilter, setTargetFilter] = useState<ClientTarget | "all">("all");
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);

  // Probe results keyed by `${hostId}::${serverName}`
  const [probeResults, setProbeResults] = useState<Record<string, ProbeResult>>({});
  const [probingKey, setProbingKey] = useState<string | null>(null);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  // Compare mode state
  const [compareFromHostId, setCompareFromHostId] = useState<string>("");
  const [compareToHostId, setCompareToHostId] = useState<string>("");
  const [selectedForMigrate, setSelectedForMigrate] = useState<string[]>([]);
  const [showIdentical, setShowIdentical] = useState(false);

  // Editor modal state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [editorState, setEditorState] = useState<{
    hostId: string;
    hostLabel: string;
    name?: string;
    config?: McpServerConfig;
    enabled?: boolean;
    targets?: ClientTarget[];
  }>({ hostId: "", hostLabel: "" });

  // Migrate modal state
  const [migrateOpen, setMigrateOpen] = useState(false);
  const [migrateRequest, setMigrateRequest] = useState<{
    fromHostId: string;
    toHostId: string;
    items: { name: string; sourceTarget?: ClientTarget }[];
  }>({ fromHostId: "", toHostId: "", items: [] });

  // Drift compare & align modal state
  const [driftOpen, setDriftOpen] = useState(false);
  const [driftTarget, setDriftTarget] = useState<{
    hostId: string;
    hostLabel: string;
    serverName: string;
  } | null>(null);

  useEffect(() => {
    if (!nodes.length) return;
    if (!selectedHostId || !nodes.some((n) => n.hostId === selectedHostId)) {
      setSelectedHostId(selfHostId || nodes[0].hostId);
    }
    if (!compareFromHostId || !nodes.some((n) => n.hostId === compareFromHostId)) {
      setCompareFromHostId(selfHostId || nodes[0].hostId);
    }
    if (!compareToHostId || !nodes.some((n) => n.hostId === compareToHostId)) {
      const other = nodes.find((n) => n.hostId !== (selfHostId || nodes[0].hostId));
      setCompareToHostId(other?.hostId ?? selfHostId ?? nodes[0].hostId);
    }
  }, [nodes, selfHostId, selectedHostId, compareFromHostId, compareToHostId]);

  const invalidateOverview = () =>
    queryClient.invalidateQueries({ queryKey: ["mcp-center", "fleet-overview"] });

  const upsertMutation = useMutation({
    mutationFn: upsertServer,
    onSuccess: () => void invalidateOverview(),
  });

  const removeMutation = useMutation({
    mutationFn: removeServer,
    onSuccess: () => void invalidateOverview(),
  });

  const selectedNode: FleetNode | undefined =
    nodes.find((n) => n.hostId === selectedHostId) ?? nodes[0];

  const filteredServers = useMemo(() => {
    const list = selectedNode?.inventory?.servers ?? [];
    const q = searchQuery.trim().toLowerCase();
    return list.filter((srv) => {
      if (targetFilter !== "all" && !srv.entries.some((e) => e.target === targetFilter)) {
        return false;
      }
      if (!q) return true;
      return (
        srv.name.toLowerCase().includes(q) ||
        srv.endpointPreview.toLowerCase().includes(q) ||
        srv.type.includes(q)
      );
    });
  }, [selectedNode, searchQuery, targetFilter]);

  const compareFromNode = nodes.find((n) => n.hostId === compareFromHostId);
  const compareToNode = nodes.find((n) => n.hostId === compareToHostId);

  const diffGroups = useMemo(() => {
    const fromServers = compareFromNode?.inventory?.servers ?? [];
    const toMap = new Map(
      (compareToNode?.inventory?.servers ?? []).map((s) => [s.name, s]),
    );
    const onlySource: AggregatedServer[] = [];
    const different: { source: AggregatedServer; target: AggregatedServer }[] = [];
    const identical: AggregatedServer[] = [];

    for (const srv of fromServers) {
      const match = toMap.get(srv.name);
      if (!match) {
        onlySource.push(srv);
      } else if (match.fingerprint !== srv.fingerprint) {
        different.push({ source: srv, target: match });
      } else {
        identical.push(srv);
      }
    }
    return { onlySource, different, identical };
  }, [compareFromNode, compareToNode]);

  const styles = useMemo(
    () => ({
      screen: {
        flex: 1,
        backgroundColor: theme.colors.surface0,
      },
      container: {
        padding: layout.compact ? 14 : 22,
        gap: 14,
      },
      headerRow: {
        flexDirection: layout.compact ? ("column" as const) : ("row" as const),
        justifyContent: "space-between" as const,
        alignItems: layout.compact ? ("stretch" as const) : ("center" as const),
        gap: 10,
      },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 22, fontWeight: "700" as const },
      subtitle: { color: theme.colors.foregroundMuted, fontSize: 12 },
      row: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
        alignItems: "center" as const,
      },
      card: {
        backgroundColor: theme.colors.surface1,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 12,
        padding: layout.compact ? 12 : 14,
        gap: 10,
      },
      chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
      },
      smallBtn: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
      },
      accentBtn: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: theme.colors.accent,
      },
      searchInput: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 9,
        fontSize: 13,
      },
      badge: {
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
    }),
    [theme, layout.compact],
  );

  async function handleToggleClient(
    hostId: string,
    server: AggregatedServer,
    target: ClientTarget,
  ) {
    const key = `${hostId}::${server.name}::${target}`;
    setTogglingKey(key);
    try {
      const existing = server.entries.find((e) => e.target === target);
      const nextEnabled = existing ? !existing.enabled : true;
      await upsertMutation.mutateAsync({
        hostId,
        name: server.name,
        enabled: nextEnabled,
        targets: [target],
        sourceTargetForClone: existing ? target : server.primaryTarget,
      });
      toast.show(
        `${server.name} · ${CLIENT_TARGET_META[target].shortLabel} 已${
          nextEnabled ? "启用" : "停用"
        }`,
        { variant: "success" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTogglingKey(null);
    }
  }

  async function handleToggleAllClients(hostId: string, server: AggregatedServer) {
    const key = `${hostId}::${server.name}::__all__`;
    setTogglingKey(key);
    try {
      const allEnabled = CLIENT_TARGETS.every(
        (target) => server.entries.find((e) => e.target === target)?.enabled === true,
      );
      const nextEnabled = !allEnabled;
      await upsertMutation.mutateAsync({
        hostId,
        name: server.name,
        enabled: nextEnabled,
        targets: [...CLIENT_TARGETS],
        sourceTargetForClone: server.primaryTarget,
      });
      toast.show(
        `${server.name} · 全部客户端已${nextEnabled ? "启用" : "停用"}`,
        { variant: "success" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setTogglingKey(null);
    }
  }

  async function handleOpenEdit(host: FleetNode, server: AggregatedServer) {
    try {
      const full = await fetchConfig({
        hostId: host.hostId,
        name: server.name,
        target: server.primaryTarget,
      });
      setEditorMode("edit");
      setEditorState({
        hostId: host.hostId,
        hostLabel: host.label,
        name: full.name,
        config: full.config,
        enabled: full.enabled,
        targets: server.entries.map((e) => e.target),
      });
      setEditorOpen(true);
    } catch (error) {
      toast.error(`读取配置失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function handleOpenCreate(host: FleetNode) {
    setEditorMode("create");
    setEditorState({
      hostId: host.hostId,
      hostLabel: host.label,
      targets: ["claude", "codex"],
      enabled: true,
    });
    setEditorOpen(true);
  }

  async function handleProbe(hostId: string, server: AggregatedServer) {
    const key = `${hostId}::${server.name}`;
    setProbingKey(key);
    try {
      const res = await probeServer({
        hostId,
        name: server.name,
        target: server.primaryTarget,
      });
      setProbeResults((prev) => ({ ...prev, [key]: res }));
      toast.show(
        res.ok
          ? `${server.name} 连通正常 (${res.latencyMs}ms, ${res.tools.length} 工具)`
          : `${server.name} 探测失败：${res.error ?? "未知错误"}`,
        { variant: res.ok ? "success" : "error" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setProbingKey(null);
    }
  }

  async function handleDelete(hostId: string, server: AggregatedServer) {
    const key = `${hostId}::${server.name}`;
    if (confirmDeleteKey !== key) {
      setConfirmDeleteKey(key);
      return;
    }
    setConfirmDeleteKey(null);
    try {
      await removeMutation.mutateAsync({
        hostId,
        name: server.name,
        targets: server.entries.map((e) => e.target),
      });
      toast.show(`已从所有客户端移除 ${server.name}`, { variant: "success" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  }

  function openSingleMigrate(hostId: string, server: AggregatedServer) {
    const defaultTarget =
      nodes.find((n) => n.hostId !== hostId && n.status === "online")?.hostId ?? hostId;
    setMigrateRequest({
      fromHostId: hostId,
      toHostId: defaultTarget,
      items: [{ name: server.name, sourceTarget: server.primaryTarget }],
    });
    setMigrateOpen(true);
  }

  function toggleSelectMigrate(name: string) {
    setSelectedForMigrate((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  }

  function openBatchMigrate() {
    if (!compareFromNode || !compareToNode || selectedForMigrate.length === 0) return;
    const fromServers = compareFromNode.inventory?.servers ?? [];
    const items = selectedForMigrate.map((name) => ({
      name,
      sourceTarget: fromServers.find((s) => s.name === name)?.primaryTarget,
    }));
    setMigrateRequest({
      fromHostId: compareFromNode.hostId,
      toHostId: compareToNode.hostId,
      items,
    });
    setMigrateOpen(true);
  }

  function statusDotColor(status: FleetNode["status"]): string {
    if (status === "online") return theme.colors.statusSuccess;
    if (status === "plugin_missing") return theme.colors.statusWarning;
    return theme.colors.statusDanger;
  }

  function statusLabel(status: FleetNode["status"]): string {
    switch (status) {
      case "online":
        return "在线";
      case "plugin_missing":
        return "未装插件";
      case "offline":
        return "离线";
      default:
        return "异常";
    }
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ gap: 2 }}>
            <Text style={styles.title}>MCP Center</Text>
            <Text style={styles.subtitle}>
              多机集中管理 · 经 Paseo Relay 手动迁移 · 各机独立开关
            </Text>
          </View>
          <View style={styles.row}>
            <Pressable
              onPress={() => void overviewQuery.refetch()}
              style={styles.smallBtn}
            >
              <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                {overviewQuery.isFetching ? "刷新中..." : "刷新"}
              </Text>
            </Pressable>
            {selectedNode?.status === "online" ? (
              <Pressable
                onPress={() => handleOpenCreate(selectedNode)}
                style={styles.accentBtn}
              >
                <Text
                  style={{
                    color: theme.colors.accentForeground,
                    fontSize: 12,
                    fontWeight: "600",
                  }}
                >
                  + 新增 MCP
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Mode Tabs */}
        <View style={styles.row}>
          {(
            [
              { id: "manage", label: "单机管理" },
              { id: "compare", label: "跨机对比与迁移" },
            ] as const
          ).map((tab) => {
            const active = viewMode === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => setViewMode(tab.id)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? theme.colors.accent : theme.colors.surface1,
                    borderColor: active ? theme.colors.accent : theme.colors.border,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? theme.colors.accentForeground : theme.colors.foreground,
                    fontSize: 13,
                    fontWeight: "600",
                  }}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {overviewQuery.isLoading ? (
          <View style={{ padding: 32, alignItems: "center", gap: 10 }}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
              正在扫描本机与 Relay 配对主机...
            </Text>
          </View>
        ) : overviewQuery.error ? (
          <View style={styles.card}>
            <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>
              加载失败：
              {overviewQuery.error instanceof Error
                ? overviewQuery.error.message
                : String(overviewQuery.error)}
            </Text>
          </View>
        ) : null}

        {/* ============================================================ */}
        {/* VIEW 1: SINGLE HOST MANAGEMENT                               */}
        {/* ============================================================ */}
        {viewMode === "manage" && nodes.length > 0 ? (
          <>
            {/* Host Switcher */}
            <View style={styles.row}>
              {nodes.map((node) => {
                const active = node.hostId === selectedNode?.hostId;
                return (
                  <Pressable
                    key={node.hostId}
                    onPress={() => setSelectedHostId(node.hostId)}
                    style={[
                      styles.chip,
                      {
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                        backgroundColor: active ? theme.colors.surface2 : theme.colors.surface1,
                        borderColor: active ? theme.colors.accent : theme.colors.border,
                      },
                    ]}
                  >
                    <View
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 4,
                        backgroundColor: statusDotColor(node.status),
                      }}
                    />
                    <Text
                      style={{
                        color: theme.colors.foreground,
                        fontSize: 12,
                        fontWeight: active ? "700" : "500",
                      }}
                    >
                      {node.label}
                      {node.isSelf ? " (本机)" : ""}
                    </Text>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                      {node.inventory
                        ? `${node.inventory.platform} · ${node.inventory.servers.length}`
                        : statusLabel(node.status)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {selectedNode && selectedNode.status !== "online" ? (
              <View style={styles.card}>
                <Text
                  style={{
                    color: statusDotColor(selectedNode.status),
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                >
                  {selectedNode.label} · {statusLabel(selectedNode.status)}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  {selectedNode.error ?? "无法连接该主机"}
                </Text>
                {selectedNode.status === "plugin_missing" ? (
                  <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                    提示：请在目标主机上安装并启用同名插件 `paseo-mcp-center`，安装后点击右上角刷新即可通过 Relay 纳管。
                  </Text>
                ) : null}
              </View>
            ) : null}

            {selectedNode?.inventory ? (
              <>
                {/* Target Status Strip + Filter */}
                <View style={styles.card}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
                    客户端配置筛选（点击按客户端过滤）
                  </Text>
                  <View style={styles.row}>
                    <Pressable
                      onPress={() => setTargetFilter("all")}
                      style={[
                        styles.chip,
                        {
                          backgroundColor:
                            targetFilter === "all" ? theme.colors.accent : theme.colors.surface0,
                          borderColor:
                            targetFilter === "all" ? theme.colors.accent : theme.colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color:
                            targetFilter === "all"
                              ? theme.colors.accentForeground
                              : theme.colors.foreground,
                          fontSize: 11,
                        }}
                      >
                        全部 ({selectedNode.inventory.servers.length})
                      </Text>
                    </Pressable>
                    {selectedNode.inventory.targets.map((t) => {
                      const active = targetFilter === t.target;
                      return (
                        <Pressable
                          key={t.target}
                          onPress={() => setTargetFilter(active ? "all" : t.target)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: active
                                ? theme.colors.accent
                                : theme.colors.surface0,
                              borderColor: t.parseError
                                ? theme.colors.statusDanger
                                : active
                                  ? theme.colors.accent
                                  : theme.colors.border,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color: active
                                ? theme.colors.accentForeground
                                : t.parseError
                                  ? theme.colors.statusDanger
                                  : theme.colors.foreground,
                              fontSize: 11,
                            }}
                          >
                            {CLIENT_TARGET_META[t.target].shortLabel} ({t.serverCount})
                            {t.parseError ? " ⚠" : ""}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {selectedNode.inventory.targets
                    .filter((t) => t.parseError)
                    .map((t) => (
                      <Text
                        key={`err-${t.target}`}
                        style={{ color: theme.colors.statusDanger, fontSize: 11 }}
                      >
                        ⚠ {CLIENT_TARGET_META[t.target].label} ({t.path}) 解析失败：{t.parseError}
                      </Text>
                    ))}
                </View>

                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="搜索 MCP 名称、URL 或命令..."
                  placeholderTextColor={theme.colors.foregroundMuted}
                  style={styles.searchInput}
                  autoCapitalize="none"
                />

                {filteredServers.length === 0 ? (
                  <View style={styles.card}>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
                      当前筛选条件下没有 MCP 配置。
                    </Text>
                  </View>
                ) : (
                  filteredServers.map((server) => {
                    const probeKey = `${selectedNode.hostId}::${server.name}`;
                    const probeRes = probeResults[probeKey];
                    const isProbing = probingKey === probeKey;
                    const isConfirmDelete = confirmDeleteKey === probeKey;

                    return (
                      <View key={server.name} style={styles.card}>
                        {/* Title + Type + Endpoint */}
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <View style={{ flex: 1, gap: 3 }}>
                            <View style={styles.row}>
                              <Text
                                style={{
                                  color: theme.colors.foreground,
                                  fontSize: 15,
                                  fontWeight: "700",
                                }}
                              >
                                {server.name}
                              </Text>
                              <View style={styles.badge}>
                                <Text
                                  style={{
                                    color: theme.colors.foregroundMuted,
                                    fontSize: 10,
                                    fontWeight: "600",
                                  }}
                                >
                                  {server.type.toUpperCase()}
                                </Text>
                              </View>
                              {server.hasTargetDrift ? (
                                <Pressable
                                  onPress={() => {
                                    setDriftTarget({
                                      hostId: selectedNode.hostId,
                                      hostLabel: selectedNode.label,
                                      serverName: server.name,
                                    });
                                    setDriftOpen(true);
                                  }}
                                  style={[
                                    styles.badge,
                                    {
                                      borderWidth: 1,
                                      borderColor: theme.colors.statusWarning,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={{
                                      color: theme.colors.statusWarning,
                                      fontSize: 10,
                                      fontWeight: "600",
                                    }}
                                  >
                                    ⚠ 各客户端参数有差异 · 对比对齐
                                  </Text>
                                </Pressable>
                              ) : null}
                            </View>
                            <Text
                              style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
                              numberOfLines={1}
                            >
                              {server.endpointPreview}
                            </Text>
                          </View>
                        </View>

                        {/* Client Target Toggle Matrix */}
                        <View style={{ gap: 6 }}>
                          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                            客户端开关：● 已启用 · ◐ 已关闭(灰色实线) · ○ 未安装(灰色虚线)
                          </Text>
                          <View style={styles.row}>
                            {(() => {
                              const enabledCount = CLIENT_TARGETS.filter(
                                (t) => server.entries.find((e) => e.target === t)?.enabled === true,
                              ).length;
                              const allEnabled = enabledCount === CLIENT_TARGETS.length;
                              const someEnabled = enabledCount > 0 && !allEnabled;
                              const busyAll =
                                togglingKey === `${selectedNode.hostId}::${server.name}::__all__`;
                              const allTip = allEnabled
                                ? `全部客户端已启用 (${enabledCount}/${CLIENT_TARGETS.length}) · 点击一键全部关闭`
                                : someEnabled
                                  ? `部分客户端已启用 (${enabledCount}/${CLIENT_TARGETS.length}) · 点击一键全部启用`
                                  : `全部客户端未启用 (0/${CLIENT_TARGETS.length}) · 点击一键全部启用`;
                              return (
                                <Pressable
                                  disabled={busyAll}
                                  accessibilityRole="button"
                                  accessibilityLabel={allTip}
                                  onPress={() =>
                                    void handleToggleAllClients(selectedNode.hostId, server)
                                  }
                                  style={[
                                    styles.chip,
                                    {
                                      paddingHorizontal: 9,
                                      paddingVertical: 5,
                                      opacity: busyAll ? 0.5 : 1,
                                      borderStyle: "solid",
                                      backgroundColor: allEnabled
                                        ? theme.colors.accent
                                        : someEnabled
                                          ? theme.colors.surface2
                                          : theme.colors.surface0,
                                      borderColor: allEnabled
                                        ? theme.colors.accent
                                        : someEnabled
                                          ? theme.colors.foregroundMuted
                                          : theme.colors.border,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      fontWeight: "600",
                                      color: allEnabled
                                        ? theme.colors.accentForeground
                                        : theme.colors.foreground,
                                    }}
                                  >
                                    {allEnabled ? "● " : someEnabled ? "◐ " : "○ "}
                                    全部 ({enabledCount}/{CLIENT_TARGETS.length})
                                  </Text>
                                </Pressable>
                              );
                            })()}
                            {CLIENT_TARGETS.map((target) => {
                              const entry = server.entries.find((e) => e.target === target);
                              const busy =
                                togglingKey === `${selectedNode.hostId}::${server.name}::${target}` ||
                                togglingKey === `${selectedNode.hostId}::${server.name}::__all__`;
                              const isEnabled = entry?.enabled === true;
                              const isDisabled = entry?.enabled === false;
                              const meta = CLIENT_TARGET_META[target];
                              const tipText = isEnabled
                                ? `${meta.label} (${meta.defaultPath}) · 已启用 · 点击关闭并保留配置`
                                : isDisabled
                                  ? `${meta.label} (${meta.defaultPath}) · 已关闭（已保留配置）· 点击重新启用`
                                  : `${meta.label} (${meta.defaultPath}) · 未安装/已卸载 · 点击克隆配置并启用`;
                              return (
                                <Pressable
                                  key={target}
                                  disabled={busy}
                                  accessibilityRole="button"
                                  accessibilityLabel={tipText}
                                  onPress={() =>
                                    void handleToggleClient(selectedNode.hostId, server, target)
                                  }
                                  style={[
                                    styles.chip,
                                    {
                                      paddingHorizontal: 8,
                                      paddingVertical: 5,
                                      opacity: busy ? 0.5 : !entry ? 0.78 : 1,
                                      borderStyle: !entry ? "dashed" : "solid",
                                      backgroundColor: isEnabled
                                        ? theme.colors.surface2
                                        : isDisabled
                                          ? theme.colors.surface2
                                          : theme.colors.surface0,
                                      borderColor: isEnabled
                                        ? theme.colors.statusSuccess
                                        : isDisabled
                                          ? theme.colors.foregroundMuted
                                          : theme.colors.border,
                                    },
                                  ]}
                                >
                                  <Text
                                    style={{
                                      fontSize: 11,
                                      fontWeight: isEnabled ? "600" : isDisabled ? "500" : "400",
                                      color: isEnabled
                                        ? theme.colors.statusSuccess
                                        : theme.colors.foregroundMuted,
                                    }}
                                  >
                                    {isEnabled ? "● " : isDisabled ? "◐ " : "○ "}
                                    {meta.shortLabel}
                                  </Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>

                        {/* Actions */}
                        <View style={styles.row}>
                          <Pressable
                            disabled={isProbing}
                            onPress={() => void handleProbe(selectedNode.hostId, server)}
                            style={styles.smallBtn}
                          >
                            <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                              {isProbing ? "探测中..." : "测活"}
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => void handleOpenEdit(selectedNode, server)}
                            style={styles.smallBtn}
                          >
                            <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                              编辑
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => openSingleMigrate(selectedNode.hostId, server)}
                            style={[
                              styles.smallBtn,
                              { borderColor: theme.colors.accent },
                            ]}
                          >
                            <Text
                              style={{
                                color: theme.colors.accent,
                                fontSize: 12,
                                fontWeight: "600",
                              }}
                            >
                              迁移 / 复制
                            </Text>
                          </Pressable>
                          <Pressable
                            onPress={() => void handleDelete(selectedNode.hostId, server)}
                            style={[
                              styles.smallBtn,
                              {
                                borderColor: isConfirmDelete
                                  ? theme.colors.statusDanger
                                  : theme.colors.border,
                              },
                            ]}
                          >
                            <Text
                              style={{
                                color: isConfirmDelete
                                  ? theme.colors.statusDanger
                                  : theme.colors.foregroundMuted,
                                fontSize: 12,
                              }}
                            >
                              {isConfirmDelete ? "再次点击确认删除" : "删除"}
                            </Text>
                          </Pressable>
                        </View>

                        {/* Inline Probe Result */}
                        {probeRes ? (
                          <View
                            style={{
                              padding: 10,
                              borderRadius: 8,
                              backgroundColor: theme.colors.surface0,
                              borderWidth: 1,
                              borderColor: probeRes.ok
                                ? theme.colors.statusSuccess
                                : theme.colors.statusDanger,
                              gap: 4,
                            }}
                          >
                            <Text
                              style={{
                                color: probeRes.ok
                                  ? theme.colors.statusSuccess
                                  : theme.colors.statusDanger,
                                fontSize: 12,
                                fontWeight: "600",
                              }}
                            >
                              {probeRes.ok
                                ? `✓ 连通正常 · ${probeRes.latencyMs}ms · 发现 ${probeRes.tools.length} 个工具${
                                    probeRes.serverInfo?.name
                                      ? ` (${probeRes.serverInfo.name}${
                                          probeRes.serverInfo.version
                                            ? ` v${probeRes.serverInfo.version}`
                                            : ""
                                        })`
                                      : ""
                                  }`
                                : `✕ 探测失败 (${probeRes.latencyMs}ms)：${probeRes.error ?? "未知错误"}`}
                            </Text>
                            {probeRes.ok && probeRes.tools.length > 0 ? (
                              <Text
                                style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
                                numberOfLines={3}
                              >
                                工具：{probeRes.tools.map((t) => t.name).join("、")}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </>
            ) : null}
          </>
        ) : null}

        {/* ============================================================ */}
        {/* VIEW 2: CROSS-MACHINE COMPARE & MANUAL MIGRATION             */}
        {/* ============================================================ */}
        {viewMode === "compare" && nodes.length > 0 ? (
          <>
            <View style={styles.card}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
                源主机（从哪台迁移）
              </Text>
              <View style={styles.row}>
                {nodes.map((node) => {
                  const active = node.hostId === compareFromHostId;
                  return (
                    <Pressable
                      key={`from-${node.hostId}`}
                      onPress={() => {
                        setCompareFromHostId(node.hostId);
                        setSelectedForMigrate([]);
                      }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? theme.colors.accent : theme.colors.surface0,
                          borderColor: active ? theme.colors.accent : theme.colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: active ? theme.colors.accentForeground : theme.colors.foreground,
                          fontSize: 12,
                        }}
                      >
                        {node.label} ({statusLabel(node.status)})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
                目标主机（迁移到哪台）
              </Text>
              <View style={styles.row}>
                {nodes.map((node) => {
                  const active = node.hostId === compareToHostId;
                  return (
                    <Pressable
                      key={`to-${node.hostId}`}
                      onPress={() => setCompareToHostId(node.hostId)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: active ? theme.colors.accent : theme.colors.surface0,
                          borderColor: active ? theme.colors.accent : theme.colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: active ? theme.colors.accentForeground : theme.colors.foreground,
                          fontSize: 12,
                        }}
                      >
                        {node.label} ({statusLabel(node.status)})
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.row}>
                <Pressable
                  onPress={() =>
                    setSelectedForMigrate(diffGroups.onlySource.map((s) => s.name))
                  }
                  style={styles.smallBtn}
                >
                  <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                    全选仅源机项 ({diffGroups.onlySource.length})
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setSelectedForMigrate([])}
                  style={styles.smallBtn}
                >
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    清空勾选
                  </Text>
                </Pressable>
                <Pressable
                  disabled={
                    selectedForMigrate.length === 0 ||
                    compareFromNode?.status !== "online" ||
                    compareToNode?.status !== "online"
                  }
                  onPress={openBatchMigrate}
                  style={[
                    styles.accentBtn,
                    {
                      opacity:
                        selectedForMigrate.length === 0 ||
                        compareFromNode?.status !== "online" ||
                        compareToNode?.status !== "online"
                          ? 0.45
                          : 1,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: theme.colors.accentForeground,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    预览并迁移已选 ({selectedForMigrate.length})
                  </Text>
                </Pressable>
              </View>
            </View>

            {compareFromNode?.status !== "online" || compareToNode?.status !== "online" ? (
              <View style={styles.card}>
                <Text style={{ color: theme.colors.statusWarning, fontSize: 13, fontWeight: "600" }}>
                  需要源主机与目标主机均在线且已安装 `paseo-mcp-center` 才能跨机对比与迁移。
                </Text>
                {compareToNode && compareToNode.status !== "online" ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                    目标主机 {compareToNode.label}：{compareToNode.error ?? statusLabel(compareToNode.status)}
                  </Text>
                ) : null}
              </View>
            ) : (
              <>
                {/* Group 1: Only on source */}
                <View style={styles.card}>
                  <Text style={{ color: theme.colors.statusSuccess, fontSize: 13, fontWeight: "700" }}>
                    仅源主机存在（{diffGroups.onlySource.length}）
                  </Text>
                  {diffGroups.onlySource.length === 0 ? (
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                      无独有项
                    </Text>
                  ) : (
                    diffGroups.onlySource.map((srv) => {
                      const checked = selectedForMigrate.includes(srv.name);
                      return (
                        <Pressable
                          key={`only-${srv.name}`}
                          onPress={() => toggleSelectMigrate(srv.name)}
                          style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            padding: 10,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: checked ? theme.colors.accent : theme.colors.border,
                            backgroundColor: theme.colors.surface0,
                            gap: 10,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text
                              style={{
                                color: theme.colors.foreground,
                                fontSize: 13,
                                fontWeight: "600",
                              }}
                            >
                              {checked ? "☑ " : "☐ "}
                              {srv.name} ({srv.type.toUpperCase()})
                            </Text>
                            <Text
                              style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
                              numberOfLines={1}
                            >
                              {srv.endpointPreview}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })
                  )}
                </View>

                {/* Group 2: Different config */}
                <View style={styles.card}>
                  <Text style={{ color: theme.colors.statusWarning, fontSize: 13, fontWeight: "700" }}>
                    两机均有但配置不同（{diffGroups.different.length}）
                  </Text>
                  {diffGroups.different.length === 0 ? (
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                      无差异项
                    </Text>
                  ) : (
                    diffGroups.different.map(({ source, target }) => {
                      const checked = selectedForMigrate.includes(source.name);
                      return (
                        <Pressable
                          key={`diff-${source.name}`}
                          onPress={() => toggleSelectMigrate(source.name)}
                          style={{
                            padding: 10,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: checked ? theme.colors.accent : theme.colors.border,
                            backgroundColor: theme.colors.surface0,
                            gap: 4,
                          }}
                        >
                          <Text
                            style={{
                              color: theme.colors.foreground,
                              fontSize: 13,
                              fontWeight: "600",
                            }}
                          >
                            {checked ? "☑ " : "☐ "}
                            {source.name}
                          </Text>
                          <Text
                            style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
                            numberOfLines={1}
                          >
                            源：{source.endpointPreview} (#{source.fingerprint.slice(0, 6)})
                          </Text>
                          <Text
                            style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
                            numberOfLines={1}
                          >
                            目标：{target.endpointPreview} (#{target.fingerprint.slice(0, 6)})
                          </Text>
                        </Pressable>
                      );
                    })
                  )}
                </View>

                {/* Group 3: Identical */}
                <View style={styles.card}>
                  <Pressable onPress={() => setShowIdentical((v) => !v)}>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, fontWeight: "600" }}>
                      两机配置一致（{diffGroups.identical.length}） {showIdentical ? "▲" : "▼"}
                    </Text>
                  </Pressable>
                  {showIdentical
                    ? diffGroups.identical.map((srv) => (
                        <Text
                          key={`same-${srv.name}`}
                          style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}
                        >
                          ✓ {srv.name} · {srv.endpointPreview}
                        </Text>
                      ))
                    : null}
                </View>
              </>
            )}
          </>
        ) : null}
      </ScrollView>

      <EditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        theme={theme}
        compact={layout.compact}
        hostLabel={editorState.hostLabel}
        mode={editorMode}
        initialName={editorState.name}
        initialConfig={editorState.config}
        initialEnabled={editorState.enabled}
        initialTargets={editorState.targets}
        saving={upsertMutation.isPending}
        onSave={async (payload) => {
          await upsertMutation.mutateAsync({
            hostId: editorState.hostId,
            ...payload,
          });
        }}
      />

      <MigrateModal
        open={migrateOpen}
        onOpenChange={setMigrateOpen}
        theme={theme}
        compact={layout.compact}
        nodes={nodes}
        fromHostId={migrateRequest.fromHostId}
        initialToHostId={migrateRequest.toHostId}
        items={migrateRequest.items}
        onMigrated={() => {
          setSelectedForMigrate([]);
          void invalidateOverview();
        }}
      />

      <DriftModal
        open={driftOpen}
        onOpenChange={setDriftOpen}
        theme={theme}
        compact={layout.compact}
        hostId={driftTarget?.hostId ?? ""}
        hostLabel={driftTarget?.hostLabel ?? ""}
        server={
          driftTarget
            ? (nodes
                .find((n) => n.hostId === driftTarget.hostId)
                ?.inventory?.servers.find((s) => s.name === driftTarget.serverName) ?? null)
            : null
        }
        onAligned={() => {
          void invalidateOverview();
        }}
      />
    </View>
  );
}
