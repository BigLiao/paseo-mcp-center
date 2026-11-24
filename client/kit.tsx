/**
 * Small, theme-driven UI primitives shared by the MCP Center screen and its modals.
 *
 * Follows the Paseo plugin UI contract:
 * - only React Native primitives (View / Text / Pressable) plus host UI from `@getpaseo/plugin/client/ui`
 * - every color comes from `theme.colors`, every size adapts to `layout.compact`
 * - icons are Lucide names drawn by the host `Icon`
 */
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Switch,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  CLIENT_TARGETS,
  CLIENT_TARGET_META,
  type ClientTarget,
  type FleetNode,
} from "../shared/contracts";

export type Tone = "default" | "accent" | "success" | "warning" | "danger" | "muted";

export const MONO_FONT = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
});

export function toneColor(theme: PluginTheme, tone: Tone): string {
  switch (tone) {
    case "accent":
      return theme.colors.accent;
    case "success":
      return theme.colors.statusSuccess;
    case "warning":
      return theme.colors.statusWarning;
    case "danger":
      return theme.colors.statusDanger;
    case "muted":
      return theme.colors.foregroundMuted;
    default:
      return theme.colors.foreground;
  }
}

/** Touch-friendly heights: compact (mobile / narrow) layouts get larger hit targets. */
export function controlHeight(compact: boolean, size: "sm" | "md" = "md"): number {
  if (size === "sm") return compact ? 34 : 28;
  return compact ? 42 : 34;
}

// ---------------------------------------------------------------------------
// Host status helpers
// ---------------------------------------------------------------------------

export function hostStatusColor(theme: PluginTheme, status: FleetNode["status"]): string {
  if (status === "online") return theme.colors.statusSuccess;
  if (status === "plugin_missing") return theme.colors.statusWarning;
  return theme.colors.statusDanger;
}

export function hostStatusLabel(status: FleetNode["status"]): string {
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

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "quiet";

export interface ButtonProps {
  theme: PluginTheme;
  compact: boolean;
  label?: string;
  icon?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  /** Stretch to share a row with sibling buttons. */
  grow?: boolean;
  accessibilityLabel?: string;
  onPress(): void;
}

export function Button({
  theme,
  compact,
  label,
  icon,
  variant = "secondary",
  size = "md",
  disabled,
  loading,
  grow,
  accessibilityLabel,
  onPress,
}: ButtonProps) {
  const height = controlHeight(compact, size);
  const c = theme.colors;
  const bg =
    variant === "primary"
      ? c.accent
      : variant === "ghost" || variant === "quiet"
        ? "transparent"
        : c.surface1;
  const border =
    variant === "primary"
      ? c.accent
      : variant === "danger"
        ? c.statusDanger
        : variant === "ghost" || variant === "quiet"
          ? "transparent"
          : c.border;
  const fg =
    variant === "primary"
      ? c.accentForeground
      : variant === "danger"
        ? c.statusDanger
        : variant === "quiet"
          ? c.foregroundMuted
          : c.foreground;
  const iconSize = size === "sm" ? 14 : 16;
  const inactive = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={compact ? 4 : 2}
      style={({ pressed }) => [
        {
          minHeight: height,
          minWidth: height,
          paddingHorizontal: label ? (size === "sm" ? 10 : 14) : 0,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: border,
          backgroundColor: bg,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        },
        grow ? { flexGrow: 1, flexBasis: 0 } : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={iconSize} color={fg} />
      ) : null}
      {label ? (
        <Text
          numberOfLines={1}
          style={{ color: fg, fontSize: size === "sm" ? 12 : 13, fontWeight: "600" }}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** A text-only inline action, e.g. "全选" next to a field label. */
export function LinkButton({
  theme,
  label,
  onPress,
  tone = "accent",
  disabled,
}: {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  tone?: Tone;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.6 : 1 })}
    >
      <Text style={{ color: toneColor(theme, tone), fontSize: 12, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Chips, segmented control, badges
// ---------------------------------------------------------------------------

export interface ChipProps {
  theme: PluginTheme;
  compact: boolean;
  label: string;
  selected?: boolean;
  icon?: string;
  /** Icon / border tone when not selected. */
  tone?: Tone;
  count?: number;
  leading?: ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress(): void;
}

export function Chip({
  theme,
  compact,
  label,
  selected,
  icon,
  tone,
  count,
  leading,
  disabled,
  accessibilityLabel,
  onPress,
}: ChipProps) {
  const c = theme.colors;
  const fg = selected ? c.accentForeground : c.foreground;
  const iconColor = selected ? c.accentForeground : tone ? toneColor(theme, tone) : c.foregroundMuted;
  const borderColor = selected
    ? c.accent
    : tone && tone !== "default" && tone !== "muted"
      ? toneColor(theme, tone)
      : c.border;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: compact ? 34 : 28,
        paddingHorizontal: compact ? 12 : 10,
        borderRadius: 999,
        borderWidth: 1,
        borderColor,
        backgroundColor: selected ? c.accent : c.surface1,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      {leading}
      {icon ? <Icon name={icon} size={13} color={iconColor} /> : null}
      <Text
        numberOfLines={1}
        style={{ color: fg, fontSize: 12, fontWeight: selected ? "600" : "500" }}
      >
        {label}
      </Text>
      {count !== undefined ? (
        <Text
          style={{
            color: selected ? c.accentForeground : c.foregroundMuted,
            fontSize: 11,
            fontWeight: "600",
            opacity: selected ? 0.85 : 1,
          }}
        >
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  icon?: string;
}

export function Segmented<V extends string>({
  theme,
  compact,
  options,
  value,
  onChange,
  grow = true,
}: {
  theme: PluginTheme;
  compact: boolean;
  options: readonly SegmentOption<NoInfer<V>>[];
  value: V;
  onChange(value: NoInfer<V>): void;
  grow?: boolean;
}) {
  const c = theme.colors;
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: "row",
        padding: 3,
        gap: 3,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: c.border,
        backgroundColor: c.surface1,
        alignSelf: grow ? "stretch" : "flex-start",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              {
                minHeight: compact ? 36 : 30,
                paddingHorizontal: 12,
                borderRadius: 7,
                borderWidth: 1,
                borderColor: active ? c.border : "transparent",
                backgroundColor: active ? c.surface2 : "transparent",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                opacity: pressed ? 0.7 : 1,
              },
              grow ? { flexGrow: 1, flexBasis: 0 } : null,
            ]}
          >
            {opt.icon ? (
              <Icon
                name={opt.icon}
                size={14}
                color={active ? c.foreground : c.foregroundMuted}
              />
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                color: active ? c.foreground : c.foregroundMuted,
                fontSize: 13,
                fontWeight: active ? "600" : "500",
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Badge({
  theme,
  label,
  tone = "muted",
  icon,
  onPress,
  accessibilityLabel,
}: {
  theme: PluginTheme;
  label: string;
  tone?: Tone;
  icon?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const color = toneColor(theme, tone);
  const outlined = tone !== "muted" && tone !== "default";
  const body = (
    <>
      {icon ? <Icon name={icon} size={11} color={color} /> : null}
      <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: "600" }}>
        {label}
      </Text>
      {onPress ? <Icon name="ChevronRight" size={11} color={color} /> : null}
    </>
  );
  const style: ViewStyle = {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    minHeight: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: outlined ? color : theme.colors.border,
    backgroundColor: theme.colors.surface2,
    alignSelf: "flex-start",
  };
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

export function StatusDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
  );
}

// ---------------------------------------------------------------------------
// Layout blocks
// ---------------------------------------------------------------------------

export function Card({
  theme,
  compact,
  children,
  style,
}: {
  theme: PluginTheme;
  compact: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          backgroundColor: theme.colors.surface1,
          borderWidth: 1,
          borderColor: theme.colors.border,
          borderRadius: 12,
          padding: compact ? 12 : 14,
          gap: 10,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Divider({ theme }: { theme: PluginTheme }) {
  return <View style={{ height: 1, backgroundColor: theme.colors.border }} />;
}

export function SectionHeader({
  theme,
  title,
  count,
  tone,
  icon,
  trailing,
}: {
  theme: PluginTheme;
  title: string;
  count?: number;
  tone?: Tone;
  icon?: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {icon ? (
        <Icon name={icon} size={15} color={tone ? toneColor(theme, tone) : theme.colors.foregroundMuted} />
      ) : tone ? (
        <StatusDot color={toneColor(theme, tone)} />
      ) : null}
      <Text
        numberOfLines={1}
        style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "700", flexShrink: 1 }}
      >
        {title}
      </Text>
      {count !== undefined ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600" }}>
          {count}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      {trailing}
    </View>
  );
}

const NOTICE_ICON: Record<"info" | "success" | "warning" | "danger", string> = {
  info: "Info",
  success: "CircleCheck",
  warning: "TriangleAlert",
  danger: "CircleX",
};

export function Notice({
  theme,
  tone,
  title,
  message,
  children,
}: {
  theme: PluginTheme;
  tone: "info" | "success" | "warning" | "danger";
  title?: string;
  message?: string;
  children?: ReactNode;
}) {
  const color = tone === "info" ? theme.colors.accent : toneColor(theme, tone);
  return (
    <View
      accessibilityRole={tone === "danger" ? "alert" : undefined}
      style={{
        flexDirection: "row",
        gap: 10,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: tone === "info" ? theme.colors.border : color,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ paddingTop: 1 }}>
        <Icon name={NOTICE_ICON[tone]} size={16} color={color} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        {title ? (
          <Text
            style={{
              color: tone === "info" ? theme.colors.foreground : color,
              fontSize: 13,
              fontWeight: "600",
            }}
          >
            {title}
          </Text>
        ) : null}
        {message ? (
          <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
            {message}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}

export function FieldLabel({
  theme,
  label,
  hint,
  trailing,
}: {
  theme: PluginTheme;
  label: string;
  hint?: string;
  trailing?: ReactNode;
}) {
  return (
    <View style={{ gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text
          style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600", flex: 1 }}
        >
          {label}
        </Text>
        {trailing}
      </View>
      {hint ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function SwitchRow({
  theme,
  label,
  hint,
  value,
  onValueChange,
}: {
  theme: PluginTheme;
  label: string;
  hint?: string;
  value: boolean;
  onValueChange(value: boolean): void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 2 }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
          {label}
        </Text>
        {hint ? (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, lineHeight: 16 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.colors.surface2, true: theme.colors.accent }}
        thumbColor={value ? theme.colors.accentForeground : theme.colors.foregroundMuted}
        // React Native Web paints the "on" thumb from this web-only prop (defaults to teal).
        {...({ activeThumbColor: theme.colors.accentForeground } as object)}
      />
    </View>
  );
}

export function Checkbox({ theme, checked }: { theme: PluginTheme; checked: boolean }) {
  return (
    <Icon
      name={checked ? "SquareCheckBig" : "Square"}
      size={20}
      color={checked ? theme.colors.accent : theme.colors.foregroundMuted}
    />
  );
}

/** Multi-select of client targets with an inline select-all / clear action. */
export function TargetMultiSelect({
  theme,
  compact,
  label,
  hint,
  value,
  onChange,
  annotate,
}: {
  theme: PluginTheme;
  compact: boolean;
  label: string;
  hint?: string;
  value: ClientTarget[];
  onChange(next: ClientTarget[]): void;
  annotate?: (target: ClientTarget) => string | undefined;
}) {
  const allSelected = value.length === CLIENT_TARGETS.length;
  return (
    <View style={{ gap: 8 }}>
      <FieldLabel
        theme={theme}
        label={`${label}（${value.length}/${CLIENT_TARGETS.length}）`}
        hint={hint}
        trailing={
          <LinkButton
            theme={theme}
            label={allSelected ? "清空" : "全选"}
            onPress={() => onChange(allSelected ? [] : [...CLIENT_TARGETS])}
          />
        }
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {CLIENT_TARGETS.map((target) => {
          const selected = value.includes(target);
          const note = annotate?.(target);
          return (
            <Chip
              key={target}
              theme={theme}
              compact={compact}
              selected={selected}
              icon={selected ? "Check" : "Plus"}
              label={`${CLIENT_TARGET_META[target].shortLabel}${note ? ` · ${note}` : ""}`}
              accessibilityLabel={`${CLIENT_TARGET_META[target].label}${selected ? "，已选" : ""}`}
              onPress={() =>
                onChange(selected ? value.filter((t) => t !== target) : [...value, target])
              }
            />
          );
        })}
      </View>
    </View>
  );
}

/** Host picker chip: status dot, label, platform. */
export function HostChip({
  theme,
  compact,
  node,
  selected,
  meta,
  disabled,
  onPress,
}: {
  theme: PluginTheme;
  compact: boolean;
  node: FleetNode;
  selected: boolean;
  meta?: string;
  disabled?: boolean;
  onPress(): void;
}) {
  const c = theme.colors;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={`${node.label}${node.isSelf ? "（本机）" : ""}，${hostStatusLabel(node.status)}`}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: compact ? 40 : 34,
        paddingHorizontal: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: selected ? c.accent : c.border,
        backgroundColor: selected ? c.surface2 : c.surface1,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
      })}
    >
      <StatusDot color={hostStatusColor(theme, node.status)} />
      <Text
        numberOfLines={1}
        style={{ color: c.foreground, fontSize: 13, fontWeight: selected ? "700" : "500" }}
      >
        {node.label}
      </Text>
      {node.isSelf ? (
        <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>本机</Text>
      ) : null}
      {meta ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{meta}</Text> : null}
    </Pressable>
  );
}

/** Modal footer: right-aligned on wide layouts, full-width shared row on compact ones. */
export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "flex-end",
        alignItems: "center",
        gap: 10,
        paddingTop: 4,
      }}
    >
      {children}
    </View>
  );
}
