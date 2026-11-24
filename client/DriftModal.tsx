import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import {
  CLIENT_TARGETS,
  CLIENT_TARGET_META,
  fleetGetConfigRpc,
  fleetProbeRpc,
  fleetUpsertRpc,
  type AggregatedServer,
  type ClientTarget,
  type ProbeResult,
  type ServerTargetEntry,
} from "../shared/contracts";

interface DriftModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  compact: boolean;
  hostId: string;
  hostLabel: string;
  server: AggregatedServer | null;
  onAligned(): void;
}

interface VariantGroup {
  fingerprint: string;
  entries: ServerTargetEntry[];
  representative: ServerTargetEntry;
}

export function DriftModal({
  open,
  onOpenChange,
  theme,
  compact,
  hostId,
  hostLabel,
  server,
  onAligned,
}: DriftModalProps) {
  const toast = useToast();
  const getConfig = useRpc(fleetGetConfigRpc);
  const upsertServer = useRpc(fleetUpsertRpc);
  const probeServer = useRpc(fleetProbeRpc);

  const variants = useMemo<VariantGroup[]>(() => {
    if (!server) return [];
    const map = new Map<string, ServerTargetEntry[]>();
    for (const entry of server.entries) {
      const list = map.get(entry.fingerprint) ?? [];
      list.push(entry);
      map.set(entry.fingerprint, list);
    }
    return [...map.entries()]
      .map(([fingerprint, entries]) => ({
        fingerprint,
        entries,
        representative: entries.find((e) => e.enabled) ?? entries[0],
      }))
      .sort((a, b) => b.entries.length - a.entries.length);
  }, [server]);

  const [baselineFp, setBaselineFp] = useState<string>("");
  const [selectedTargets, setSelectedTargets] = useState<ClientTarget[]>([]);
  const [enableAfterAlign, setEnableAfterAlign] = useState(true);
  const [aligning, setAligning] = useState(false);
  const [probingFp, setProbingFp] = useState<string | null>(null);
  const [probeByFp, setProbeByFp] = useState<Record<string, ProbeResult>>({});

  function defaultTargetsForBaseline(fp: string): ClientTarget[] {
    if (!server) return [];
    return server.entries
      .filter((e) => e.fingerprint !== fp)
      .map((e) => e.target);
  }

  useEffect(() => {
    if (!open || !server || variants.length === 0) return;
    const initialFp = variants[0].fingerprint;
    setBaselineFp(initialFp);
    setSelectedTargets(defaultTargetsForBaseline(initialFp));
    setEnableAfterAlign(true);
    setProbeByFp({});
    setProbingFp(null);
  }, [open, server?.name, hostId]);

  const baselineGroup = variants.find((v) => v.fingerprint === baselineFp) ?? variants[0];

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
      card: {
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        backgroundColor: theme.colors.surface1,
        gap: 8,
      },
      chip: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
      },
      codeBox: {
        padding: 10,
        borderRadius: 8,
        backgroundColor: theme.colors.surface0,
        borderWidth: 1,
        borderColor: theme.colors.border,
        gap: 4,
      },
      smallBtn: {
        paddingHorizontal: 10,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
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

  function selectBaseline(fp: string) {
    setBaselineFp(fp);
    setSelectedTargets(defaultTargetsForBaseline(fp));
  }

  function toggleTarget(target: ClientTarget) {
    setSelectedTargets((prev) =>
      prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target],
    );
  }

  async function handleProbeVariant(group: VariantGroup) {
    if (!server) return;
    setProbingFp(group.fingerprint);
    try {
      const res = await probeServer({
        hostId,
        name: server.name,
        target: group.representative.target,
      });
      setProbeByFp((prev) => ({ ...prev, [group.fingerprint]: res }));
      toast.show(
        res.ok
          ? `方案 #${group.fingerprint.slice(0, 6)} 连通正常 (${res.latencyMs}ms, ${res.tools.length} 工具)`
          : `方案 #${group.fingerprint.slice(0, 6)} 探测失败：${res.error ?? "未知错误"}`,
        { variant: res.ok ? "success" : "error" },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setProbingFp(null);
    }
  }

  async function handleAlign() {
    if (!server || !baselineGroup) return;
    if (selectedTargets.length === 0) {
      toast.error("请至少选择一个需要对齐的目标客户端");
      return;
    }

    setAligning(true);
    try {
      const full = await getConfig({
        hostId,
        name: server.name,
        target: baselineGroup.representative.target,
      });
      const res = await upsertServer({
        hostId,
        name: server.name,
        config: full.config,
        enabled: enableAfterAlign,
        targets: selectedTargets,
      });
      toast.show(
        `已以 ${CLIENT_TARGET_META[baselineGroup.representative.target].shortLabel} 为基准，对齐 ${res.appliedTargets
          .map((t) => CLIENT_TARGET_META[t].shortLabel)
          .join("、")}`,
        { variant: res.warnings.length > 0 ? "warning" : "success" },
      );
      onAligned();
      onOpenChange(false);
    } catch (error) {
      toast.error(`对齐失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setAligning(false);
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={server ? `参数差异对比 · ${server.name} (${hostLabel})` : "参数差异对比"}
    >
      <Modal.Content contentContainerStyle={{ padding: compact ? 16 : 20, gap: 14 }}>
        {!server || variants.length === 0 ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            暂无可对比的客户端配置。
          </Text>
        ) : (
          <>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              检测到该 MCP 在本机存在 {variants.length} 套不同配置。可先分别「测活」确认哪套可用，再选中一套作为基准一键对齐到指定客户端（不想覆盖的客户端取消勾选即可）。
            </Text>

            {/* Variant Cards */}
            <View style={styles.section}>
              {variants.map((group, idx) => {
                const isBaseline = baselineGroup?.fingerprint === group.fingerprint;
                const cfg = group.representative.maskedConfig;
                const probeRes = probeByFp[group.fingerprint];
                const isProbing = probingFp === group.fingerprint;

                return (
                  <View
                    key={group.fingerprint}
                    style={[
                      styles.card,
                      {
                        borderColor: isBaseline ? theme.colors.accent : theme.colors.border,
                      },
                    ]}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <View style={styles.row}>
                        <Text
                          style={{
                            color: theme.colors.foreground,
                            fontSize: 14,
                            fontWeight: "700",
                          }}
                        >
                          方案 {idx + 1}
                        </Text>
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                          #{group.fingerprint.slice(0, 6)} · {cfg.type.toUpperCase()}
                        </Text>
                      </View>
                      <View style={styles.row}>
                        <Pressable
                          disabled={isProbing}
                          onPress={() => void handleProbeVariant(group)}
                          style={styles.smallBtn}
                        >
                          <Text style={{ color: theme.colors.foreground, fontSize: 11 }}>
                            {isProbing ? "探测中..." : "测活"}
                          </Text>
                        </Pressable>
                        <Pressable
                          onPress={() => selectBaseline(group.fingerprint)}
                          style={[
                            styles.smallBtn,
                            {
                              backgroundColor: isBaseline
                                ? theme.colors.accent
                                : theme.colors.surface0,
                              borderColor: isBaseline
                                ? theme.colors.accent
                                : theme.colors.border,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color: isBaseline
                                ? theme.colors.accentForeground
                                : theme.colors.foreground,
                              fontSize: 11,
                              fontWeight: "600",
                            }}
                          >
                            {isBaseline ? "✓ 当前基准" : "选为基准"}
                          </Text>
                        </Pressable>
                      </View>
                    </View>

                    {/* Clients using this variant */}
                    <View style={styles.row}>
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                        使用此方案的客户端：
                      </Text>
                      {group.entries.map((entry) => (
                        <View
                          key={entry.target}
                          style={{
                            paddingHorizontal: 7,
                            paddingVertical: 2,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderStyle: "solid",
                            borderColor: entry.enabled
                              ? theme.colors.statusSuccess
                              : theme.colors.foregroundMuted,
                            backgroundColor: theme.colors.surface2,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              fontWeight: "600",
                              color: entry.enabled
                                ? theme.colors.statusSuccess
                                : theme.colors.foregroundMuted,
                            }}
                          >
                            {entry.enabled ? "● " : "◐ "}
                            {CLIENT_TARGET_META[entry.target].shortLabel}
                            {entry.enabled ? "" : " (已关闭)"}
                          </Text>
                        </View>
                      ))}
                    </View>

                    {/* Masked Parameter Summary */}
                    <View style={styles.codeBox}>
                      {cfg.type === "http" ? (
                        <>
                          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                            URL: {cfg.url}
                          </Text>
                          {cfg.headers && Object.keys(cfg.headers).length > 0 ? (
                            Object.entries(cfg.headers).map(([k, v]) => (
                              <Text
                                key={k}
                                style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
                              >
                                Header · {k}: {v}
                              </Text>
                            ))
                          ) : (
                            <Text style={{ color: theme.colors.statusWarning, fontSize: 11 }}>
                              Header · (无)
                            </Text>
                          )}
                        </>
                      ) : (
                        <>
                          <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                            Command: {cfg.command}
                            {cfg.args?.length ? ` ${cfg.args.join(" ")}` : ""}
                          </Text>
                          {cfg.env && Object.keys(cfg.env).length > 0 ? (
                            Object.entries(cfg.env).map(([k, v]) => (
                              <Text
                                key={k}
                                style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}
                              >
                                Env · {k}={v}
                              </Text>
                            ))
                          ) : (
                            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
                              Env · (无)
                            </Text>
                          )}
                        </>
                      )}
                    </View>

                    {probeRes ? (
                      <Text
                        style={{
                          fontSize: 11,
                          fontWeight: "600",
                          color: probeRes.ok
                            ? theme.colors.statusSuccess
                            : theme.colors.statusDanger,
                        }}
                      >
                        {probeRes.ok
                          ? `✓ 连通正常 · ${probeRes.latencyMs}ms · ${probeRes.tools.length} 个工具`
                          : `✕ 探测失败 (${probeRes.latencyMs}ms)：${probeRes.error ?? "未知错误"}`}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>

            {/* Target selection for alignment */}
            {baselineGroup ? (
              <View style={[styles.card, { borderColor: theme.colors.border }]}>
                <Text style={styles.label}>
                  将基准方案（来自 {CLIENT_TARGET_META[baselineGroup.representative.target].shortLabel}）同步覆盖到以下客户端（自动备份 .bak）：
                </Text>
                <View style={styles.row}>
                  {(() => {
                    const allSelected = selectedTargets.length === CLIENT_TARGETS.length;
                    return (
                      <Pressable
                        onPress={() =>
                          setSelectedTargets(allSelected ? [] : [...CLIENT_TARGETS])
                        }
                        style={[
                          styles.chip,
                          {
                            backgroundColor: allSelected
                              ? theme.colors.accent
                              : theme.colors.surface0,
                            borderColor: allSelected
                              ? theme.colors.accent
                              : theme.colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: allSelected
                              ? theme.colors.accentForeground
                              : theme.colors.foreground,
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
                    const selected = selectedTargets.includes(target);
                    const sameAsBaseline = baselineGroup.entries.some((e) => e.target === target);
                    return (
                      <Pressable
                        key={target}
                        onPress={() => toggleTarget(target)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: selected
                              ? theme.colors.accent
                              : theme.colors.surface0,
                            borderColor: selected
                              ? theme.colors.accent
                              : theme.colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: selected
                              ? theme.colors.accentForeground
                              : theme.colors.foreground,
                            fontSize: 12,
                          }}
                        >
                          {selected ? "✓ " : ""}
                          {CLIENT_TARGET_META[target].shortLabel}
                          {sameAsBaseline ? " (基准)" : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingTop: 4,
                  }}
                >
                  <Text style={{ color: theme.colors.foreground, fontSize: 12 }}>
                    对齐后在已选客户端立即启用
                  </Text>
                  <Switch value={enableAfterAlign} onValueChange={setEnableAfterAlign} />
                </View>
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
                disabled={aligning || selectedTargets.length === 0}
                onPress={() => void handleAlign()}
                style={[
                  styles.btn,
                  {
                    backgroundColor: theme.colors.accent,
                    borderColor: theme.colors.accent,
                    opacity: aligning || selectedTargets.length === 0 ? 0.5 : 1,
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
                  {aligning
                    ? "对齐中..."
                    : `一键对齐到已选客户端 (${selectedTargets.length})`}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </Modal.Content>
    </Modal>
  );
}
