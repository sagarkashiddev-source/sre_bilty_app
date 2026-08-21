import React, { useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from "react-native";
import { useAppData } from "../store/AppDataContext";
import { colors, spacing, radius } from "../theme";
import { Card, StatusBadge, EmptyState } from "../components/ui";
import { computeInvoice, fromPaise, fmt } from "../services/money";

export default function DashboardScreen({ navigation }) {
  const { companies, customers, invoices, companyById, loadEverything, activeCompanyId } = useAppData();
  const [refreshing, setRefreshing] = React.useState(false);

  const companyInvoices = useMemo(
    () => invoices.filter((i) => !activeCompanyId || i.companyId === activeCompanyId),
    [invoices, activeCompanyId]
  );

  const stats = useMemo(() => {
    let grandTotal = 0, outstanding = 0, drafts = 0, cancelled = 0;
    companyInvoices.forEach((inv) => {
      const company = companyById(inv.companyId);
      const customer = customers.find((c) => c.id === inv.customerId);
      const computed = computeInvoice(inv.items, company, customer || inv.customerSnapshot);
      const total = fromPaise(computed.grandTotalPaise);
      if (inv.status === "cancelled") { cancelled++; return; }
      if (inv.status === "draft") { drafts++; return; }
      grandTotal += total;
      if (inv.status !== "paid") outstanding += total;
    });
    return { grandTotal, outstanding, drafts, cancelled, count: companyInvoices.length };
  }, [companyInvoices, companyById, customers]);

  const recent = companyInvoices.slice(0, 6);

  const onRefresh = async () => { setRefreshing(true); await loadEverything(); setRefreshing(false); };

  if (!companies.length) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <EmptyState title="Add your company to get started" subtitle="Head to More → My Companies to add your first company before creating invoices." />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: spacing.lg }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}>
      <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink, marginBottom: 2 }}>Dashboard</Text>
      <Text style={{ color: colors.inkSoft, marginBottom: spacing.lg }}>{companyById(activeCompanyId)?.name || "All companies"}</Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.lg }}>
        <StatCard label="Total billed" value={`₹${fmt(stats.grandTotal)}`} accent />
        <StatCard label="Outstanding" value={`₹${fmt(stats.outstanding)}`} />
        <StatCard label="Drafts" value={String(stats.drafts)} />
        <StatCard label="Cancelled" value={String(stats.cancelled)} />
      </View>

      <TouchableOpacity onPress={() => navigation.navigate("InvoiceForm", { companyId: activeCompanyId })}
        style={{ backgroundColor: colors.accent, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg }}>
        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>+ New Invoice</Text>
        <Text style={{ color: "#fff", opacity: 0.85, marginTop: 2 }}>GST auto-calculates as you add items</Text>
      </TouchableOpacity>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.ink }}>Recent invoices</Text>
        <TouchableOpacity onPress={() => navigation.navigate("InvoiceList")}>
          <Text style={{ color: colors.accent, fontWeight: "600" }}>View all</Text>
        </TouchableOpacity>
      </View>

      {recent.length === 0 ? (
        <Card><EmptyState title="No invoices yet" subtitle="Create your first invoice to see it here." /></Card>
      ) : (
        recent.map((inv) => {
          const company = companyById(inv.companyId);
          const customer = customers.find((c) => c.id === inv.customerId);
          const computed = computeInvoice(inv.items, company, customer || inv.customerSnapshot);
          return (
            <TouchableOpacity key={inv.id} onPress={() => navigation.navigate("InvoicePreview", { invoiceId: inv.id })}>
              <Card style={{ marginBottom: spacing.sm }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <View>
                    <Text style={{ fontWeight: "700", color: colors.ink }}>{inv.invoiceNo}</Text>
                    <Text style={{ color: colors.inkSoft, fontSize: 13 }}>{inv.customerSnapshot?.name || inv.customerName || "—"}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={{ fontWeight: "700", color: colors.ink }}>₹{fmt(fromPaise(computed.grandTotalPaise))}</Text>
                    <View style={{ marginTop: 4 }}><StatusBadge status={inv.status} /></View>
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })
      )}
    </ScrollView>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <View style={{ flexBasis: "48%", backgroundColor: accent ? colors.accent : "#fff", borderRadius: radius.md, padding: spacing.md, ...({}) }}>
      <Text style={{ color: accent ? "#fff" : colors.inkSoft, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: accent ? "#fff" : colors.ink, fontSize: 18, fontWeight: "800", marginTop: 4 }}>{value}</Text>
    </View>
  );
}
