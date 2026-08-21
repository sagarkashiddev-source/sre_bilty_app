import React, { useMemo, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, Alert, RefreshControl } from "react-native";
import { useAppData } from "../store/AppDataContext";
import { colors, spacing, radius } from "../theme";
import { Card, StatusBadge, EmptyState, Input } from "../components/ui";
import { computeInvoice, fromPaise, fmt } from "../services/money";

export default function InvoiceListScreen({ navigation }) {
  const { invoices, customers, companyById, activeCompanyId, cancelInvoice, duplicateInvoice, removeInvoice, loadEverything } = useAppData();
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const list = useMemo(() => {
    const scoped = invoices.filter((i) => !activeCompanyId || i.companyId === activeCompanyId);
    const q = search.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((i) => (i.invoiceNo || "").toLowerCase().includes(q) || (i.customerSnapshot?.name || "").toLowerCase().includes(q));
  }, [invoices, activeCompanyId, search]);

  const onRefresh = async () => { setRefreshing(true); await loadEverything(); setRefreshing(false); };

  const onCancel = (inv) => {
    Alert.alert("Cancel invoice", `Cancel ${inv.invoiceNo}? It will stay in history for your records, but can no longer be edited.`, [
      { text: "Keep it", style: "cancel" },
      { text: "Cancel invoice", style: "destructive", onPress: () => cancelInvoice(inv.id).catch((e) => Alert.alert("Couldn't cancel", e.message)) },
    ]);
  };
  const onDuplicate = async (inv) => {
    try {
      const created = await duplicateInvoice(inv.id);
      navigation.navigate("InvoiceForm", { invoiceId: created.id });
    } catch (e) { Alert.alert("Couldn't duplicate", e.message); }
  };
  const onRemove = (inv) => {
    Alert.alert(
      "Remove invoice",
      inv.finalized ? "This invoice is finalized. Removing it is permanent and it will no longer show in your active list." : "Delete this draft invoice permanently?",
      [{ text: "Cancel", style: "cancel" }, { text: "Remove", style: "destructive", onPress: () => removeInvoice(inv.id).catch((e) => Alert.alert("Couldn't remove", e.message)) }]
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg }}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink, marginBottom: spacing.md }}>Invoice History</Text>
      <Input placeholder="Search invoice # or customer…" value={search} onChangeText={setSearch} style={{ marginBottom: spacing.md }} />

      <FlatList
        data={list}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={<Card><EmptyState title="No invoices found" subtitle="Try a different search, or create your first invoice." /></Card>}
        renderItem={({ item: inv }) => {
          const company = companyById(inv.companyId);
          const customer = customers.find((c) => c.id === inv.customerId);
          const computed = computeInvoice(inv.items, company, customer || inv.customerSnapshot);
          const locked = inv.finalized;
          return (
            <Card style={{ marginBottom: spacing.sm }}>
              <TouchableOpacity onPress={() => navigation.navigate("InvoicePreview", { invoiceId: inv.id })}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <View>
                    <Text style={{ fontWeight: "700", color: colors.ink }}>{inv.invoiceNo} {locked ? "🔒" : ""}</Text>
                    <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{inv.customerSnapshot?.name || inv.customerName || "—"} · {inv.invoiceDate}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontWeight: "700" }}>₹{fmt(fromPaise(computed.grandTotalPaise))}</Text>
                    <View style={{ marginTop: 4 }}><StatusBadge status={inv.status} /></View>
                  </View>
                </View>
              </TouchableOpacity>
              <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.sm, flexWrap: "wrap" }}>
                <ActionChip label="View" onPress={() => navigation.navigate("InvoicePreview", { invoiceId: inv.id })} />
                {!locked && <ActionChip label="Edit" onPress={() => navigation.navigate("InvoiceForm", { invoiceId: inv.id })} />}
                <ActionChip label="Duplicate & Correct" onPress={() => onDuplicate(inv)} />
                {locked && inv.status !== "cancelled" && <ActionChip label="Cancel" tone="danger" onPress={() => onCancel(inv)} />}
                <ActionChip label="Remove" tone="danger" onPress={() => onRemove(inv)} />
              </View>
            </Card>
          );
        }}
      />
    </View>
  );
}

function ActionChip({ label, onPress, tone }) {
  return (
    <TouchableOpacity onPress={onPress} style={{
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill,
      backgroundColor: tone === "danger" ? colors.dangerBg : "#F1EFE8",
    }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: tone === "danger" ? colors.danger : colors.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}
