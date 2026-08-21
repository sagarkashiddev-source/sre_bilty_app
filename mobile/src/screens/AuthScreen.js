import React, { useState } from "react";
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, Image } from "react-native";
import * as api from "../services/api";
import { colors, spacing } from "../theme";
import { Field, Input, Button } from "../components/ui";

export default function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError(""); setBusy(true);
    try {
      const user = mode === "login" ? await api.login(email.trim(), password) : await api.register(email.trim(), password);
      onAuthed(user);
    } catch (e) {
      setError(e.message || "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: spacing.xl }}>
        <View style={{ alignItems: "center", marginBottom: spacing.xl }}>
          <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
            <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800" }}>B</Text>
          </View>
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink }}>Bilty GST Invoice</Text>
          <Text style={{ color: colors.inkSoft, marginTop: 2 }}>{mode === "login" ? "Log in to your account" : "Create your account"}</Text>
        </View>

        <Field label="Email">
          <Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@company.com" />
        </Field>
        <Field label="Password" hint={mode === "register" ? "At least 8 characters" : undefined}>
          <Input secureTextEntry value={password} onChangeText={setPassword} placeholder="••••••••" />
        </Field>

        {error ? <Text style={{ color: colors.danger, marginBottom: spacing.md }}>{error}</Text> : null}

        <Button title={mode === "login" ? "Log in" : "Create account"} onPress={submit} loading={busy} disabled={!email || password.length < (mode === "register" ? 8 : 1)} />

        <Button
          title={mode === "login" ? "Need an account? Register" : "Already have an account? Log in"}
          variant="ghost" style={{ marginTop: spacing.md, backgroundColor: "transparent" }}
          onPress={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}
        />

        <Text style={{ color: colors.inkSoft, fontSize: 12, textAlign: "center", marginTop: spacing.xl }}>
          Uses the same account as the Bilty web app — your invoices stay in sync across devices.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
