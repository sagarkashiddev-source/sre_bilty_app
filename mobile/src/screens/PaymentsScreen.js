import React, { useMemo, useState } from "react";
import { View, Text, FlatList, TouchableOpacity, Alert, Modal, ScrollView } from "react-native";
import { useAppData } from "../store/AppDataContext";
import { colors, spacing } from "../theme";
import { Card, EmptyState, Field, Input, Button } from "../components/ui";
import { fmt } from "../services/money";

export default function PaymentsScreen() {
  const { payments, invoices, activeCompanyId, recordPayment } = useAppData();
  const [modalOpen, setModalOpen] = useState(false);

  const list = useMemo(() => payments.filter((p) => !activeCompanyId || p.companyId === activeCompanyId), [payments, activeCompanyId]);
  const billable = useMemo(() => invoices.filter((i) => i.finalized && i.status !== "cancelled" && (!activeCompanyId || i.companyId === activeCompanyId)), [invoices, activeCompanyId]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.lg }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md }}>
        <Text style={{ fontSize: 22, fontWeight: "800" }}>Payments</Text>
        <Button title="+ Record" onPress={() => setModalOpen(true)} style={{ paddingHorizontal: 16, minHeight: 38 }} disabled={!billable.length} />
      </View>
      <FlatList
        data={list}
        keyExtractor={(p) => p.id}
        ListEmptyComponent={<Card><EmptyState title="No payments recorded yet" subtitle="Record a payment against a finalized invoice to track what's outstanding." /></Card>}
        renderItem={({ item }) => {
          const inv = invoices.find((i) => i.id === item.invoiceId);
          return (
            <Card style={{ marginBottom: spacing.sm }}>
              <Text style={{ fontWeight: "700" }}>₹{fmt(item.amount)} — {inv?.invoiceNo || "—"}</Text>
              <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{item.method || "—"} · {item.paidOn}</Text>
            </Card>
          );
        }}
      />
      <RecordPaymentModal visible={modalOpen} invoices={billable} onClose={() => setModalOpen(false)}
        onSave={async (p) => { try { await recordPayment(p); setModalOpen(false); } catch (e) { Alert.alert("Couldn't record payment", e.message); } }} />
    </View>
  );
}

function RecordPaymentModal({ visible, invoices, onClose, onSave }) {
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  React.useEffect(() => { if (invoices.length) setInvoiceId(invoices[0].id); }, [invoices]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 60 }}>
        <Text style={{ fontSize: 20, fontWeight: "800", marginBottom: spacing.md }}>Record payment</Text>
        <Field label="Invoice">
          <TouchableOpacity
            style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, backgroundColor: "#fff" }}
            onPress={() => Alert.alert("Select invoice", "", invoices.map((i) => ({ text: i.invoiceNo, onPress: () => setInvoiceId(i.id) })).concat([{ text: "Cancel", style: "cancel" }]))}
          >
            <Text>{invoices.find((i) => i.id === invoiceId)?.invoiceNo || "Select an invoice"}</Text>
          </TouchableOpacity>
        </Field>
        <Field label="Amount (₹)"><Input keyboardType="numeric" value={amount} onChangeText={setAmount} /></Field>
        <Field label="Method"><Input value={method} onChangeText={setMethod} placeholder="bank_transfer / cash / upi" /></Field>
        <View style={{ flexDirection: "row", gap: 8, marginTop: spacing.md }}>
          <Button title="Cancel" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
          <Button title="Save" onPress={() => {
            const inv = invoices.find((i) => i.id === invoiceId);
            onSave({ invoiceId, companyId: inv?.companyId, amount: Number(amount), method });
          }} disabled={!invoiceId || !amount} style={{ flex: 1 }} />
        </View>
      </ScrollView>
    </Modal>
  );
}
