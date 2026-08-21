import React from "react";
import { View, Text, TouchableOpacity, ScrollView, Alert } from "react-native";
import { useAppData } from "../store/AppDataContext";
import * as api from "../services/api";
import { colors, spacing, radius } from "../theme";
import { Card } from "../components/ui";

export default function MoreScreen({ navigation }) {
  const { authUser, setAuthUser } = useAppData();

  const doLogout = () => {
    Alert.alert("Log out", "You'll need to log in again to access your invoices.", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: async () => { await api.logout(); setAuthUser(null); } },
    ]);
  };

  const items = [
    { label: "My Companies", screen: "Companies", sub: "Manage company profiles and bank details" },
    { label: "Customers", screen: "Customers", sub: "Manage your customer directory" },
    { label: "Products", screen: "Products", sub: "Manage your item/service catalog" },
    { label: "Payments", screen: "Payments", sub: "Record and review payments" },
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}>
      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: spacing.lg }}>More</Text>
      {items.map((it) => (
        <TouchableOpacity key={it.screen} onPress={() => navigation.navigate(it.screen)}>
          <Card style={{ marginBottom: spacing.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <View>
              <Text style={{ fontWeight: "700" }}>{it.label}</Text>
              <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{it.sub}</Text>
            </View>
            <Text style={{ color: colors.accent, fontSize: 18 }}>›</Text>
          </Card>
        </TouchableOpacity>
      ))}

      <View style={{ marginTop: spacing.xl, alignItems: "center" }}>
        <Text style={{ color: colors.inkSoft, marginBottom: spacing.sm }}>{authUser?.email}</Text>
        <TouchableOpacity onPress={doLogout} style={{ paddingVertical: 10, paddingHorizontal: 20, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border }}>
          <Text style={{ color: colors.danger, fontWeight: "700" }}>Log out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
