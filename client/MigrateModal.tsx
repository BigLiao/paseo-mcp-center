import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import {
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
import {
  Badge,
  Button,
  Card,
  FieldLabel,
  HostChip,
  MONO_FONT,
  ModalFooter,
  Notice,
  Segmented,
  SwitchRow,
  TargetMultiSelect,
} from "./kit";

const CONFLICT_OPTIONS = [
  { value: "overwrite", label: "覆盖", hint: "目标机已有同名 MCP 时，用源配置覆盖。" },
  { value: "skip", label: "跳过", hint: "目标机已有同名 MCP 时保持不变，只迁移新增项。" },
  { value: "rename", label: "重命名", hint: "目标机已有同名 MCP 时，以 name-2 这类新名称写入。" },
] as const;

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

  const c = theme.colors;
  const conflictHint = CONFLICT_OPTIONS.find((o) => o.value === conflictMode)?.hint;
  const sameHost = fromHostId === toHostId;
  const done = execResult !== null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={items.length > 1 ? `迁移 ${items.length} 个 MCP` : `迁移 ${items[0]?.name ?? "MCP"}`}
      icon={<Icon name="ArrowRightLeft" size={18} color={c.foreground} />}
    >
      <Modal.Content contentContainerStyle={{ padding: compact ? 16 : 20, gap: 16 }}>
        {/* Route */}
        <View style={{ gap: 8 }}>
          <FieldLabel
            theme={theme}
            label="目标主机"
            hint={`源：${fromNode?.label ?? fromHostId}${
              fromNode?.inventory ? `（${fromNode.inventory.platform}）` : ""
            }。选择源主机本身即可在同机不同客户端之间复制。`}
          />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {onlineNodes.map((node) => (
              <HostChip
                key={node.hostId}
                theme={theme}
                compact={compact}
                node={node}
                selected={node.hostId === toHostId}
                meta={node.inventory?.platform}
                disabled={executing}
                onPress={() => {
                  setToHostId(node.hostId);
                  setExecResult(null);
                }}
              />
            ))}
          </View>
        </View>

        <TargetMultiSelect
          theme={theme}
          compact={compact}
          label={sameHost ? "复制到本机的客户端" : "写入目标主机的客户端"}
          value={targetClients}
          onChange={setTargetClients}
        />

        <View style={{ gap: 8 }}>
          <FieldLabel theme={theme} label="同名冲突时" hint={conflictHint} />
          <Segmented
            theme={theme}
            compact={compact}
            value={conflictMode}
            onChange={setConflictMode}
            options={CONFLICT_OPTIONS}
          />
        </View>

        <SwitchRow
          theme={theme}
          label="迁移后立即启用"
          value={enabledAfterMigrate}
          onValueChange={setEnabledAfterMigrate}
        />

        {/* Preview */}
        {loadingPreview ? (
          <View style={{ paddingVertical: 20, alignItems: "center", gap: 8 }}>
            <ActivityIndicator color={c.accent} />
            <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
              正在经 Relay 拉取配置并生成预览…
            </Text>
          </View>
        ) : null}

        {previewError ? (
          <Notice theme={theme} tone="danger" title="预览失败" message={previewError} />
        ) : null}

        {preview ? (
          <View style={{ gap: 10 }}>
            {preview.crossOs && preview.items.some((i) => i.crossOsStdioWarning) ? (
              <Notice
                theme={theme}
                tone="warning"
                title={`跨系统迁移（${preview.fromPlatform} → ${preview.toPlatform}）`}
                message="包含 stdio 类型 MCP，可执行文件路径或环境变量可能不同。可展开条目，在写入前微调参数。"
              />
            ) : null}

            <FieldLabel theme={theme} label={`待迁移（${preview.items.length}）`} />
            {preview.items.map((item) => {
              const isExpanded = expandedItem === item.name;
              const relation =
                item.relation === "new"
                  ? { tone: "success" as const, label: "新增" }
                  : item.relation === "diff"
                    ? { tone: "warning" as const, label: "配置不同" }
                    : { tone: "muted" as const, label: "已一致" };
              const result = execResult?.results.find((r) => r.name === item.name);

              return (
                <Card key={item.name} theme={theme} compact={compact} style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: c.foreground, fontSize: 14, fontWeight: "600", flexShrink: 1 }}
                    >
                      {item.name}
                    </Text>
                    <Badge theme={theme} label={item.sourceConfig.type.toUpperCase()} />
                    <View style={{ flex: 1 }} />
                    <Badge theme={theme} tone={relation.tone} label={relation.label} />
                  </View>
                  <Text style={{ color: c.foregroundMuted, fontSize: 12 }}>
                    来源 {CLIENT_TARGET_META[item.sourceTarget].shortLabel}
                    {item.targetExistingTargets.length > 0
                      ? ` · 目标机已存在于 ${item.targetExistingTargets
                          .map((t) => CLIENT_TARGET_META[t].shortLabel)
                          .join(" / ")}`
                      : ""}
                  </Text>

                  {item.crossOsStdioWarning ? (
                    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                      <Icon name="TriangleAlert" size={13} color={c.statusWarning} />
                      <Text style={{ color: c.statusWarning, fontSize: 12, flex: 1 }}>
                        请确认 command / args 在 {preview.toPlatform} 上可用
                      </Text>
                    </View>
                  ) : null}

                  {result ? (
                    <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                      <Icon
                        name={
                          result.status === "migrated"
                            ? "CircleCheck"
                            : result.status === "skipped"
                              ? "CircleMinus"
                              : "CircleX"
                        }
                        size={14}
                        color={
                          result.status === "migrated"
                            ? c.statusSuccess
                            : result.status === "skipped"
                              ? c.foregroundMuted
                              : c.statusDanger
                        }
                      />
                      <Text
                        selectable
                        style={{
                          flex: 1,
                          fontSize: 12,
                          color:
                            result.status === "error" ? c.statusDanger : c.foregroundMuted,
                        }}
                      >
                        {result.finalName !== result.name ? `→ ${result.finalName}，` : ""}
                        {result.status === "migrated"
                          ? `已写入 ${result.appliedTargets
                              .map((t) => CLIENT_TARGET_META[t].shortLabel)
                              .join("、")}`
                          : result.status === "skipped"
                            ? "已跳过（目标机已存在）"
                            : `失败：${result.error ?? "未知错误"}`}
                      </Text>
                    </View>
                  ) : null}

                  {!done ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: isExpanded }}
                      onPress={() => setExpandedItem(isExpanded ? null : item.name)}
                      hitSlop={6}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 4,
                        alignSelf: "flex-start",
                        minHeight: compact ? 32 : 24,
                      }}
                    >
                      <Icon name="Wrench" size={13} color={c.accent} />
                      <Text style={{ color: c.accent, fontSize: 12, fontWeight: "600" }}>
                        写入前微调参数
                      </Text>
                      <Icon
                        name={isExpanded ? "ChevronUp" : "ChevronDown"}
                        size={13}
                        color={c.accent}
                      />
                    </Pressable>
                  ) : null}

                  {isExpanded && !done ? (
                    <TextInput
                      value={overrideJsonByName[item.name] ?? ""}
                      onChangeText={(txt) =>
                        setOverrideJsonByName((prev) => ({ ...prev, [item.name]: txt }))
                      }
                      style={{
                        minHeight: 150,
                        borderWidth: 1,
                        borderColor: c.border,
                        backgroundColor: c.surface2,
                        color: c.foreground,
                        borderRadius: 8,
                        padding: 10,
                        fontSize: 12,
                        fontFamily: MONO_FONT,
                        textAlignVertical: "top",
                      }}
                      multiline
                      autoCapitalize="none"
                      autoCorrect={false}
                      accessibilityLabel={`${item.name} 配置 JSON`}
                    />
                  ) : null}
                </Card>
              );
            })}
          </View>
        ) : null}

        <ModalFooter>
          <Button
            theme={theme}
            compact={compact}
            label={done ? "关闭" : "取消"}
            grow={compact}
            onPress={() => onOpenChange(false)}
          />
          {done ? null : (
            <Button
              theme={theme}
              compact={compact}
              variant="primary"
              icon="ArrowRight"
              label={compact ? "确认迁移" : `迁移到 ${toNode?.label ?? "目标机"}`}
              grow={compact}
              loading={executing}
              disabled={!preview || loadingPreview || targetClients.length === 0}
              onPress={() => void handleExecute()}
            />
          )}
        </ModalFooter>
      </Modal.Content>
    </Modal>
  );
}
