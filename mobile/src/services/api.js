import * as SecureStore from "expo-secure-store";

/**
 * Set this to your deployed backend URL before building for the Play Store —
 * e.g. https://gst-invoice-backend.onrender.com. Falls back to a LAN address
 * for local development against `npm run dev` in /backend (update the IP to
 * your own machine's LAN IP; localhost does not resolve from a physical
 * phone or most emulators).
 */
const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:4000";

const REFRESH_KEY = "bilty_refresh_token";
let accessToken = null;
let refreshPromise = null;
const authListeners = new Set();

export function onAuthChange(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }
function notifyAuthChange(user) { authListeners.forEach((fn) => fn(user)); }

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function storeRefreshToken(token) {
  if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
}
async function getStoredRefreshToken() {
  try { return await SecureStore.getItemAsync(REFRESH_KEY); } catch { return null; }
}
async function clearStoredRefreshToken() {
  try { await SecureStore.deleteItemAsync(REFRESH_KEY); } catch { /* ignore */ }
}

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refreshToken = await getStoredRefreshToken();
      if (!refreshToken) throw new ApiError("Session expired", 401);
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) throw new ApiError("Session expired", res.status);
      const data = await res.json();
      accessToken = data.accessToken;
      await storeRefreshToken(data.refreshToken);
      return data;
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function request(path, { method = "GET", body, retry = true } = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Unable to reach the server. Check your internet connection.", 0);
  }

  if (res.status === 401 && retry) {
    try {
      await refreshAccessToken();
      return request(path, { method, body, retry: false });
    } catch {
      accessToken = null;
      await clearStoredRefreshToken();
      notifyAuthChange(null);
      throw new ApiError("Your session has expired. Please log in again.", 401);
    }
  }

  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) throw new ApiError((data && data.error) || "Something went wrong. Please try again.", res.status);
  return data;
}

/* --------------------------------- auth --------------------------------- */

export async function register(email, password) {
  const data = await request("/api/auth/register", { method: "POST", body: { email, password } });
  accessToken = data.accessToken;
  await storeRefreshToken(data.refreshToken);
  notifyAuthChange(data.user);
  return data.user;
}
export async function login(email, password) {
  const data = await request("/api/auth/login", { method: "POST", body: { email, password } });
  accessToken = data.accessToken;
  await storeRefreshToken(data.refreshToken);
  notifyAuthChange(data.user);
  return data.user;
}
export async function logout() {
  const refreshToken = await getStoredRefreshToken();
  try { await request("/api/auth/logout", { method: "POST", body: { refreshToken } }); } catch { /* best-effort */ }
  accessToken = null;
  await clearStoredRefreshToken();
  notifyAuthChange(null);
}
/** Called on app launch: silently restores the session from the securely-stored refresh token, if any. */
export async function fetchCurrentUser() {
  const stored = await getStoredRefreshToken();
  if (!stored) return null;
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

/* ------------------------------- resources ------------------------------- */

export const Companies = {
  list: () => request("/api/companies").then((d) => d.companies),
  create: (body) => request("/api/companies", { method: "POST", body }).then((d) => d.company),
  update: (id, body) => request(`/api/companies/${id}`, { method: "PUT", body }).then((d) => d.company),
  remove: (id) => request(`/api/companies/${id}`, { method: "DELETE" }),
};
export const Customers = {
  list: (companyId) => request(`/api/customers?companyId=${companyId}`).then((d) => d.customers),
  create: (body) => request("/api/customers", { method: "POST", body }).then((d) => d.customer),
  update: (id, body) => request(`/api/customers/${id}`, { method: "PUT", body }).then((d) => d.customer),
  remove: (id) => request(`/api/customers/${id}`, { method: "DELETE" }),
};
export const Products = {
  list: (companyId) => request(`/api/products?companyId=${companyId}`).then((d) => d.products),
  create: (body) => request("/api/products", { method: "POST", body }).then((d) => d.product),
  update: (id, body) => request(`/api/products/${id}`, { method: "PUT", body }).then((d) => d.product),
  remove: (id) => request(`/api/products/${id}`, { method: "DELETE" }),
};
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
export const Payments = {
  list: (companyId) => request(`/api/payments?companyId=${companyId}`).then((d) => d.payments),
  create: (body) => request("/api/payments", { method: "POST", body }).then((d) => d.payment),
};

export { ApiError, API_URL };
