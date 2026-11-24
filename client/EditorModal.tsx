import type { PluginTheme } from "@getpaseo/plugin";
import { Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import {
  CLIENT_TARGETS,
  CLIENT_TARGET_META,
  McpServerConfigSchema,
  type ClientTarget,
  type McpServerConfig,
} from "../shared/contracts";

interface EditorModalProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  theme: PluginTheme;
  compact: boolean;
  hostLabel: string;
  mode: "create" | "edit";
  initialName?: string;
  initialConfig?: McpServerConfig;
  initialEnabled?: boolean;
  initialTargets?: ClientTarget[];
  saving: boolean;
  onSave(payload: {
    name: string;
    previousName?: string;
    config: McpServerConfig;
    enabled: boolean;
    targets: ClientTarget[];
  }): Promise<void>;
}

function recordToLines(record?: Record<string, string>): string {
  if (!record) return "";
  return Object.entries(record)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

function linesToRecord(text: string): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf("=");
    const colon = line.indexOf(":");
    const idx = eq > 0 ? eq : colon > 0 ? colon : -1;
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function EditorModal({
  open,
  onOpenChange,
  theme,
  compact,
  hostLabel,
  mode,
  initialName,
  initialConfig,
  initialEnabled,
  initialTargets,
  saving,
  onSave,
}: EditorModalProps) {
  const toast = useToast();
  const [editFormat, setEditFormat] = useState<"form" | "json">("form");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [jsonText, setJsonText] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [targets, setTargets] = useState<ClientTarget[]>(["claude"]);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setErrorText(null);
    setEditFormat("form");
    setName(initialName ?? "");
    setEnabled(initialEnabled ?? true);
    setTargets(initialTargets && initialTargets.length > 0 ? [...initialTargets] : ["claude"]);

    if (initialConfig) {
      setTransport(initialConfig.type);
      if (initialConfig.type === "http") {
        setUrl(initialConfig.url);
        setHeadersText(recordToLines(initialConfig.headers));
        setCommand("");
        setArgsText("");
        setEnvText("");
      } else {
        setUrl("");
        setHeadersText("");
        setCommand(initialConfig.command);
        setArgsText((initialConfig.args ?? []).join("\n"));
        setEnvText(recordToLines(initialConfig.env));
      }
      setJsonText(JSON.stringify(initialConfig, null, 2));
    } else {
      setTransport("http");
      setUrl("");
      setHeadersText("");
      setCommand("");
      setArgsText("");
      setEnvText("");
      setJsonText(
        JSON.stringify(
          {
            type: "http",
            url: "https://example.com/mcp",
            headers: {},
          },
          null,
          2,
        ),
      );
    }
  }, [open, initialName, initialConfig, initialEnabled, initialTargets]);

  const styles = useMemo(
    () => ({
      section: { gap: 8 },
      label: { color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" as const },
      input: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
        color: theme.colors.foreground,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
      },
      multiline: {
        minHeight: 84,
        textAlignVertical: "top" as const,
      },
      jsonBox: {
        minHeight: 180,
        textAlignVertical: "top" as const,
        fontFamily: "monospace",
      },
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
      errorBox: {
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.statusDanger,
        backgroundColor: theme.colors.surface1,
      },
      errorText: { color: theme.colors.statusDanger, fontSize: 12 },
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
      hint: { color: theme.colors.foregroundMuted, fontSize: 11 },
    }),
    [theme],
  );

  function buildConfigFromForm(): McpServerConfig {
    if (transport === "http") {
      if (!url.trim()) throw new Error("请输入 HTTP MCP 的 URL");
      const headers = linesToRecord(headersText);
      return {
        type: "http",
        url: url.trim(),
        ...(headers ? { headers } : {}),
      };
    }
    if (!command.trim()) throw new Error("请输入 stdio MCP 的可执行命令");
    const args = argsText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const env = linesToRecord(envText);
    return {
      type: "stdio",
      command: command.trim(),
      ...(args.length > 0 ? { args } : {}),
      ...(env ? { env } : {}),
    };
  }

  function switchFormat(next: "form" | "json") {
    if (next === editFormat) return;
    setErrorText(null);
    if (next === "json") {
      try {
        const cfg = buildConfigFromForm();
        setJsonText(JSON.stringify(cfg, null, 2));
      } catch {
        // keep current jsonText
      }
      setEditFormat("json");
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      const normalized = normalizeRawJsonInput(parsed);
      setTransport(normalized.type);
      if (normalized.type === "http") {
        setUrl(normalized.url);
        setHeadersText(recordToLines(normalized.headers));
      } else {
        setCommand(normalized.command);
        setArgsText((normalized.args ?? []).join("\n"));
        setEnvText(recordToLines(normalized.env));
      }
      setEditFormat("form");
    } catch (error) {
      setErrorText(
        `JSON 无法切回表单：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function normalizeRawJsonInput(raw: unknown): McpServerConfig {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("JSON 必须是一个对象");
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.url === "string" && obj.url.trim()) {
      return McpServerConfigSchema.parse({
        type: "http",
        url: obj.url.trim(),
        headers: obj.headers,
        timeout: obj.timeout,
        transportType: obj.transportType,
        alwaysLoad: obj.alwaysLoad,
      });
    }
    if (typeof obj.command === "string" && obj.command.trim()) {
      return McpServerConfigSchema.parse({
        type: "stdio",
        command: obj.command.trim(),
        args: obj.args,
        env: obj.env,
        timeout: obj.timeout,
        alwaysLoad: obj.alwaysLoad,
      });
    }
    return McpServerConfigSchema.parse(obj);
  }

  function toggleTarget(target: ClientTarget) {
    setTargets((prev) =>
      prev.includes(target) ? prev.filter((t) => t !== target) : [...prev, target],
    );
  }

  async function handleSubmit() {
    setErrorText(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setErrorText("请填写 MCP 名称");
      return;
    }
    if (targets.length === 0) {
      setErrorText("至少选择一个写入目标客户端");
      return;
    }
    let config: McpServerConfig;
    try {
      config =
        editFormat === "form"
          ? buildConfigFromForm()
          : normalizeRawJsonInput(JSON.parse(jsonText));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
      return;
    }
    try {
      await onSave({
        name: trimmedName,
        previousName: mode === "edit" && initialName && initialName !== trimmedName ? initialName : undefined,
        config,
        enabled,
        targets,
      });
      toast.show(`已保存到 ${hostLabel}`, { variant: "success" });
      onOpenChange(false);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "create" ? `新增 MCP · ${hostLabel}` : `编辑 MCP · ${hostLabel}`}
    >
      <Modal.Content
        contentContainerStyle={{ padding: compact ? 16 : 20, gap: 14 }}
      >
        <View style={styles.section}>
          <Text style={styles.label}>MCP 名称</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="例如：tapd / gongfeng / langsmith"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={styles.input}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.row}>
          {(["form", "json"] as const).map((fmt) => {
            const active = editFormat === fmt;
            return (
              <Pressable
                key={fmt}
                onPress={() => switchFormat(fmt)}
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
                    fontWeight: "600",
                  }}
                >
                  {fmt === "form" ? "表单模式" : "JSON 模式"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {editFormat === "form" ? (
          <>
            <View style={styles.section}>
              <Text style={styles.label}>传输类型</Text>
              <View style={styles.row}>
                {(["http", "stdio"] as const).map((t) => {
                  const active = transport === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setTransport(t)}
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
                          fontWeight: "600",
                        }}
                      >
                        {t.toUpperCase()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {transport === "http" ? (
              <>
                <View style={styles.section}>
                  <Text style={styles.label}>服务 URL</Text>
                  <TextInput
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://..."
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.section}>
                  <Text style={styles.label}>HTTP Headers（每行一个 KEY=VALUE）</Text>
                  <TextInput
                    value={headersText}
                    onChangeText={setHeadersText}
                    placeholder={"Authorization=Bearer xxx\nX-Custom-Header=value"}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[styles.input, styles.multiline]}
                    multiline
                    autoCapitalize="none"
                  />
                </View>
              </>
            ) : (
              <>
                <View style={styles.section}>
                  <Text style={styles.label}>可执行命令 (command)</Text>
                  <TextInput
                    value={command}
                    onChangeText={setCommand}
                    placeholder="例如：npx / uvx / node / /usr/local/bin/..."
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={styles.input}
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.section}>
                  <Text style={styles.label}>参数 args（每行一个参数，不按空格拆）</Text>
                  <TextInput
                    value={argsText}
                    onChangeText={setArgsText}
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path"}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[styles.input, styles.multiline]}
                    multiline
                    autoCapitalize="none"
                  />
                </View>
                <View style={styles.section}>
                  <Text style={styles.label}>环境变量 env（每行一个 KEY=VALUE）</Text>
                  <TextInput
                    value={envText}
                    onChangeText={setEnvText}
                    placeholder="API_TOKEN=xxx"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[styles.input, styles.multiline]}
                    multiline
                    autoCapitalize="none"
                  />
                </View>
              </>
            )}
          </>
        ) : (
          <View style={styles.section}>
            <Text style={styles.label}>单服务配置 JSON（支持标准 http 或 stdio 结构）</Text>
            <TextInput
              value={jsonText}
              onChangeText={setJsonText}
              placeholder='{"type":"http","url":"https://...","headers":{}}'
              placeholderTextColor={theme.colors.foregroundMuted}
              style={[styles.input, styles.jsonBox]}
              multiline
              autoCapitalize="none"
            />
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>写入到以下客户端（可多选，写入前自动备份 .bak）</Text>
          <View style={styles.row}>
            {(() => {
              const allSelected = targets.length === CLIENT_TARGETS.length;
              return (
                <Pressable
                  onPress={() => setTargets(allSelected ? [] : [...CLIENT_TARGETS])}
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
              const selected = targets.includes(target);
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

        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingVertical: 4,
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
              保存后立即启用
            </Text>
            <Text style={styles.hint}>
              关闭时仍会保留完整定义（Codex 写 enabled=false，JSON 客户端暂存于插件禁用库）
            </Text>
          </View>
          <Switch value={enabled} onValueChange={setEnabled} />
        </View>

        {errorText ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{errorText}</Text>
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
            <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>取消</Text>
          </Pressable>
          <Pressable
            disabled={saving}
            onPress={() => void handleSubmit()}
            style={[
              styles.btn,
              {
                backgroundColor: theme.colors.accent,
                borderColor: theme.colors.accent,
                opacity: saving ? 0.6 : 1,
              },
            ]}
          >
            <Text style={{ color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" }}>
              {saving ? "保存中..." : "保存配置"}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}
