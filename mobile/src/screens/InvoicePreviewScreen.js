import React, { useMemo, useState } from "react";
import { View, Text, ActivityIndicator, Alert, TouchableOpacity } from "react-native";
import { WebView } from "react-native-webview";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useAppData } from "../store/AppDataContext";
import { colors, spacing } from "../theme";
import { Button, Banner } from "../components/ui";
import { buildInvoiceHtml } from "../services/invoiceHtml";

export default function InvoicePreviewScreen({ route, navigation }) {
  const { invoiceId } = route.params || {};
  const { invoices, customers, companyById } = useAppData();
  const invoice = invoices.find((i) => i.id === invoiceId);
  const [busy, setBusy] = useState(false);

  const company = invoice ? companyById(invoice.companyId) : null;
  const customer = invoice ? customers.find((c) => c.id === invoice.customerId) : null;

  const html = useMemo(() => (invoice ? buildInvoiceHtml(invoice, company, customer) : ""), [invoice, company, customer]);

  const handlePdf = async (action) => {
    setBusy(true);
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (action === "print") {
        await Print.printAsync({ uri });
      } else {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: `${invoice.invoiceNo}.pdf` });
        } else {
          Alert.alert("Sharing not available", "Your device doesn't support the share sheet, but the PDF was generated at: " + uri);
        }
      }
    } catch (e) {
      Alert.alert("Couldn't generate PDF", e.message || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!invoice) {
    return <View style={{ flex: 1, backgroundColor: colors.bg, padding: spacing.xl }}><Text>Invoice not found.</Text></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {invoice.status === "cancelled" && <View style={{ padding: spacing.md, paddingBottom: 0 }}><Banner tone="danger">This invoice is cancelled.</Banner></View>}
      <View style={{ flex: 1, margin: spacing.md, borderRadius: 12, overflow: "hidden", backgroundColor: "#fff" }}>
        <WebView originWhitelist={["*"]} source={{ html }} style={{ flex: 1 }} />
      </View>
      <View style={{ padding: spacing.lg, flexDirection: "row", gap: 8, borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.bg }}>
        <Button title="Print" variant="ghost" onPress={() => handlePdf("print")} loading={busy} style={{ flex: 1 }} />
        <Button title="Share / Save PDF" onPress={() => handlePdf("share")} loading={busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
