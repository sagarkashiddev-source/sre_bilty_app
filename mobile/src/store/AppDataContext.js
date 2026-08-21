import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as api from "../services/api";
import {
  companyFromApi, companyToApi, customerFromApi, customerToApi,
  productFromApi, productToApi, invoiceFromApi, invoiceToApiPayload,
} from "../services/adapters";

const AppDataContext = createContext(null);

export function AppDataProvider({ children }) {
  const [authUser, setAuthUser] = useState(undefined); // undefined = checking, null = logged out
  const [loading, setLoading] = useState(true);
  const [companies, setCompanies] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [payments, setPayments] = useState([]);
  const [activeCompanyId, setActiveCompanyId] = useState(null);

  useEffect(() => {
    const unsub = api.onAuthChange((u) => setAuthUser(u));
    api.fetchCurrentUser().then(setAuthUser);
    return unsub;
  }, []);

  const loadEverything = useCallback(async () => {
    setLoading(true);
    try {
      const apiCompanies = await api.Companies.list();
      const mapped = apiCompanies.map(companyFromApi);
      setCompanies(mapped);
      if (mapped.length && !activeCompanyId) setActiveCompanyId(mapped[0].id);

      const perCompany = await Promise.all(mapped.map(async (c) => {
        const [cu, pr, inv, pay] = await Promise.all([
          api.Customers.list(c.id), api.Products.list(c.id), api.Invoices.list(c.id), api.Payments.list(c.id),
        ]);
        return { customers: cu, products: pr, invoices: inv, payments: pay };
      }));
      setCustomers(perCompany.flatMap((p) => p.customers).map(customerFromApi));
      setProducts(perCompany.flatMap((p) => p.products).map(productFromApi));
      setInvoices(perCompany.flatMap((p) => p.invoices).map(invoiceFromApi));
      setPayments(perCompany.flatMap((p) => p.payments));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (authUser) loadEverything();
    else if (authUser === null) setLoading(false);
  }, [authUser, loadEverything]);

  const companyById = useCallback((id) => companies.find((c) => c.id === id), [companies]);

  const saveCompany = async (c) => {
    if (c.id && companies.some((x) => x.id === c.id)) {
      const row = await api.Companies.update(c.id, companyToApi(c));
      const mapped = companyFromApi(row);
      setCompanies((prev) => prev.map((x) => (x.id === c.id ? mapped : x)));
      return mapped;
    }
    const row = await api.Companies.create(companyToApi(c));
    const mapped = companyFromApi(row);
    setCompanies((prev) => [...prev, mapped]);
    if (!activeCompanyId) setActiveCompanyId(mapped.id);
    await loadEverything();
    return mapped;
  };
  const removeCompany = async (id) => { await api.Companies.remove(id); await loadEverything(); };

  const saveCustomer = async (c) => {
    if (c.id && customers.some((x) => x.id === c.id)) {
      const row = await api.Customers.update(c.id, customerToApi(c, c.companyId));
      const mapped = customerFromApi(row);
      setCustomers((prev) => prev.map((x) => (x.id === c.id ? mapped : x)));
      return mapped;
    }
    const row = await api.Customers.create(customerToApi(c, c.companyId || activeCompanyId));
    const mapped = customerFromApi(row);
    setCustomers((prev) => [...prev, mapped]);
    return mapped;
  };
  const removeCustomer = async (id) => { await api.Customers.remove(id); setCustomers((prev) => prev.filter((c) => c.id !== id)); };

  const saveProduct = async (p) => {
    if (p.id && products.some((x) => x.id === p.id)) {
      const row = await api.Products.update(p.id, productToApi(p, p.companyId));
      const mapped = productFromApi(row);
      setProducts((prev) => prev.map((x) => (x.id === p.id ? mapped : x)));
      return mapped;
    }
    const row = await api.Products.create(productToApi(p, p.companyId || activeCompanyId));
    const mapped = productFromApi(row);
    setProducts((prev) => [...prev, mapped]);
    return mapped;
  };
  const removeProduct = async (id) => { await api.Products.remove(id); setProducts((prev) => prev.filter((p) => p.id !== id)); };

  const saveInvoice = async (inv) => {
    const exists = invoices.some((i) => i.id === inv.id);
    if (exists) {
      const row = await api.Invoices.update(inv.id, invoiceToApiPayload(inv));
      const mapped = invoiceFromApi(row);
      setInvoices((prev) => prev.map((i) => (i.id === inv.id ? mapped : i)));
      return mapped;
    }
    const row = await api.Invoices.create(invoiceToApiPayload(inv));
    const mapped = invoiceFromApi(row);
    setInvoices((prev) => [mapped, ...prev]);
    return mapped;
  };
  const finalizeInvoice = async (inv) => saveInvoice({ ...inv, finalized: true });
  const cancelInvoice = async (id) => {
    const row = await api.Invoices.cancel(id);
    const mapped = invoiceFromApi(row);
    setInvoices((prev) => prev.map((i) => (i.id === id ? mapped : i)));
    return mapped;
  };
  const duplicateInvoice = async (id) => {
    const row = await api.Invoices.duplicate(id);
    const mapped = invoiceFromApi(row);
    setInvoices((prev) => [mapped, ...prev]);
    return mapped;
  };
  const removeInvoice = async (id) => { await api.Invoices.remove(id); setInvoices((prev) => prev.filter((i) => i.id !== id)); };

  const recordPayment = async (payment) => {
    const row = await api.Payments.create(payment);
    setPayments((prev) => [row, ...prev]);
    await loadEverything();
    return row;
  };

  const value = {
    authUser, setAuthUser, loading, companies, customers, products, invoices, payments,
    activeCompanyId, setActiveCompanyId, companyById, loadEverything,
    saveCompany, removeCompany, saveCustomer, removeCustomer, saveProduct, removeProduct,
    saveInvoice, finalizeInvoice, cancelInvoice, duplicateInvoice, removeInvoice, recordPayment,
  };

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error("useAppData must be used within AppDataProvider");
  return ctx;
}
