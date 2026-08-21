import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, TouchableOpacity, Alert, Modal, FlatList } from "react-native";
import { useAppData } from "../store/AppDataContext";
import { colors, spacing, radius } from "../theme";
import { Field, Input, Button, Card } from "../components/ui";
import { computeInvoice, fromPaise, fmt } from "../services/money";
import { uid, todayISO } from "../services/adapters";

function emptyDraft(companyId) {
  return {
    id: uid(), companyId: companyId || "", customerId: "",
    customerSnapshot: { name: "", phone: "", gstin: "", billingAddress: "", shippingAddress: "", state: "" },
    invoiceNo: "(assigned on save)", invoiceDate: todayISO(), items: [], notes: "", status: "draft", finalized: false,
  };
}

export default function InvoiceFormScreen({ route, navigation }) {
  const { invoiceId, companyId } = route.params || {};
  const { companies, customers, products, invoices, companyById, saveInvoice, finalizeInvoice, activeCompanyId } = useAppData();

  const existing = invoiceId ? invoices.find((i) => i.id === invoiceId) : null;
  const [draft, setDraft] = useState(() => existing ? { ...existing } : emptyDraft(companyId || activeCompanyId || companies[0]?.id));
  const [customerPicker, setCustomerPicker] = useState(false);
  const [productPicker, setProductPicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const locked = draft.finalized;
  const company = companyById(draft.companyId);
  const companyCustomers = customers.filter((c) => c.companyId === draft.companyId);
  const companyProducts = products.filter((p) => p.companyId === draft.companyId);
  const customer = customers.find((c) => c.id === draft.customerId);

  const computed = useMemo(() => computeInvoice(draft.items, company, customer || draft.customerSnapshot), [draft.items, company, customer, draft.customerSnapshot]);

  useEffect(() => {
    navigation.setOptions({ title: existing ? `Edit ${existing.invoiceNo}` : "New Invoice" });
  }, [existing]);

  const patch = (x) => setDraft((d) => ({ ...d, ...x }));

  const pickCustomer = (c) => {
    patch({
      customerId: c.id,
      customerSnapshot: { name: c.name, phone: c.phone, gstin: c.gstin, billingAddress: c.billingAddress, shippingAddress: c.shippingAddress, state: c.state },
    });
    setCustomerPicker(false);
  };

  const addBlankItem = () => patch({ items: [...draft.items, { id: uid(), description: "", hsn: "", qty: 1, rate: "", taxRate: 18 }] });
  const addFromProduct = (p) => {
    patch({ items: [...draft.items, { id: uid(), productId: p.id, description: p.description || p.name, hsn: p.hsn || "", qty: 1, rate: p.rate, taxRate: p.taxRate }] });
    setProductPicker(false);
  };
  const updateItem = (id, x) => patch({ items: draft.items.map((it) => (it.id === id ? { ...it, ...x } : it)) });
  const removeItem = (id) => patch({ items: draft.items.filter((it) => it.id !== id) });

  const validate = () => {
    if (!draft.companyId) return "Select a company first.";
    if (!draft.customerSnapshot?.name) return "Add a customer.";
    if (!draft.items.length) return "Add at least one line item.";
    if (draft.items.some((it) => !it.description || !it.qty || Number(it.qty) <= 0)) return "Every item needs a description and a quantity greater than zero.";
    return "";
  };

  const doSave = async (finalize) => {
    const problem = validate();
    if (problem) { setErr(problem); return; }
    setErr(""); setSaving(true);
    try {
      const saved = finalize ? await finalizeInvoice(draft) : await saveInvoice(draft);
      navigation.replace("InvoicePreview", { invoiceId: saved.id });
    } catch (e) {
      setErr(e.message || "Unable to save the invoice. Please retry.");
    } finally {
      setSaving(false);
    }
  };

  if (!companies.length) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl }}><Text>Add a company first (More → My Companies).</Text></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}>
        {locked ? <Banner>🔒 Finalized invoice — locked. Use Duplicate &amp; Correct from History to make changes.</Banner> : null}
        {err ? <Banner tone="danger">{err}</Banner> : null}

        <Card style={{ marginBottom: spacing.md }}>
          <Field label="Company">
            <TouchableOpacity disabled={locked} style={pickerStyle} onPress={() => {
              if (companies.length <= 1) return;
              Alert.alert("Select company", "", companies.map((c) => ({ text: c.name, onPress: () => patch({ companyId: c.id }) })).concat([{ text: "Cancel", style: "cancel" }]));
            }}>
              <Text>{company?.name || "Select a company"}</Text>
            </TouchableOpacity>
          </Field>
          <Field label="Invoice date">
            <Input value={draft.invoiceDate} onChangeText={(v) => patch({ invoiceDate: v })} placeholder="YYYY-MM-DD" editable={!locked} />
          </Field>
          <Field label="Invoice number" hint="Assigned automatically by the server when you save — guaranteed unique, no duplicates.">
            <Input value={draft.invoiceNo} editable={false} />
          </Field>
        </Card>

        <Card style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm }}>
            <Text style={{ fontWeight: "700" }}>Customer</Text>
            {!locked && <TouchableOpacity onPress={() => setCustomerPicker(true)}><Text style={{ color: colors.accent, fontWeight: "600" }}>Change</Text></TouchableOpacity>}
          </View>
          {draft.customerSnapshot?.name ? (
            <View>
              <Text style={{ fontWeight: "600" }}>{draft.customerSnapshot.name}</Text>
              <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{draft.customerSnapshot.billingAddress}</Text>
              <Text style={{ color: colors.inkSoft, fontSize: 13 }}>GSTIN: {draft.customerSnapshot.gstin || "—"}</Text>
            </View>
          ) : (
            <Button title="+ Select customer" variant="ghost" onPress={() => setCustomerPicker(true)} disabled={locked} />
          )}
        </Card>

        <Card style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm }}>
            <Text style={{ fontWeight: "700" }}>Line items</Text>
            {!locked && (
              <View style={{ flexDirection: "row", gap: 8 }}>
                {companyProducts.length > 0 && <TouchableOpacity onPress={() => setProductPicker(true)}><Text style={{ color: colors.accent, fontWeight: "600" }}>From catalog</Text></TouchableOpacity>}
                <TouchableOpacity onPress={addBlankItem}><Text style={{ color: colors.accent, fontWeight: "600" }}>+ Add</Text></TouchableOpacity>
              </View>
            )}
          </View>

          {draft.items.length === 0 ? <Text style={{ color: colors.inkSoft }}>No items yet.</Text> : null}
          {draft.items.map((it) => (
            <View key={it.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm }}>
              <Input placeholder="Description" value={it.description} onChangeText={(v) => updateItem(it.id, { description: v })} editable={!locked} style={{ marginBottom: 6 }} />
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
                <Input placeholder="HSN/SAC" value={it.hsn} onChangeText={(v) => updateItem(it.id, { hsn: v })} editable={!locked} style={{ flex: 1 }} />
                <Input placeholder="Qty" keyboardType="numeric" value={String(it.qty)} onChangeText={(v) => updateItem(it.id, { qty: v })} editable={!locked} style={{ flex: 1 }} />
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 6 }}>
                <Input placeholder="Rate ₹" keyboardType="numeric" value={String(it.rate)} onChangeText={(v) => updateItem(it.id, { rate: v })} editable={!locked} style={{ flex: 1 }} />
                <Input placeholder="GST %" keyboardType="numeric" value={String(it.taxRate)} onChangeText={(v) => updateItem(it.id, { taxRate: v })} editable={!locked} style={{ flex: 1 }} />
              </View>
              {!locked && <TouchableOpacity onPress={() => removeItem(it.id)}><Text style={{ color: colors.danger, fontSize: 12 }}>Remove item</Text></TouchableOpacity>}
            </View>
          ))}
        </Card>

        <Card style={{ marginBottom: spacing.md }}>
          <Field label="Notes"><Input multiline value={draft.notes} onChangeText={(v) => patch({ notes: v })} editable={!locked} /></Field>
        </Card>

        <Card>
          <Text style={{ fontWeight: "700", marginBottom: spacing.sm }}>Totals {computed.interstate ? "(Interstate — IGST)" : "(Intrastate — CGST+SGST)"}</Text>
          <TotalRow label="Subtotal" value={fromPaise(computed.subtotalPaise)} />
          {computed.interstate
            ? <TotalRow label="IGST" value={fromPaise(computed.igstPaise)} />
            : <>
                <TotalRow label="CGST" value={fromPaise(computed.cgstPaise)} />
                <TotalRow label="SGST" value={fromPaise(computed.sgstPaise)} />
              </>}
          <TotalRow label="Round off" value={fromPaise(computed.roundOffPaise)} />
          <TotalRow label="Grand Total" value={fromPaise(computed.grandTotalPaise)} bold />
        </Card>
      </ScrollView>

      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: colors.bg, padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border, flexDirection: "row", gap: 8 }}>
        <Button title="Save Draft" variant="ghost" onPress={() => doSave(false)} loading={saving} style={{ flex: 1 }} disabled={locked} />
        {!locked && <Button title="Finalize & Lock" onPress={() => doSave(true)} loading={saving} style={{ flex: 1 }} />}
      </View>

      <PickerModal visible={customerPicker} title="Select customer" onClose={() => setCustomerPicker(false)}
        data={companyCustomers} labelKey="name" onPick={pickCustomer}
        empty="No customers yet — add one from More → Customers." />
      <PickerModal visible={productPicker} title="Select product" onClose={() => setProductPicker(false)}
        data={companyProducts} labelKey="name" subKey={(p) => `₹${fmt(p.rate)} · ${p.taxRate}% GST`} onPick={addFromProduct}
        empty="No products in your catalog yet." />
    </View>
  );
}

function TotalRow({ label, value, bold }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: bold ? 1 : 0, borderColor: colors.border, marginTop: bold ? 6 : 0 }}>
      <Text style={{ fontWeight: bold ? "800" : "500", fontSize: bold ? 16 : 14 }}>{label}</Text>
      <Text style={{ fontWeight: bold ? "800" : "500", fontSize: bold ? 16 : 14 }}>₹{fmt(value)}</Text>
    </View>
  );
}

function Banner({ children, tone }) {
  return (
    <View style={{ backgroundColor: tone === "danger" ? colors.dangerBg : colors.infoBg, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md }}>
      <Text style={{ color: tone === "danger" ? colors.danger : colors.info }}>{children}</Text>
    </View>
  );
}

function PickerModal({ visible, title, onClose, data, labelKey, subKey, onPick, empty }) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 60, padding: spacing.lg }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.md }}>
          <Text style={{ fontSize: 18, fontWeight: "800" }}>{title}</Text>
          <TouchableOpacity onPress={onClose}><Text style={{ color: colors.accent, fontWeight: "600" }}>Close</Text></TouchableOpacity>
        </View>
        <FlatList
          data={data}
          keyExtractor={(x) => x.id}
          ListEmptyComponent={<Text style={{ color: colors.inkSoft }}>{empty}</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => onPick(item)} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: colors.border }}>
              <Text style={{ fontWeight: "600" }}>{item[labelKey]}</Text>
              {subKey ? <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{subKey(item)}</Text> : null}
            </TouchableOpacity>
          )}
        />
      </View>
    </Modal>
  );
}

const pickerStyle = { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: "#fff" };
