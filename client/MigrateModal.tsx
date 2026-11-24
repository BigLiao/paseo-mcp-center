import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Switch, Text, View } from "react-native";
import {
  CLIENT_TARGETS,
  CLIENT_TARGET_META,
  McpServerConfigSchema,
  fleetExecuteMigrateRpc,
  fleetPreviewMigrateRpc,
  type ClientTarget,
  type ConflictMode,
  type FleetNode,
  type McpServerConfig,
  type MigrateExecuteOutput,
  type MigratePreviewOutput,
} from "../shared/contracts";

interface MigrateModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  compact: boolean;
  nodes: FleetNode[];
  fromHostId: string;
  initialToHostId: string;
  items: { name: string; sourceTarget?: ClientTarget }[];
  onMigrated(): void;
}

export function MigrateModal({
  open,
  onOpenChange,
  theme,
  compact,
  nodes,
  fromHostId,
  initialToHostId,
  items,
  onMigrated,
}: MigrateModalProps) {
  const toast = useToast();
  const previewMigrate = useRpc(fleetPreviewMigrateRpc);
  const executeMigrate = useRpc(fleetExecuteMigrateRpc);

  const onlineNodes = useMemo(() => nodes.filter((n) => n.status === "online"), [nodes]);
  const [toHostId, setToHostId] = useState(initialToHostId);
  const [targetClients, setTargetClients] = useState<ClientTarget[]>(["claude", "codex"]);
  const [conflictMode, setConflictMode] = useState<ConflictMode>("overwrite");
  const [enabledAfterMigrate, setEnabledAfterMigrate] = useState(true);

  const [loadingPreview, setLoadingPreview] = useState(false);
  const [preview, setPreview] = useState<MigratePreviewOutput | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [overrideJsonByName, setOverrideJsonByName] = useState<Record<string, string>>({});

  const [executing, setExecuting] = useState(false);
  const [execResult, setExecResult] = useState<MigrateExecuteOutput | null>(null);

  useEffect(() => {
    if (!open) return;
    setToHostId(initialToHostId);
    setExecResult(null);
    setExpandedItem(null);
    setOverrideJsonByName({});
  }, [open, initialToHostId]);

  useEffect(() => {
    if (!open || !fromHostId || !toHostId || items.length === 0) return;
    let cancelled = false;
    setLoadingPreview(true);
    setPreviewError(null);
    setPreview(null);
    void previewMigrate({ fromHostId, toHostId, items })
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        const initialJson: Record<string, string> = {};
        for (const it of res.items) {
          initialJson[it.name] = JSON.stringify(it.sourceConfig, null, 2);
        }
        setOverrideJsonByName(initialJson);
      })
      .catch((error) => {
        if (cancelled) return;
        setPreviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fromHostId, toHostId, items, previewMigrate]);

  const fromNode = nodes.find((n) => n.hostId === fromHostId);
  const toNode = nodes.find((n) => n.hostId === toHostId);

  const styles = useMemo(
    () => ({
      section: { gap: 8 },
      label: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      row: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
        alignItems: "center" as const,
      },
      chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
      },
      card: {
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        gap: 8,
      },
      warnBox: {
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.statusWarning,
        backgroundColor: theme.colors.surface1,
      },
      errBox: {
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.statusDanger,
        backgroundColor: theme.colors.surface1,
      },
      jsonBox: {
        minHeight: 130,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        color: theme.colors.foreground,
        borderRadius: 8,
        padding: 10,
        fontSize: 12,
        fontFamily: "monospace",
        textAlignVertical: "top" as const,
      },
      footer: {
        flexDirection: "row" as const,
        justifyContent: "flex-end" as const,
        gap: 10,
        paddingTop: 8,
      },
      btn: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 8,
        borderWidth: 1,
      },
    }),
    [theme],
  );

  function toggleTarget(target: ClientTarget) {
    setTargetClients((prev) =>
      prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target],
    );
  }

  async function handleExecute() {
    if (!preview) return;
    if (targetClients.length === 0) {
      toast.error("请至少选择一个目标客户端");
      return;
    }

    const payloadItems: {
      name: string;
      sourceTarget?: ClientTarget;
      configOverride?: McpServerConfig;
    }[] = [];

    for (const it of preview.items) {
      const editedText = overrideJsonByName[it.name];
      let configOverride: McpServerConfig | undefined;
      if (editedText && editedText.trim() !== JSON.stringify(it.sourceConfig, null, 2).trim()) {
        try {
          const parsed = JSON.parse(editedText);
          configOverride = McpServerConfigSchema.parse(parsed);
        } catch (error) {
          toast.error(
            `「${it.name}」的自定义 JSON 校验失败：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return;
        }
      }
      payloadItems.push({
        name: it.name,
        sourceTarget: it.sourceTarget,
        ...(configOverride ? { configOverride } : {}),
      });
    }

    setExecuting(true);
    try {
      const result = await executeMigrate({
        fromHostId,
        toHostId,
        targetClients,
        conflictMode,
        enabledAfterMigrate,
        items: payloadItems,
      });
      setExecResult(result);
      const okCount = result.results.filter((r) => r.status === "migrated").length;
      const errCount = result.results.filter((r) => r.status === "error").length;
      toast.show(`迁移完成：成功 ${okCount} 项，失败 ${errCount} 项`, {
        variant: errCount > 0 ? "warning" : "success",
      });
      onMigrated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setExecuting(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="手动迁移 MCP（经 Paseo Relay）">
      <Modal.Content contentContainerStyle={{ padding: compact ? 16 : 20, gap: 14 }}>
        <View style={styles.card}>
          <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
            源主机：{fromNode?.label ?? fromHostId}
            {fromNode?.inventory ? ` (${fromNode.inventory.platform})` : ""}
          </Text>
          <Text style={styles.label}>选择目标主机（支持跨机迁移或同机跨客户端复制）</Text>
          <View style={styles.row}>
            {onlineNodes.map((node) => {
              const active = node.hostId === toHostId;
              return (
                <Pressable
                  key={node.hostId}
                  onPress={() => setToHostId(node.hostId)}
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
                      fontWeight: "600",
                    }}
                  >
                    {node.label}
                    {node.isSelf ? " (本机)" : ""}
                    {node.inventory ? ` · ${node.inventory.platform}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>写入到目标主机的哪些客户端</Text>
          <View style={styles.row}>
            {(() => {
              const allSelected = targetClients.length === CLIENT_TARGETS.length;
              return (
                <Pressable
                  onPress={() =>
                    setTargetClients(allSelected ? [] : [...CLIENT_TARGETS])
                  }
                  style={[
                    styles.chip,
                    {
                      backgroundColor: allSelected ? theme.colors.accent : theme.colors.surface1,
                      borderColor: allSelected ? theme.colors.accent : theme.colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: allSelected ? theme.colors.accentForeground : theme.colors.foreground,
                      fontSize: 12,
                      fontWeight: "600",
                    }}
                  >
                    {allSelected ? "✓ " : ""}全部
                  </Text>
                </Pressable>
              );
            })()}
            {CLIENT_TARGETS.map((target) => {
              const selected = targetClients.includes(target);
              return (
                <Pressable
                  key={target}
                  onPress={() => toggleTarget(target)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected ? theme.colors.accent : theme.colors.surface1,
                      borderColor: selected ? theme.colors.accent : theme.colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: selected ? theme.colors.accentForeground : theme.colors.foreground,
                      fontSize: 12,
                    }}
                  >
                    {selected ? "✓ " : ""}
                    {CLIENT_TARGET_META[target].shortLabel}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>同名冲突策略</Text>
          <View style={styles.row}>
            {(
              [
                { id: "overwrite", label: "覆盖更新" },
                { id: "skip", label: "跳过已有" },
                { id: "rename", label: "自动重命名 (-2)" },
              ] as const
            ).map((opt) => {
              const active = conflictMode === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => setConflictMode(opt.id)}
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
                      fontSize: 12,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>
            迁移后在目标主机立即启用
          </Text>
          <Switch value={enabledAfterMigrate} onValueChange={setEnabledAfterMigrate} />
        </View>

        {loadingPreview ? (
          <View style={{ padding: 20, alignItems: "center", gap: 8 }}>
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              正在经 Relay 拉取配置并生成差异预览...
            </Text>
          </View>
        ) : null}

        {previewError ? (
          <View style={styles.errBox}>
            <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
              预览失败：{previewError}
            </Text>
          </View>
        ) : null}

        {preview ? (
          <View style={styles.section}>
            {preview.crossOs && preview.items.some((i) => i.crossOsStdioWarning) ? (
              <View style={styles.warnBox}>
                <Text style={{ color: theme.colors.statusWarning, fontSize: 12, fontWeight: "600" }}>
                  跨系统提示 ({preview.fromPlatform} → {preview.toPlatform})
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 4 }}>
                  包含 stdio 类型 MCP，不同系统的可执行文件路径或环境变量可能不同。点开下方「微调参数」可在写入前修改。
                </Text>
              </View>
            ) : null}

            <Text style={styles.label}>待迁移项目（共 {preview.items.length} 项）</Text>
            {preview.items.map((item) => {
              const isExpanded = expandedItem === item.name;
              const badgeColor =
                item.relation === "new"
                  ? theme.colors.statusSuccess
                  : item.relation === "diff"
                    ? theme.colors.statusWarning
                    : theme.colors.foregroundMuted;
              const badgeText =
                item.relation === "new"
                  ? "目标机新增"
                  : item.relation === "diff"
                    ? "与目标机配置不同"
                    : "与目标机一致";

              return (
                <View key={item.name} style={styles.card}>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{
                          color: theme.colors.foreground,
                          fontSize: 14,
                          fontWeight: "600",
                        }}
                      >
                        {item.name}
                      </Text>
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                        来源：{CLIENT_TARGET_META[item.sourceTarget].shortLabel} ·{" "}
                        {item.sourceConfig.type.toUpperCase()}
                        {item.targetExistingTargets.length > 0
                          ? ` · 目标机已有于 ${item.targetExistingTargets
                              .map((t) => CLIENT_TARGET_META[t].shortLabel)
                              .join("/")}`
                          : ""}
                      </Text>
                    </View>
                    <Text style={{ color: badgeColor, fontSize: 11, fontWeight: "600" }}>
                      {badgeText}
                    </Text>
                  </View>

                  {item.crossOsStdioWarning ? (
                    <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>
                      ⚠ stdio 跨系统迁移，请确认 command/args 在 {preview.toPlatform} 上可用
                    </Text>
                  ) : null}

                  <Pressable
                    onPress={() => setExpandedItem(isExpanded ? null : item.name)}
                    style={{ alignSelf: "flex-start" }}
                  >
                    <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>
                      {isExpanded ? "收起参数微调 ▲" : "写入前微调参数 (JSON) ▼"}
                    </Text>
                  </Pressable>

                  {isExpanded ? (
                    <TextInput
                      value={overrideJsonByName[item.name] ?? ""}
                      onChangeText={(txt) =>
                        setOverrideJsonByName((prev) => ({ ...prev, [item.name]: txt }))
                      }
                      style={styles.jsonBox}
                      multiline
                      autoCapitalize="none"
                    />
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}

        {execResult ? (
          <View style={styles.card}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
              迁移执行结果
            </Text>
            {execResult.results.map((r) => (
              <Text
                key={`${r.name}-${r.finalName}`}
                style={{
                  color:
                    r.status === "migrated"
                      ? theme.colors.statusSuccess
                      : r.status === "skipped"
                        ? theme.colors.foregroundMuted
                        : theme.colors.statusDanger,
                  fontSize: 12,
                }}
              >
                • {r.name}
                {r.finalName !== r.name ? ` → ${r.finalName}` : ""}：
                {r.status === "migrated"
                  ? `已写入 ${r.appliedTargets.map((t) => CLIENT_TARGET_META[t].shortLabel).join(", ")}`
                  : r.status === "skipped"
                    ? "已跳过（目标机已存在）"
                    : `失败：${r.error ?? "未知错误"}`}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.footer}>
          <Pressable
            onPress={() => onOpenChange(false)}
            style={[
              styles.btn,
              { backgroundColor: theme.colors.surface1, borderColor: theme.colors.border },
            ]}
          >
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>关闭</Text>
          </Pressable>
          <Pressable
            disabled={!preview || executing || loadingPreview}
            onPress={() => void handleExecute()}
            style={[
              styles.btn,
              {
                backgroundColor: theme.colors.accent,
                borderColor: theme.colors.accent,
                opacity: !preview || executing || loadingPreview ? 0.5 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: theme.colors.accentForeground,
                fontSize: 13,
                fontWeight: "600",
              }}
            >
              {executing
                ? "迁移中..."
                : `确认迁移到 ${toNode?.label ?? "目标机"}`}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
