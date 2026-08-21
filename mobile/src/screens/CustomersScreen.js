import React, { useMemo, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, Alert, Modal, ScrollView } from "react-native";
import { useAppData } from "../store/AppDataContext";
import { colors, spacing, radius } from "../theme";
import { Card, EmptyState, Field, Input, Button } from "../components/ui";
import { uid } from "../services/adapters";

function emptyCustomer(companyId) { return { id: uid(), companyId, name: "", phone: "", gstin: "", billingAddress: "", shippingAddress: "", state: "" }; }

export default function CustomersScreen() {
  const { customers, companies, activeCompanyId, saveCustomer, removeCustomer } = useAppData();
  const [editing, setEditing] = useState(null);

  const list = useMemo(() => customers.filter((c) => !activeCompanyId || c.companyId === activeCompanyId), [customers, activeCompanyId]);

  const onRemove = (c) => {
    Alert.alert("Remove customer", `Remove ${c.name}? This won't affect their past invoices.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeCustomer(c.id).catch((e) => Alert.alert("Couldn't remove", e.message)) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md }}>
        <Text style={{ fontSize: 22, fontWeight: "800" }}>Customers</Text>
        <Button title="+ Add" onPress={() => setEditing(emptyCustomer(activeCompanyId || companies[0]?.id))} style={{ paddingHorizontal: 16, minHeight: 38 }} disabled={!companies.length} />
      </View>
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<Card><EmptyState title="No customers yet" subtitle="Add your first customer to speed up invoice creation." /></Card>}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Text style={{ fontWeight: "700" }}>{item.name}</Text>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{item.billingAddress || "—"}</Text>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>GSTIN: {item.gstin || "—"}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.sm }}>
              <Chip label="Edit" onPress={() => setEditing(item)} />
              <Chip label="Remove" tone="danger" onPress={() => onRemove(item)} />
            </View>
          </Card>
        )}
      />
      <CustomerModal visible={!!editing} customer={editing} onClose={() => setEditing(null)}
        onSave={async (c) => { await saveCustomer(c); setEditing(null); }} />
    </View>
  );
}

function CustomerModal({ visible, customer, onClose, onSave }) {
  const [c, setC] = useState(customer);
  React.useEffect(() => setC(customer), [customer]);
  if (!c) return null;
  const patch = (x) => setC({ ...c, ...x });
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 60 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", marginBottom: spacing.md }}>{customer?.name ? "Edit customer" : "New customer"}</Text>
        <Field label="Name"><Input value={c.name} onChangeText={(v) => patch({ name: v })} /></Field>
        <Field label="Phone"><Input value={c.phone} onChangeText={(v) => patch({ phone: v })} keyboardType="phone-pad" /></Field>
        <Field label="GSTIN"><Input value={c.gstin} onChangeText={(v) => patch({ gstin: v.toUpperCase() })} autoCapitalize="characters" /></Field>
        <Field label="Billing address"><Input value={c.billingAddress} onChangeText={(v) => patch({ billingAddress: v })} multiline /></Field>
        <Field label="Shipping address"><Input value={c.shippingAddress} onChangeText={(v) => patch({ shippingAddress: v })} multiline /></Field>
        <Field label="State"><Input value={c.state} onChangeText={(v) => patch({ state: v })} /></Field>
        <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.md }}>
          <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Save" onPress={() => onSave(c)} disabled={!c.name} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </Modal>
  );
}

function Chip({ label, onPress, tone }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: tone === "danger" ? colors.dangerBg : "#F1EFE8" }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: tone === "danger" ? colors.danger : colors.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}
