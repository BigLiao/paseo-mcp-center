import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, Modal, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  CLIENT_TARGET_META,
  fleetGetConfigRpc,
  fleetProbeRpc,
  fleetUpsertRpc,
  type AggregatedServer,
  type ClientTarget,
  type ProbeResult,
  type ServerTargetEntry,
} from "../shared/contracts";
import {
  Badge,
  Button,
  MONO_FONT,
  ModalFooter,
  Notice,
  SwitchRow,
  TargetMultiSelect,
} from "./kit";

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

  function selectBaseline(fp: string) {
    setBaselineFp(fp);
    setSelectedTargets(defaultTargetsForBaseline(fp));
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

  const c = theme.colors;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={server ? `参数对齐 · ${server.name}` : "参数对齐"}
      icon={<Icon name="GitCompareArrows" size={18} color={c.foreground} />}
    >
      <Modal.Content contentContainerStyle={{ padding: compact ? 16 : 20, gap: 16 }}>
        {!server || variants.length === 0 ? (
          <Text style={{ color: c.foregroundMuted, fontSize: 13 }}>暂无可对比的客户端配置。</Text>
        ) : (
          <>
            <Notice
              theme={theme}
              tone="info"
              title={`${hostLabel} 上有 ${variants.length} 套不同配置`}
              message="1. 可先「测活」确认哪套可用；2. 点选一套作为基准；3. 勾选要覆盖的客户端后一键对齐。"
            />

            {variants.map((group, idx) => {
              const isBaseline = baselineGroup?.fingerprint === group.fingerprint;
              const cfg = group.representative.maskedConfig;
              const probeRes = probeByFp[group.fingerprint];
              const isProbing = probingFp === group.fingerprint;
              const params: { k: string; v: string; warn?: boolean }[] =
                cfg.type === "http"
                  ? [
                      { k: "URL", v: cfg.url },
                      ...(cfg.headers && Object.keys(cfg.headers).length > 0
                        ? Object.entries(cfg.headers).map(([k, v]) => ({ k: `Header ${k}`, v }))
                        : [{ k: "Header", v: "（无）", warn: true }]),
                    ]
                  : [
                      {
                        k: "Command",
                        v: `${cfg.command}${cfg.args?.length ? ` ${cfg.args.join(" ")}` : ""}`,
                      },
                      ...(cfg.env && Object.keys(cfg.env).length > 0
                        ? Object.entries(cfg.env).map(([k, v]) => ({ k: `Env ${k}`, v }))
                        : [{ k: "Env", v: "（无）" }]),
                    ];

              return (
                <Pressable
                  key={group.fingerprint}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isBaseline }}
                  accessibilityLabel={`方案 ${idx + 1}${isBaseline ? "，当前基准" : "，点按设为基准"}`}
                  onPress={() => selectBaseline(group.fingerprint)}
                  style={({ pressed }) => ({
                    padding: compact ? 12 : 14,
                    gap: 10,
                    borderRadius: 12,
                    borderWidth: isBaseline ? 2 : 1,
                    borderColor: isBaseline ? c.accent : c.border,
                    backgroundColor: c.surface1,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Icon
                      name={isBaseline ? "CircleDot" : "Circle"}
                      size={18}
                      color={isBaseline ? c.accent : c.foregroundMuted}
                    />
                    <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "700" }}>
                      方案 {idx + 1}
                    </Text>
                    <Text style={{ color: c.foregroundMuted, fontSize: 11, fontFamily: MONO_FONT }}>
                      #{group.fingerprint.slice(0, 6)}
                    </Text>
                    {isBaseline ? <Badge theme={theme} tone="accent" label="基准" /> : null}
                    <View style={{ flex: 1 }} />
                    <Button
                      theme={theme}
                      compact={compact}
                      size="sm"
                      icon="Activity"
                      label="测活"
                      loading={isProbing}
                      onPress={() => void handleProbeVariant(group)}
                    />
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {group.entries.map((entry) => (
                      <Badge
                        key={entry.target}
                        theme={theme}
                        tone={entry.enabled ? "success" : "muted"}
                        icon={entry.enabled ? "CircleCheck" : "CirclePause"}
                        label={`${CLIENT_TARGET_META[entry.target].shortLabel}${
                          entry.enabled ? "" : "（已停用）"
                        }`}
                      />
                    ))}
                  </View>

                  <View
                    style={{
                      padding: 10,
                      gap: 4,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: c.border,
                      backgroundColor: c.surface0,
                    }}
                  >
                    {params.map((p) => (
                      <Text
                        key={p.k}
                        selectable
                        style={{
                          fontSize: 11,
                          lineHeight: 16,
                          fontFamily: MONO_FONT,
                          color: p.warn ? c.statusWarning : c.foregroundMuted,
                        }}
                      >
                        <Text style={{ color: c.foreground, fontWeight: "600" }}>{p.k}</Text>
                        {"  "}
                        {p.v}
                      </Text>
                    ))}
                  </View>

                  {probeRes ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Icon
                        name={probeRes.ok ? "CircleCheck" : "CircleX"}
                        size={14}
                        color={probeRes.ok ? c.statusSuccess : c.statusDanger}
                      />
                      <Text
                        selectable
                        style={{
                          flex: 1,
                          fontSize: 12,
                          color: probeRes.ok ? c.statusSuccess : c.statusDanger,
                        }}
                      >
                        {probeRes.ok
                          ? `连通正常 · ${probeRes.latencyMs}ms · ${probeRes.tools.length} 个工具`
                          : `探测失败（${probeRes.latencyMs}ms）：${probeRes.error ?? "未知错误"}`}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}

            {baselineGroup ? (
              <>
                <TargetMultiSelect
                  theme={theme}
                  compact={compact}
                  label={`用方案 ${variants.indexOf(baselineGroup) + 1} 覆盖这些客户端`}
                  hint={`基准取自 ${CLIENT_TARGET_META[baselineGroup.representative.target].shortLabel}，写入前自动备份 .bak`}
                  value={selectedTargets}
                  onChange={setSelectedTargets}
                  annotate={(target) =>
                    baselineGroup.entries.some((e) => e.target === target) ? "基准" : undefined
                  }
                />
                <SwitchRow
                  theme={theme}
                  label="对齐后立即启用"
                  value={enableAfterAlign}
                  onValueChange={setEnableAfterAlign}
                />
              </>
            ) : null}

            <ModalFooter>
              <Button
                theme={theme}
                compact={compact}
                label="取消"
                grow={compact}
                onPress={() => onOpenChange(false)}
              />
              <Button
                theme={theme}
                compact={compact}
                variant="primary"
                icon="Check"
                label={`对齐 ${selectedTargets.length} 个客户端`}
                grow={compact}
                loading={aligning}
                disabled={selectedTargets.length === 0}
                onPress={() => void handleAlign()}
              />
            </ModalFooter>
          </>
        )}
      </Modal.Content>
    </Modal>
  );
}
