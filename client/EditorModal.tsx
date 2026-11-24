import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import {
  McpServerConfigSchema,
  type ClientTarget,
  type McpServerConfig,
} from "../shared/contracts";
import {
  Button,
  FieldLabel,
  MONO_FONT,
  ModalFooter,
  Notice,
  Segmented,
  SwitchRow,
  TargetMultiSelect,
} from "./kit";

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

  const inputStyle = useMemo(
    () => ({
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface2,
      color: theme.colors.foreground,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: compact ? 11 : 9,
      fontSize: 13,
    }),
    [theme, compact],
  );
  const multilineStyle = useMemo(
    () => [inputStyle, { minHeight: 88, textAlignVertical: "top" as const, fontFamily: MONO_FONT, fontSize: 12 }],
    [inputStyle],
  );
  const jsonStyle = useMemo(
    () => [inputStyle, { minHeight: compact ? 220 : 260, textAlignVertical: "top" as const, fontFamily: MONO_FONT, fontSize: 12 }],
    [inputStyle, compact],
  );

  const field = { gap: 8 };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "create" ? `新增 MCP · ${hostLabel}` : `编辑 MCP · ${hostLabel}`}
      icon={
        <Icon
          name={mode === "create" ? "Plus" : "Pencil"}
          size={18}
          color={theme.colors.foreground}
        />
      }
    >
      <Modal.Content contentContainerStyle={{ padding: compact ? 16 : 20, gap: 16 }}>
        <View style={field}>
          <FieldLabel theme={theme} label="名称" />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="例如 github / filesystem / postgres"
            placeholderTextColor={theme.colors.foregroundMuted}
            style={inputStyle}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="MCP 名称"
          />
        </View>

        <View style={field}>
          <FieldLabel theme={theme} label="连接配置" />
          <Segmented
            theme={theme}
            compact={compact}
            value={editFormat}
            onChange={switchFormat}
            options={[
              { value: "form", label: "表单", icon: "ListChecks" },
              { value: "json", label: "JSON", icon: "Braces" },
            ]}
          />
        </View>

        {editFormat === "form" ? (
          <>
            <View style={field}>
              <FieldLabel theme={theme} label="传输类型" />
              <Segmented
                theme={theme}
                compact={compact}
                value={transport}
                onChange={setTransport}
                options={[
                  { value: "http", label: "HTTP", icon: "Globe" },
                  { value: "stdio", label: "stdio", icon: "Terminal" },
                ]}
              />
            </View>

            {transport === "http" ? (
              <>
                <View style={field}>
                  <FieldLabel theme={theme} label="服务 URL" />
                  <TextInput
                    value={url}
                    onChangeText={setUrl}
                    placeholder="https://example.com/mcp"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={inputStyle}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    accessibilityLabel="服务 URL"
                  />
                </View>
                <View style={field}>
                  <FieldLabel theme={theme} label="Headers" hint="每行一个 KEY=VALUE" />
                  <TextInput
                    value={headersText}
                    onChangeText={setHeadersText}
                    placeholder={"Authorization=Bearer xxx\nX-Custom-Header=value"}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={multilineStyle}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="HTTP Headers"
                  />
                </View>
              </>
            ) : (
              <>
                <View style={field}>
                  <FieldLabel theme={theme} label="命令 command" />
                  <TextInput
                    value={command}
                    onChangeText={setCommand}
                    placeholder="npx / uvx / node / /usr/local/bin/..."
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={[inputStyle, { fontFamily: MONO_FONT }]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="可执行命令"
                  />
                </View>
                <View style={field}>
                  <FieldLabel theme={theme} label="参数 args" hint="每行一个参数，不会按空格拆分" />
                  <TextInput
                    value={argsText}
                    onChangeText={setArgsText}
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/path"}
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={multilineStyle}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="参数 args"
                  />
                </View>
                <View style={field}>
                  <FieldLabel theme={theme} label="环境变量 env" hint="每行一个 KEY=VALUE" />
                  <TextInput
                    value={envText}
                    onChangeText={setEnvText}
                    placeholder="API_TOKEN=xxx"
                    placeholderTextColor={theme.colors.foregroundMuted}
                    style={multilineStyle}
                    multiline
                    autoCapitalize="none"
                    autoCorrect={false}
                    accessibilityLabel="环境变量 env"
                  />
                </View>
              </>
            )}
          </>
        ) : (
          <View style={field}>
            <FieldLabel
              theme={theme}
              label="单个服务的配置 JSON"
              hint="支持标准 http（url / headers）或 stdio（command / args / env）结构"
            />
            <TextInput
              value={jsonText}
              onChangeText={setJsonText}
              placeholder='{"type":"http","url":"https://...","headers":{}}'
              placeholderTextColor={theme.colors.foregroundMuted}
              style={jsonStyle}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="配置 JSON"
            />
          </View>
        )}

        <TargetMultiSelect
          theme={theme}
          compact={compact}
          label="写入到客户端"
          hint="写入前会在原文件旁自动备份 .mcp-center.bak"
          value={targets}
          onChange={setTargets}
        />

        <SwitchRow
          theme={theme}
          label="保存后立即启用"
          hint="关闭时仍保留完整定义（Codex 写 enabled=false，JSON 客户端暂存于插件停用库）"
          value={enabled}
          onValueChange={setEnabled}
        />

        {errorText ? <Notice theme={theme} tone="danger" message={errorText} /> : null}

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
            label={mode === "create" ? "创建" : "保存"}
            grow={compact}
            loading={saving}
            onPress={() => void handleSubmit()}
          />
        </ModalFooter>
      </Modal.Content>
    </Modal>
  );
}
