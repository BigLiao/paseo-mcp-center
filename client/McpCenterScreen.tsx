import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Loading, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
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
  type ServerTargetEntry,
} from "../shared/contracts";
import { DriftModal } from "./DriftModal";
import { EditorModal } from "./EditorModal";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  Divider,
  FieldLabel,
  HostChip,
  LinkButton,
  MONO_FONT,
  Notice,
  SectionHeader,
  Segmented,
  hostStatusLabel,
} from "./kit";
import { MigrateModal } from "./MigrateModal";

type ViewMode = "manage" | "compare";
type TargetFilter = ClientTarget | "all" | "drift";

const MAX_CONTENT_WIDTH = 960;

export function McpCenterScreen({ theme, layout }: PluginScreenProps) {
  const compact = layout.compact;
  const c = theme.colors;
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
  const [targetFilter, setTargetFilter] = useState<TargetFilter>("all");
  // Inline delete panel: which server card is open and which clients to remove from.
  // Card whose secondary ("more") actions are expanded; delete lives there on purpose.
  const [moreOpenKey, setMoreOpenKey] = useState<string | null>(null);
  const [deleteDraft, setDeleteDraft] = useState<{ key: string; targets: ClientTarget[] } | null>(
    null,
  );

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
  const [openingEditKey, setOpeningEditKey] = useState<string | null>(null);

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

  const allServers = selectedNode?.inventory?.servers ?? [];
  const driftCount = allServers.filter((s) => s.hasTargetDrift).length;

  const filteredServers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allServers.filter((srv) => {
      if (targetFilter === "drift" && !srv.hasTargetDrift) return false;
      if (
        targetFilter !== "all" &&
        targetFilter !== "drift" &&
        !srv.entries.some((e) => e.target === targetFilter)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        srv.name.toLowerCase().includes(q) ||
        srv.endpointPreview.toLowerCase().includes(q) ||
        srv.type.includes(q)
      );
    });
  }, [allServers, searchQuery, targetFilter]);

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

  const pagePadding = compact ? 12 : 20;
  const containerStyle = {
    padding: pagePadding,
    gap: compact ? 12 : 14,
    width: "100%" as const,
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center" as const,
  };

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
    const key = `${host.hostId}::${server.name}`;
    setOpeningEditKey(key);
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
    } finally {
      setOpeningEditKey(null);
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

  function dismissProbe(key: string) {
    setProbeResults((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function openDeleteDraft(hostId: string, server: AggregatedServer, only?: ClientTarget) {
    setMoreOpenKey(null);
    setDeleteDraft({
      key: `${hostId}::${server.name}`,
      targets: only ? [only] : server.entries.map((e) => e.target),
    });
  }

  async function handleDelete(hostId: string, server: AggregatedServer, targets: ClientTarget[]) {
    if (targets.length === 0) return;
    const removingAll = server.entries.every((e) => targets.includes(e.target));
    try {
      await removeMutation.mutateAsync({ hostId, name: server.name, targets });
      setDeleteDraft(null);
      toast.show(
        removingAll
          ? `已从所有客户端删除 ${server.name}`
          : `已从 ${targets.map((t) => CLIENT_TARGET_META[t].shortLabel).join("、")} 删除 ${server.name}`,
        { variant: "success" },
      );
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

  function toggleSelectGroup(names: string[]) {
    setSelectedForMigrate((prev) => {
      const allIn = names.every((n) => prev.includes(n));
      if (allIn) return prev.filter((n) => !names.includes(n));
      return [...new Set([...prev, ...names])];
    });
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

  function swapCompareHosts() {
    setCompareFromHostId(compareToHostId);
    setCompareToHostId(compareFromHostId);
    setSelectedForMigrate([]);
  }

  const compareReady =
    compareFromNode?.status === "online" && compareToNode?.status === "online";
  const compareSameHost = compareFromHostId !== "" && compareFromHostId === compareToHostId;
  const canBatchMigrate = compareReady && !compareSameHost && selectedForMigrate.length > 0;

  // ------------------------------------------------------------------------
  // Initial load / fatal error
  // ------------------------------------------------------------------------

  if (overviewQuery.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: c.surface0 }}>
        <Loading />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={containerStyle}
        keyboardShouldPersistTaps="handled"
      >
        {/* Toolbar: mode switch + refresh. The screen title is owned by the Paseo header. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, maxWidth: compact ? undefined : 360 }}>
            <Segmented
              theme={theme}
              compact={compact}
              value={viewMode}
              onChange={setViewMode}
              options={[
                { value: "manage", label: compact ? "管理" : "单机管理", icon: "Server" },
                { value: "compare", label: compact ? "跨机迁移" : "跨机对比与迁移", icon: "ArrowRightLeft" },
              ]}
            />
          </View>
          {compact ? null : <View style={{ flex: 1 }} />}
          <Button
            theme={theme}
            compact={compact}
            icon="RefreshCw"
            label={compact ? undefined : "刷新"}
            accessibilityLabel="刷新"
            loading={overviewQuery.isFetching}
            onPress={() => void overviewQuery.refetch()}
          />
        </View>

        {overviewQuery.error ? (
          <Notice
            theme={theme}
            tone="danger"
            title="加载失败"
            message={
              overviewQuery.error instanceof Error
                ? overviewQuery.error.message
                : String(overviewQuery.error)
            }
          >
            <View style={{ flexDirection: "row", paddingTop: 4 }}>
              <Button
                theme={theme}
                compact={compact}
                size="sm"
                icon="RotateCcw"
                label="重试"
                onPress={() => void overviewQuery.refetch()}
              />
            </View>
          </Notice>
        ) : null}

        {viewMode === "manage" && nodes.length > 0 ? renderManage() : null}
        {viewMode === "compare" && nodes.length > 0 ? renderCompare() : null}
      </ScrollView>

      {viewMode === "compare" && nodes.length > 0 ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: c.border,
            backgroundColor: c.surface1,
          }}
        >
          <View
            style={{
              ...containerStyle,
              paddingVertical: compact ? 10 : 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
            }}
          >
            <View style={{ flexShrink: 1, gap: 2 }}>
              <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "600" }}>
                已选 {selectedForMigrate.length} 项
              </Text>
              {selectedForMigrate.length > 0 ? (
                <LinkButton
                  theme={theme}
                  tone="muted"
                  label="清空选择"
                  onPress={() => setSelectedForMigrate([])}
                />
              ) : (
                <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>
                  勾选上方条目后迁移
                </Text>
              )}
            </View>
            <View style={{ flex: 1 }} />
            <Button
              theme={theme}
              compact={compact}
              variant="primary"
              icon="ArrowRight"
              label={compact ? "预览迁移" : `预览并迁移到 ${compareToNode?.label ?? "目标机"}`}
              disabled={!canBatchMigrate}
              onPress={openBatchMigrate}
            />
          </View>
        </View>
      ) : null}

      <EditorModal
        open={editorOpen}
        onOpenChange={setEditorOpen}
        theme={theme}
        compact={compact}
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
        compact={compact}
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
        compact={compact}
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

  // ==========================================================================
  // VIEW 1: SINGLE HOST MANAGEMENT
  // ==========================================================================

  function renderManage() {
    const inventory = selectedNode?.inventory;
    const parseErrors = inventory?.targets.filter((t) => t.parseError) ?? [];
    const filtersActive = targetFilter !== "all" || searchQuery.trim() !== "";

    return (
      <>
        {/* Host switcher (only when more than one host is paired) */}
        {nodes.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 8 }}
          >
            {nodes.map((node) => (
              <HostChip
                key={node.hostId}
                theme={theme}
                compact={compact}
                node={node}
                selected={node.hostId === selectedNode?.hostId}
                meta={
                  node.inventory
                    ? `${node.inventory.platform} · ${node.inventory.servers.length}`
                    : hostStatusLabel(node.status)
                }
                onPress={() => {
                  setSelectedHostId(node.hostId);
                  setDeleteDraft(null);
                  setMoreOpenKey(null);
                }}
              />
            ))}
          </ScrollView>
        ) : null}

        {selectedNode && selectedNode.status !== "online" ? (
          <Notice
            theme={theme}
            tone={selectedNode.status === "plugin_missing" ? "warning" : "danger"}
            title={`${selectedNode.label} · ${hostStatusLabel(selectedNode.status)}`}
            message={
              selectedNode.status === "plugin_missing"
                ? `${selectedNode.error ?? "目标主机未安装插件"}\n请在该主机上安装并启用 paseo-mcp-center，然后点击刷新。`
                : (selectedNode.error ?? "无法连接该主机")
            }
          />
        ) : null}

        {inventory && selectedNode ? (
          <>
            {/* Search + create */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  minHeight: compact ? 42 : 34,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: c.border,
                  backgroundColor: c.surface1,
                }}
              >
                <Icon name="Search" size={15} color={c.foregroundMuted} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="搜索名称、URL 或命令"
                  placeholderTextColor={c.foregroundMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                  accessibilityLabel="搜索 MCP"
                  style={{
                    flex: 1,
                    color: c.foreground,
                    fontSize: 13,
                    paddingVertical: compact ? 10 : 6,
                    minWidth: 0,
                  }}
                />
                {searchQuery ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="清除搜索"
                    hitSlop={10}
                    onPress={() => setSearchQuery("")}
                  >
                    <Icon name="X" size={15} color={c.foregroundMuted} />
                  </Pressable>
                ) : null}
              </View>
              {selectedNode.status === "online" ? (
                <Button
                  theme={theme}
                  compact={compact}
                  variant="primary"
                  icon="Plus"
                  label={compact ? undefined : "新增 MCP"}
                  accessibilityLabel="新增 MCP"
                  onPress={() => handleOpenCreate(selectedNode)}
                />
              ) : null}
            </View>

            {/* Filters */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ gap: 8 }}
            >
              <Chip
                theme={theme}
                compact={compact}
                label="全部"
                count={allServers.length}
                selected={targetFilter === "all"}
                onPress={() => setTargetFilter("all")}
              />
              {driftCount > 0 ? (
                <Chip
                  theme={theme}
                  compact={compact}
                  label="参数不一致"
                  icon="TriangleAlert"
                  tone="warning"
                  count={driftCount}
                  selected={targetFilter === "drift"}
                  onPress={() => setTargetFilter(targetFilter === "drift" ? "all" : "drift")}
                />
              ) : null}
              {inventory.targets.map((t) => (
                <Chip
                  key={t.target}
                  theme={theme}
                  compact={compact}
                  label={CLIENT_TARGET_META[t.target].shortLabel}
                  count={t.serverCount}
                  icon={t.parseError ? "TriangleAlert" : undefined}
                  tone={t.parseError ? "danger" : undefined}
                  selected={targetFilter === t.target}
                  accessibilityLabel={`${CLIENT_TARGET_META[t.target].label} ${t.path}`}
                  onPress={() => setTargetFilter(targetFilter === t.target ? "all" : t.target)}
                />
              ))}
            </ScrollView>

            {parseErrors.length > 0 ? (
              <Notice theme={theme} tone="danger" title="部分客户端配置解析失败">
                {parseErrors.map((t) => (
                  <Text
                    key={t.target}
                    selectable
                    style={{ color: c.foregroundMuted, fontSize: 12, lineHeight: 18 }}
                  >
                    {CLIENT_TARGET_META[t.target].label}（{t.path}）：{t.parseError}
                  </Text>
                ))}
              </Notice>
            ) : null}

            {/* Legend + result count */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                flexWrap: "wrap",
                gap: compact ? 10 : 14,
              }}
            >
              <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
                {filtersActive
                  ? `${filteredServers.length} / ${allServers.length} 个 MCP`
                  : `${allServers.length} 个 MCP`}
              </Text>
              <View style={{ flex: 1 }} />
              <LegendItem theme={theme} icon="CircleCheck" color={c.statusSuccess} label="已启用" />
              <LegendItem theme={theme} icon="CirclePause" color={c.foregroundMuted} label="已停用" />
              <LegendItem theme={theme} icon="Plus" color={c.foregroundMuted} label="未配置" />
            </View>

            {filteredServers.length === 0 ? (
              <Card theme={theme} compact={compact} style={{ alignItems: "center", paddingVertical: 28 }}>
                <Icon name="Cable" size={28} color={c.foregroundMuted} />
                <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "600" }}>
                  {allServers.length === 0 ? "这台主机还没有 MCP" : "没有匹配的 MCP"}
                </Text>
                <Text style={{ color: c.foregroundMuted, fontSize: 12, textAlign: "center" }}>
                  {allServers.length === 0
                    ? "新增一个 MCP，或从其他主机迁移过来。"
                    : "试试调整搜索关键词或客户端筛选。"}
                </Text>
                {allServers.length === 0 && selectedNode.status === "online" ? (
                  <Button
                    theme={theme}
                    compact={compact}
                    variant="primary"
                    icon="Plus"
                    label="新增 MCP"
                    onPress={() => handleOpenCreate(selectedNode)}
                  />
                ) : filtersActive ? (
                  <Button
                    theme={theme}
                    compact={compact}
                    icon="X"
                    label="清除筛选"
                    onPress={() => {
                      setTargetFilter("all");
                      setSearchQuery("");
                    }}
                  />
                ) : null}
              </Card>
            ) : (
              filteredServers.map((server) => renderServerCard(selectedNode, server))
            )}
          </>
        ) : null}
      </>
    );
  }

  function renderServerCard(host: FleetNode, server: AggregatedServer) {
    const key = `${host.hostId}::${server.name}`;
    const probeRes = probeResults[key];
    const isProbing = probingKey === key;
    const draft = deleteDraft?.key === key ? deleteDraft : null;
    const moreOpen = moreOpenKey === key;
    const busyAll = togglingKey === `${key}::__all__`;
    const online = host.status === "online";

    const enabledCount = CLIENT_TARGETS.filter(
      (t) => server.entries.find((e) => e.target === t)?.enabled === true,
    ).length;
    const allEnabled = enabledCount === CLIENT_TARGETS.length;

    return (
      <Card key={server.name} theme={theme} compact={compact}>
        {/* Title row */}
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text
              numberOfLines={1}
              selectable
              style={{ color: c.foreground, fontSize: 15, fontWeight: "700", flexShrink: 1 }}
            >
              {server.name}
            </Text>
            <Badge
              theme={theme}
              icon={server.type === "http" ? "Globe" : "Terminal"}
              label={server.type.toUpperCase()}
            />
            <View style={{ flex: 1 }} />
            <Text style={{ color: c.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
              {enabledCount}/{CLIENT_TARGETS.length}
            </Text>
          </View>
          <Text
            numberOfLines={1}
            selectable
            style={{ color: c.foregroundMuted, fontSize: 12, fontFamily: MONO_FONT }}
          >
            {server.endpointPreview}
          </Text>
          {server.hasTargetDrift ? (
            <View style={{ paddingTop: 2 }}>
              <Badge
                theme={theme}
                tone="warning"
                icon="TriangleAlert"
                label="各客户端参数不一致 · 对比对齐"
                onPress={() => {
                  setDriftTarget({
                    hostId: host.hostId,
                    hostLabel: host.label,
                    serverName: server.name,
                  });
                  setDriftOpen(true);
                }}
              />
            </View>
          ) : null}
        </View>

        {/* Client toggles */}
        <View style={{ gap: 8 }}>
          <FieldLabel
            theme={theme}
            label="客户端"
            trailing={
              online ? (
                busyAll ? (
                  <ActivityIndicator size="small" color={c.accent} />
                ) : (
                  <LinkButton
                    theme={theme}
                    label={allEnabled ? "全部停用" : "全部启用"}
                    disabled={togglingKey !== null}
                    onPress={() => void handleToggleAllClients(host.hostId, server)}
                  />
                )
              ) : null
            }
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: compact ? 8 : 6 }}>
            {CLIENT_TARGETS.map((target) => (
              <ClientPill
                key={target}
                theme={theme}
                compact={compact}
                target={target}
                entry={server.entries.find((e) => e.target === target)}
                busy={togglingKey === `${key}::${target}` || busyAll}
                disabled={!online || (togglingKey !== null && togglingKey !== `${key}::${target}`)}
                onPress={() => void handleToggleClient(host.hostId, server, target)}
                onLongPress={() => openDeleteDraft(host.hostId, server, target)}
              />
            ))}
          </View>
        </View>

        {/* Inline probe result */}
        {probeRes ? (
          <ProbePanel
            theme={theme}
            compact={compact}
            result={probeRes}
            onDismiss={() => dismissProbe(key)}
          />
        ) : null}

        <Divider theme={theme} />

        {/* Actions / delete confirmation */}
        {draft ? (
          <DeletePanel
            theme={theme}
            compact={compact}
            server={server}
            targets={draft.targets}
            deleting={removeMutation.isPending}
            onChange={(targets) => setDeleteDraft({ key, targets })}
            onCancel={() => setDeleteDraft(null)}
            onConfirm={() => void handleDelete(host.hostId, server, draft.targets)}
          />
        ) : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Button
              theme={theme}
              compact={compact}
              size="sm"
              icon="Activity"
              label="测活"
              loading={isProbing}
              disabled={!online}
              onPress={() => void handleProbe(host.hostId, server)}
            />
            <Button
              theme={theme}
              compact={compact}
              size="sm"
              icon="Pencil"
              label="编辑"
              loading={openingEditKey === key}
              disabled={!online}
              onPress={() => void handleOpenEdit(host, server)}
            />
            <Button
              theme={theme}
              compact={compact}
              size="sm"
              icon="ArrowRightLeft"
              label="迁移"
              accessibilityLabel="迁移或复制到其他主机/客户端"
              disabled={!online}
              onPress={() => openSingleMigrate(host.hostId, server)}
            />
            <View style={{ flex: 1 }} />
            <Button
              theme={theme}
              compact={compact}
              size="sm"
              variant="quiet"
              icon="Ellipsis"
              accessibilityLabel="更多操作"
              disabled={!online}
              onPress={() => setMoreOpenKey(moreOpen ? null : key)}
            />
          </View>
        )}

        {/* Secondary actions, collapsed by default */}
        {moreOpen && !draft ? (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "flex-end",
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <Text style={{ color: c.foregroundMuted, fontSize: 11, flexShrink: 1 }}>
              也可长按客户端标签单独删除
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`删除 ${server.name}（可选择客户端）`}
              disabled={server.entries.length === 0}
              hitSlop={8}
              onPress={() => openDeleteDraft(host.hostId, server)}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                minHeight: compact ? 32 : 24,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Icon name="Trash2" size={13} color={c.foregroundMuted} />
              <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>删除…</Text>
            </Pressable>
          </View>
        ) : null}
      </Card>
    );
  }

  // ==========================================================================
  // VIEW 2: CROSS-MACHINE COMPARE & MANUAL MIGRATION
  // ==========================================================================

  function renderCompare() {
    const onlyNames = diffGroups.onlySource.map((s) => s.name);
    const diffNames = diffGroups.different.map((d) => d.source.name);
    const allSelected = (names: string[]) =>
      names.length > 0 && names.every((n) => selectedForMigrate.includes(n));

    return (
      <>
        <Card theme={theme} compact={compact}>
          <FieldLabel theme={theme} label="源主机" />
          <HostPickerRow
            theme={theme}
            compact={compact}
            nodes={nodes}
            value={compareFromHostId}
            onChange={(id) => {
              setCompareFromHostId(id);
              setSelectedForMigrate([]);
            }}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
            <Button
              theme={theme}
              compact={compact}
              size="sm"
              icon="ArrowUpDown"
              label="互换"
              accessibilityLabel="互换源主机与目标主机"
              onPress={swapCompareHosts}
            />
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          </View>
          <FieldLabel theme={theme} label="目标主机" />
          <HostPickerRow
            theme={theme}
            compact={compact}
            nodes={nodes}
            value={compareToHostId}
            onChange={(id) => {
              setCompareToHostId(id);
              setSelectedForMigrate([]);
            }}
          />
        </Card>

        {!compareReady ? (
          <Notice
            theme={theme}
            tone="warning"
            title="源主机与目标主机需均在线并已安装插件"
            message={[compareFromNode, compareToNode]
              .filter((n): n is FleetNode => !!n && n.status !== "online")
              .map((n) => `${n.label}：${n.error ?? hostStatusLabel(n.status)}`)
              .join("\n")}
          />
        ) : compareSameHost ? (
          <Notice
            theme={theme}
            tone="info"
            title="源主机与目标主机相同"
            message="请选择另一台主机进行对比。若要在同一台主机的不同客户端之间复制，请在「管理」中使用某个 MCP 的「迁移」。"
          />
        ) : (
          <>
            {/* Summary */}
            <View style={{ flexDirection: "row", gap: 8 }}>
              <SummaryTile theme={theme} compact={compact} tone="success" label="仅源机" value={diffGroups.onlySource.length} />
              <SummaryTile theme={theme} compact={compact} tone="warning" label="有差异" value={diffGroups.different.length} />
              <SummaryTile theme={theme} compact={compact} tone="muted" label="一致" value={diffGroups.identical.length} />
            </View>

            {/* Group 1: Only on source */}
            <Card theme={theme} compact={compact} style={{ gap: 0, paddingBottom: 4 }}>
              <View style={{ paddingBottom: 8 }}>
                <SectionHeader
                  theme={theme}
                  tone="success"
                  title="仅源主机存在"
                  count={diffGroups.onlySource.length}
                  trailing={
                    onlyNames.length > 0 ? (
                      <LinkButton
                        theme={theme}
                        label={allSelected(onlyNames) ? "取消全选" : "全选"}
                        onPress={() => toggleSelectGroup(onlyNames)}
                      />
                    ) : null
                  }
                />
              </View>
              {diffGroups.onlySource.length === 0 ? (
                <EmptyLine theme={theme} text="没有仅源主机才有的 MCP" />
              ) : (
                diffGroups.onlySource.map((srv) => (
                  <SelectRow
                    key={`only-${srv.name}`}
                    theme={theme}
                    compact={compact}
                    checked={selectedForMigrate.includes(srv.name)}
                    onPress={() => toggleSelectMigrate(srv.name)}
                    title={srv.name}
                    badge={srv.type.toUpperCase()}
                    lines={[srv.endpointPreview]}
                  />
                ))
              )}
            </Card>

            {/* Group 2: Different config */}
            <Card theme={theme} compact={compact} style={{ gap: 0, paddingBottom: 4 }}>
              <View style={{ paddingBottom: 8 }}>
                <SectionHeader
                  theme={theme}
                  tone="warning"
                  title="两机均有但配置不同"
                  count={diffGroups.different.length}
                  trailing={
                    diffNames.length > 0 ? (
                      <LinkButton
                        theme={theme}
                        label={allSelected(diffNames) ? "取消全选" : "全选"}
                        onPress={() => toggleSelectGroup(diffNames)}
                      />
                    ) : null
                  }
                />
              </View>
              {diffGroups.different.length === 0 ? (
                <EmptyLine theme={theme} text="没有配置不同的 MCP" />
              ) : (
                diffGroups.different.map(({ source, target }) => (
                  <SelectRow
                    key={`diff-${source.name}`}
                    theme={theme}
                    compact={compact}
                    checked={selectedForMigrate.includes(source.name)}
                    onPress={() => toggleSelectMigrate(source.name)}
                    title={source.name}
                    badge={source.type.toUpperCase()}
                    lines={[
                      `源    ${source.endpointPreview}  #${source.fingerprint.slice(0, 6)}`,
                      `目标  ${target.endpointPreview}  #${target.fingerprint.slice(0, 6)}`,
                    ]}
                  />
                ))
              )}
            </Card>

            {/* Group 3: Identical */}
            <Card theme={theme} compact={compact} style={{ gap: 0 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: showIdentical }}
                onPress={() => setShowIdentical((v) => !v)}
                style={{ minHeight: compact ? 32 : 24, justifyContent: "center" }}
              >
                <SectionHeader
                  theme={theme}
                  tone="muted"
                  title="两机配置一致"
                  count={diffGroups.identical.length}
                  trailing={
                    <Icon
                      name={showIdentical ? "ChevronUp" : "ChevronDown"}
                      size={16}
                      color={c.foregroundMuted}
                    />
                  }
                />
              </Pressable>
              {showIdentical ? (
                <View style={{ paddingTop: 8, gap: 8 }}>
                  {diffGroups.identical.length === 0 ? (
                    <EmptyLine theme={theme} text="没有完全一致的 MCP" />
                  ) : (
                    diffGroups.identical.map((srv) => (
                      <View
                        key={`same-${srv.name}`}
                        style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                      >
                        <Icon name="CircleCheck" size={14} color={c.statusSuccess} />
                        <Text style={{ color: c.foreground, fontSize: 12, fontWeight: "600" }}>
                          {srv.name}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={{ color: c.foregroundMuted, fontSize: 12, flex: 1, fontFamily: MONO_FONT }}
                        >
                          {srv.endpointPreview}
                        </Text>
                      </View>
                    ))
                  )}
                </View>
              ) : null}
            </Card>
          </>
        )}
      </>
    );
  }
}

// ============================================================================
// Screen-local components
// ============================================================================

function LegendItem({
  theme,
  icon,
  color,
  label,
}: {
  theme: PluginTheme;
  icon: string;
  color: string;
  label: string;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Icon name={icon} size={12} color={color} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function ClientPill({
  theme,
  compact,
  target,
  entry,
  busy,
  disabled,
  onPress,
  onLongPress,
}: {
  theme: PluginTheme;
  compact: boolean;
  target: ClientTarget;
  entry: ServerTargetEntry | undefined;
  busy: boolean;
  disabled: boolean;
  onPress(): void;
  /** Shortcut to delete from just this client; only offered when it has a config. */
  onLongPress(): void;
}) {
  const c = theme.colors;
  const meta = CLIENT_TARGET_META[target];
  const state = !entry ? "missing" : entry.enabled ? "on" : "off";
  const icon = state === "on" ? "CircleCheck" : state === "off" ? "CirclePause" : "Plus";
  const iconColor = state === "on" ? c.statusSuccess : c.foregroundMuted;
  const tip =
    state === "on"
      ? `${meta.label}（${meta.defaultPath}）已启用，点击停用并保留配置`
      : state === "off"
        ? `${meta.label}（${meta.defaultPath}）已停用，点击重新启用`
        : `${meta.label}（${meta.defaultPath}）未配置，点击克隆配置并启用`;

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={tip}
      accessibilityState={{ checked: state === "on", disabled: disabled || busy, busy }}
      accessibilityHint={entry ? "长按可从该客户端删除" : undefined}
      disabled={disabled || busy}
      onPress={onPress}
      onLongPress={entry ? onLongPress : undefined}
      delayLongPress={450}
      style={({ pressed }) => ({
        minHeight: compact ? 34 : 28,
        paddingHorizontal: compact ? 11 : 9,
        borderRadius: 999,
        borderWidth: 1,
        borderStyle: state === "missing" ? "dashed" : "solid",
        borderColor: state === "on" ? c.statusSuccess : c.border,
        backgroundColor: state === "missing" ? c.surface0 : c.surface2,
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        opacity: disabled && !busy ? 0.55 : pressed ? 0.7 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Icon name={icon} size={13} color={iconColor} />
      )}
      <Text
        style={{
          color: state === "on" ? c.foreground : c.foregroundMuted,
          fontSize: 12,
          fontWeight: state === "on" ? "600" : "500",
        }}
      >
        {meta.shortLabel}
      </Text>
    </Pressable>
  );
}

function DeletePanel({
  theme,
  compact,
  server,
  targets,
  deleting,
  onChange,
  onCancel,
  onConfirm,
}: {
  theme: PluginTheme;
  compact: boolean;
  server: AggregatedServer;
  targets: ClientTarget[];
  deleting: boolean;
  onChange(targets: ClientTarget[]): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const c = theme.colors;
  const configured = CLIENT_TARGETS.filter((t) => server.entries.some((e) => e.target === t));
  const allSelected = configured.length > 0 && configured.every((t) => targets.includes(t));

  return (
    <View
      style={{
        gap: 10,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.statusDanger,
        backgroundColor: c.surface0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="Trash2" size={15} color={c.statusDanger} />
        <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "700", flex: 1 }}>
          从哪些客户端删除「{server.name}」？
        </Text>
        <LinkButton
          theme={theme}
          label={allSelected ? "清空" : "全选"}
          onPress={() => onChange(allSelected ? [] : configured)}
        />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {configured.map((target) => {
          const selected = targets.includes(target);
          const entry = server.entries.find((e) => e.target === target);
          return (
            <Chip
              key={target}
              theme={theme}
              compact={compact}
              selected={selected}
              icon={selected ? "Check" : undefined}
              label={`${CLIENT_TARGET_META[target].shortLabel}${entry?.enabled ? "" : "（已停用）"}`}
              accessibilityLabel={`${CLIENT_TARGET_META[target].label}${selected ? "，将删除" : ""}`}
              onPress={() =>
                onChange(selected ? targets.filter((t) => t !== target) : [...targets, target])
              }
            />
          );
        })}
      </View>
      <Text style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
        删除会从配置文件中彻底移除定义（包括停用时暂存的配置），之后无法用开关恢复；写入前自动备份
        .mcp-center.bak。只想暂时关闭请用上方开关停用。
      </Text>
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
        <Button
          theme={theme}
          compact={compact}
          size="sm"
          label="取消"
          grow={compact}
          onPress={onCancel}
        />
        <Button
          theme={theme}
          compact={compact}
          size="sm"
          variant="danger"
          icon="Trash2"
          label={
            targets.length === 0
              ? "请选择客户端"
              : allSelected
                ? "全部删除"
                : `从 ${targets.length} 个客户端删除`
          }
          grow={compact}
          loading={deleting}
          disabled={targets.length === 0}
          onPress={onConfirm}
        />
      </View>
    </View>
  );
}

function ProbePanel({
  theme,
  compact,
  result,
  onDismiss,
}: {
  theme: PluginTheme;
  compact: boolean;
  result: ProbeResult;
  onDismiss(): void;
}) {
  const c = theme.colors;
  const [showAllTools, setShowAllTools] = useState(false);
  const tone = result.ok ? c.statusSuccess : c.statusDanger;
  const info = result.serverInfo?.name
    ? `${result.serverInfo.name}${result.serverInfo.version ? ` v${result.serverInfo.version}` : ""}`
    : null;
  const limit = compact ? 6 : 16;
  const shownTools = showAllTools ? result.tools : result.tools.slice(0, limit);

  return (
    <View
      style={{
        padding: 10,
        gap: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: tone,
        backgroundColor: c.surface0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name={result.ok ? "CircleCheck" : "CircleX"} size={15} color={tone} />
        <Text style={{ color: tone, fontSize: 12, fontWeight: "700", flexShrink: 0 }}>
          {result.ok ? "连通正常" : "探测失败"}
        </Text>
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12, flexShrink: 1 }}>
          {result.latencyMs}ms
          {result.ok ? ` · ${result.tools.length} 个工具` : ""}
          {info ? ` · ${info}` : ""}
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="关闭探测结果"
          hitSlop={10}
          onPress={onDismiss}
        >
          <Icon name="X" size={14} color={c.foregroundMuted} />
        </Pressable>
      </View>
      {!result.ok && result.error ? (
        <Text selectable style={{ color: c.foregroundMuted, fontSize: 12, fontFamily: MONO_FONT }}>
          {result.error}
        </Text>
      ) : null}
      {result.ok && shownTools.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {shownTools.map((t) => (
            <Badge key={t.name} theme={theme} label={t.name} />
          ))}
          {result.tools.length > limit ? (
            <Badge
              theme={theme}
              tone="accent"
              label={showAllTools ? "收起" : `+${result.tools.length - shownTools.length}`}
              accessibilityLabel={showAllTools ? "收起工具列表" : "显示全部工具"}
              onPress={() => setShowAllTools((v) => !v)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function HostPickerRow({
  theme,
  compact,
  nodes,
  value,
  onChange,
}: {
  theme: PluginTheme;
  compact: boolean;
  nodes: FleetNode[];
  value: string;
  onChange(hostId: string): void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{ gap: 8 }}
    >
      {nodes.map((node) => (
        <HostChip
          key={node.hostId}
          theme={theme}
          compact={compact}
          node={node}
          selected={node.hostId === value}
          meta={node.inventory ? node.inventory.platform : hostStatusLabel(node.status)}
          onPress={() => onChange(node.hostId)}
        />
      ))}
    </ScrollView>
  );
}

function SummaryTile({
  theme,
  compact,
  tone,
  label,
  value,
}: {
  theme: PluginTheme;
  compact: boolean;
  tone: "success" | "warning" | "muted";
  label: string;
  value: number;
}) {
  const c = theme.colors;
  const color =
    tone === "success" ? c.statusSuccess : tone === "warning" ? c.statusWarning : c.foregroundMuted;
  return (
    <View
      style={{
        flex: 1,
        padding: compact ? 10 : 12,
        gap: 2,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
      }}
    >
      <Text style={{ color: c.foreground, fontSize: compact ? 18 : 20, fontWeight: "700" }}>
        {value}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 12 }}>
          {label}
        </Text>
      </View>
    </View>
  );
}

function SelectRow({
  theme,
  compact,
  checked,
  onPress,
  title,
  badge,
  lines,
}: {
  theme: PluginTheme;
  compact: boolean;
  checked: boolean;
  onPress(): void;
  title: string;
  badge?: string;
  lines: string[];
}) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: compact ? 52 : 44,
        paddingVertical: 8,
        paddingHorizontal: 8,
        marginHorizontal: -8,
        borderRadius: 8,
        borderTopWidth: 1,
        borderTopColor: c.border,
        backgroundColor: checked ? c.surface2 : pressed ? c.surface2 : "transparent",
      })}
    >
      <Checkbox theme={theme} checked={checked} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            numberOfLines={1}
            style={{ color: c.foreground, fontSize: 13, fontWeight: "600", flexShrink: 1 }}
          >
            {title}
          </Text>
          {badge ? <Badge theme={theme} label={badge} /> : null}
        </View>
        {lines.map((line, i) => (
          <Text
            key={i}
            numberOfLines={1}
            style={{ color: c.foregroundMuted, fontSize: 11, fontFamily: MONO_FONT }}
          >
            {line}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

function EmptyLine({ theme, text }: { theme: PluginTheme; text: string }) {
  return (
    <Text
      style={{
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        paddingVertical: 10,
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
      }}
    >
      {text}
    </Text>
  );
}
