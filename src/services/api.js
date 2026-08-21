/**
 * REST API client. This is the ONLY place in the frontend that talks to the
 * backend — presentation components go through the functions exported here,
 * never fetch() directly. The frontend never holds database credentials;
 * it only ever sees a short-lived JWT access token.
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

let accessToken = null;
let refreshPromise = null;
const authListeners = new Set();

export function onAuthChange(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}
function notifyAuthChange(user) {
  authListeners.forEach((fn) => fn(user));
}

export function setAccessToken(token) {
  accessToken = token;
}
export function getAccessToken() {
  return accessToken;
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/api/auth/refresh`, { method: "POST", credentials: "include" })
      .then(async (res) => {
        if (!res.ok) throw new ApiError("Session expired", res.status);
        const data = await res.json();
        accessToken = data.accessToken;
        return data;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/**
 * Core request helper. Automatically attaches the bearer token, retries once
 * after a silent token refresh on 401, and normalizes errors into ApiError
 * with a safe, user-facing message (never a raw stack trace).
 */
async function request(path, { method = "GET", body, retry = true } = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new ApiError("You're offline. Changes will sync once your connection is back.", 0);
  }
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Unable to reach the server. Please check your internet connection.", 0);
  }

  if (res.status === 401 && retry) {
    try {
      await refreshAccessToken();
      return request(path, { method, body, retry: false });
    } catch {
      notifyAuthChange(null);
      throw new ApiError("Your session has expired. Please log in again.", 401);
    }
  }

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }

  if (!res.ok) {
    throw new ApiError((data && data.error) || "Something went wrong. Please try again.", res.status);
  }
  return data;
}

/* --------------------------------- auth --------------------------------- */

export async function register(email, password) {
  const data = await request("/api/auth/register", { method: "POST", body: { email, password } });
  accessToken = data.accessToken;
  notifyAuthChange(data.user);
  return data.user;
}
export async function login(email, password) {
  const data = await request("/api/auth/login", { method: "POST", body: { email, password } });
  accessToken = data.accessToken;
  notifyAuthChange(data.user);
  return data.user;
}
export async function logout() {
  try { await request("/api/auth/logout", { method: "POST" }); } catch { /* best-effort */ }
  accessToken = null;
  notifyAuthChange(null);
}
export async function fetchCurrentUser() {
  try {
    await refreshAccessToken();
    const data = await request("/api/auth/me");
    notifyAuthChange(data.user);
    return data.user;
  } catch {
    accessToken = null;
    return null;
  }
}

/* ------------------------------- companies ------------------------------- */

export const Companies = {
  list: () => request("/api/companies").then((d) => d.companies),
  create: (body) => request("/api/companies", { method: "POST", body }).then((d) => d.company),
  update: (id, body) => request(`/api/companies/${id}`, { method: "PUT", body }).then((d) => d.company),
  remove: (id) => request(`/api/companies/${id}`, { method: "DELETE" }),
};

/* ------------------------------- customers ------------------------------- */

export const Customers = {
  list: (companyId) => request(`/api/customers?companyId=${companyId}`).then((d) => d.customers),
  create: (body) => request("/api/customers", { method: "POST", body }).then((d) => d.customer),
  update: (id, body) => request(`/api/customers/${id}`, { method: "PUT", body }).then((d) => d.customer),
  remove: (id) => request(`/api/customers/${id}`, { method: "DELETE" }),
};

/* -------------------------------- products -------------------------------- */

export const Products = {
  list: (companyId) => request(`/api/products?companyId=${companyId}`).then((d) => d.products),
  create: (body) => request("/api/products", { method: "POST", body }).then((d) => d.product),
  update: (id, body) => request(`/api/products/${id}`, { method: "PUT", body }).then((d) => d.product),
  remove: (id) => request(`/api/products/${id}`, { method: "DELETE" }),
};

/* -------------------------------- invoices -------------------------------- */

export const Invoices = {
  list: (companyId, params = {}) => {
    const qs = new URLSearchParams({ companyId, ...params }).toString();
    return request(`/api/invoices?${qs}`).then((d) => d.invoices);
  },
  get: (id) => request(`/api/invoices/${id}`).then((d) => d.invoice),
  create: (body) => request("/api/invoices", { method: "POST", body }).then((d) => d.invoice),
  update: (id, body) => request(`/api/invoices/${id}`, { method: "PUT", body }).then((d) => d.invoice),
  setStatus: (id, status) => request(`/api/invoices/${id}/status`, { method: "POST", body: { status } }).then((d) => d.invoice),
  cancel: (id) => request(`/api/invoices/${id}/cancel`, { method: "POST" }).then((d) => d.invoice),
  duplicate: (id) => request(`/api/invoices/${id}/duplicate`, { method: "POST" }).then((d) => d.invoice),
  remove: (id) => request(`/api/invoices/${id}`, { method: "DELETE" }),
};

/* -------------------------------- ledger -------------------------------- */

export const Payments = {
  list: (companyId) => request(`/api/payments?companyId=${companyId}`).then((d) => d.payments),
  create: (body) => request("/api/payments", { method: "POST", body }).then((d) => d.payment),
  void: (id) => request(`/api/payments/${id}/void`, { method: "POST" }).then((d) => d.payment),
};
export const CreditNotes = {
  list: (companyId) => request(`/api/credit-notes?companyId=${companyId}`).then((d) => d.creditNotes),
  create: (body) => request("/api/credit-notes", { method: "POST", body }).then((d) => d.creditNote),
};
export const DebitNotes = {
  list: (companyId) => request(`/api/debit-notes?companyId=${companyId}`).then((d) => d.debitNotes),
  create: (body) => request("/api/debit-notes", { method: "POST", body }).then((d) => d.debitNote),
};
export const Templates = {
  list: (companyId) => request(`/api/templates?companyId=${companyId}`).then((d) => d.templates),
  create: (body) => request("/api/templates", { method: "POST", body }).then((d) => d.template),
  remove: (id) => request(`/api/templates/${id}`, { method: "DELETE" }),
};
export const AuditLogs = {
  list: (companyId) => request(`/api/audit-logs?companyId=${companyId}`).then((d) => d.auditLogs),
};

export { ApiError };
