import React, { useMemo, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, Alert, Modal, ScrollView } from "react-native";
import { useAppData } from "../store/AppDataContext";
import { colors, spacing, radius } from "../theme";
import { Card, EmptyState, Field, Input, Button } from "../components/ui";
import { fmt } from "../services/money";
import { uid } from "../services/adapters";

function emptyProduct(companyId) { return { id: uid(), companyId, name: "", description: "", hsn: "", unit: "Nos", rate: "", taxRate: "18" }; }

export default function ProductsScreen() {
  const { products, companies, activeCompanyId, saveProduct, removeProduct } = useAppData();
  const [editing, setEditing] = useState(null);

  const list = useMemo(() => products.filter((p) => !activeCompanyId || p.companyId === activeCompanyId), [products, activeCompanyId]);

  const onRemove = (p) => {
    Alert.alert("Remove product", `Remove ${p.name} from your catalog?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => removeProduct(p.id).catch((e) => Alert.alert("Couldn't remove", e.message)) },
    ]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md }}>
        <Text style={{ fontSize: 22, fontWeight: "800" }}>Products</Text>
        <Button title="+ Add" onPress={() => setEditing(emptyProduct(activeCompanyId || companies[0]?.id))} style={{ paddingHorizontal: 16, minHeight: 38 }} disabled={!companies.length} />
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Card><EmptyState title="No products yet" subtitle="Add frequently billed items to speed up invoice creation." /></Card>}
        renderItem={({ item }) => (
          <Card style={{ marginBottom: spacing.sm }}>
            <Text style={{ fontWeight: "700" }}>{item.name}</Text>
            <Text style={{ color: colors.inkSoft, fontSize: 13 }}>HSN/SAC {item.hsn || "—"} · ₹{fmt(item.rate)} / {item.unit} · GST {item.taxRate}%</Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.sm }}>
              <Chip label="Edit" onPress={() => setEditing(item)} />
              <Chip label="Remove" tone="danger" onPress={() => onRemove(item)} />
            </View>
          </Card>
        )}
      />
      <ProductModal visible={!!editing} product={editing} onClose={() => setEditing(null)}
        onSave={async (p) => { await saveProduct({ ...p, rate: Number(p.rate) || 0, taxRate: Number(p.taxRate) || 0 }); setEditing(null); }} />
    </View>
  );
}

function ProductModal({ visible, product, onClose, onSave }) {
  const [p, setP] = useState(product);
  React.useEffect(() => setP(product), [product]);
  if (!p) return null;
  const patch = (x) => setP({ ...p, ...x });
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 60 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", marginBottom: spacing.md }}>{product?.name ? "Edit product" : "New product"}</Text>
        <Field label="Name / description"><Input value={p.name} onChangeText={(v) => patch({ name: v })} /></Field>
        <Field label="HSN/SAC"><Input value={p.hsn} onChangeText={(v) => patch({ hsn: v })} /></Field>
        <Field label="Unit"><Input value={p.unit} onChangeText={(v) => patch({ unit: v })} /></Field>
        <Field label="Rate (₹)"><Input keyboardType="numeric" value={String(p.rate)} onChangeText={(v) => patch({ rate: v })} /></Field>
        <Field label="GST rate (%)"><Input keyboardType="numeric" value={String(p.taxRate)} onChangeText={(v) => patch({ taxRate: v })} /></Field>
        <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.md }}>
          <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Save" onPress={() => onSave(p)} disabled={!p.name} style={{ flex: 1 }} />
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
