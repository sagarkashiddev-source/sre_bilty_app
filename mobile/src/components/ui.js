import React from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { colors, spacing, radius, shadow } from "../theme";

export function Field({ label, hint, children }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      {children}
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Input(props) {
  return <TextInput style={[s.input, props.multiline && { height: 80, textAlignVertical: "top" }]} placeholderTextColor={colors.inkSoft} {...props} />;
}

export function Button({ title, onPress, variant = "primary", disabled, loading, style }) {
  const bg = variant === "primary" ? colors.accent : variant === "danger" ? colors.dangerBg : "transparent";
  const fg = variant === "primary" ? "#fff" : variant === "danger" ? colors.danger : colors.ink;
  const border = variant === "ghost" ? { borderWidth: 1, borderColor: colors.border } : null;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[s.btn, { backgroundColor: bg, opacity: disabled ? 0.5 : 1 }, border, style]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: "700", fontSize: 15 }}>{title}</Text>}
    </TouchableOpacity>
  );
}

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function EmptyState({ title, subtitle }) {
  return (
    <View style={{ padding: spacing.xl, alignItems: "center" }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink, marginBottom: 4 }}>{title}</Text>
      {subtitle ? <Text style={{ color: colors.inkSoft, textAlign: "center" }}>{subtitle}</Text> : null}
    </View>
  );
}

const STATUS_STYLES = {
  draft: { bg: "#F1EFE8", fg: "#555" },
  sent: { bg: colors.infoBg, fg: colors.info },
  partial: { bg: colors.warningBg, fg: colors.warning },
  paid: { bg: colors.successBg, fg: colors.success },
  cancelled: { bg: colors.dangerBg, fg: colors.danger },
};
export function StatusBadge({ status }) {
  const st = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <View style={{ backgroundColor: st.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" }}>
      <Text style={{ color: st.fg, fontSize: 11, fontWeight: "700", textTransform: "uppercase" }}>{status}</Text>
    </View>
  );
}

export function Banner({ children, tone = "warning" }) {
  const map = { warning: [colors.warningBg, colors.warning], info: [colors.infoBg, colors.info], danger: [colors.dangerBg, colors.danger] };
  const [bg, fg] = map[tone] || map.warning;
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
      <Text style={{ color: fg, fontSize: 13 }}>{children}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: colors.ink, marginBottom: 6 },
  hint: { fontSize: 11, color: colors.inkSoft, marginTop: 4 },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 15, backgroundColor: "#fff", color: colors.ink,
  },
  btn: { borderRadius: radius.sm, paddingVertical: 13, alignItems: "center", justifyContent: "center", minHeight: 46 },
  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, ...shadow },
});
