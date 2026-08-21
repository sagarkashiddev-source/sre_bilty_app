import React, { useState } from "react";
import { View, Text, FlatList, TouchableOpacity, Modal, ScrollView } from "react-native";
import { useAppData } from "../store/AppDataContext";
import { colors, spacing, radius } from "../theme";
import { Card, EmptyState, Field, Input, Button } from "../components/ui";
import { uid } from "../services/adapters";

function emptyCompany() { return { id: uid(), name: "", gstin: "", address: "", mobile: "", email: "", bankName: "", accountNo: "", ifsc: "", branch: "" }; }

export default function CompaniesScreen() {
  const { companies, activeCompanyId, setActiveCompanyId, saveCompany, removeCompany } = useAppData();
  const [editing, setEditing] = useState(null);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md }}>
        <Text style={{ fontSize: 22, fontWeight: "800" }}>My Companies</Text>
        <Button title="+ Add" onPress={() => setEditing(emptyCompany())} style={{ paddingHorizontal: 16, minHeight: 38 }} />
      </View>
      <FlatList
        data={companies}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<Card><EmptyState title="No companies yet" subtitle="Add your company to start creating invoices." /></Card>}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm, borderWidth: item.id === activeCompanyId ? 2 : 0, borderColor: colors.accent }}>
            <Text style={{ fontWeight: "700" }}>{item.name}</Text>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>GSTIN: {item.gstin || "—"}</Text>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{item.address || "—"}</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.sm }}>
              {item.id !== activeCompanyId && <Chip label="Set active" onPress={() => setActiveCompanyId(item.id)} />}
              <Chip label="Edit" onPress={() => setEditing(item)} />
            </View>
          </Card>
        )}
      />
      <CompanyModal visible={!!editing} company={editing} onClose={() => setEditing(null)}
        onSave={async (c) => { await saveCompany(c); setEditing(null); }} />
    </View>
  );
}

function CompanyModal({ visible, company, onClose, onSave }) {
  const [c, setC] = useState(company);
  React.useEffect(() => setC(company), [company]);
  if (!c) return null;
  const patch = (x) => setC({ ...c, ...x });
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 60 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", marginBottom: spacing.md }}>{company?.name ? "Edit company" : "New company"}</Text>
        <Field label="Company name"><Input value={c.name} onChangeText={(v) => patch({ name: v })} /></Field>
        <Field label="GSTIN"><Input value={c.gstin} onChangeText={(v) => patch({ gstin: v.toUpperCase() })} autoCapitalize="characters" /></Field>
        <Field label="Address"><Input value={c.address} onChangeText={(v) => patch({ address: v })} multiline /></Field>
        <Field label="Mobile"><Input value={c.mobile} onChangeText={(v) => patch({ mobile: v })} keyboardType="phone-pad" /></Field>
        <Field label="Email"><Input value={c.email} onChangeText={(v) => patch({ email: v })} keyboardType="email-address" autoCapitalize="none" /></Field>
        <Field label="Bank name"><Input value={c.bankName} onChangeText={(v) => patch({ bankName: v })} /></Field>
        <Field label="Account number"><Input value={c.accountNo} onChangeText={(v) => patch({ accountNo: v })} /></Field>
        <Field label="IFSC"><Input value={c.ifsc} onChangeText={(v) => patch({ ifsc: v.toUpperCase() })} autoCapitalize="characters" /></Field>
        <Field label="Branch"><Input value={c.branch} onChangeText={(v) => patch({ branch: v })} /></Field>
        <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.md }}>
          <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Save" onPress={() => onSave(c)} disabled={!c.name} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </Modal>
  );
}

function Chip({ label, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: "#F1EFE8" }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: colors.ink }}>{label}</Text>
    </TouchableOpacity>
  );
}
