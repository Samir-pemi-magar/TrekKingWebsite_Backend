import { env, khaltiEnabled } from "./env.js";

// KPG-2, Khalti's current e-Payment API. Sandbox vs live is a different
// base URL (not a key prefix like Stripe's sk_test_) — picked from
// NODE_ENV, same as eSewa. The secret key itself also comes from a
// different dashboard per environment (test-admin.khalti.com for sandbox,
// admin.khalti.com for production), but that's a client-side concern, not
// something this code needs to know about.
const BASE_URL = env.NODE_ENV === "production"
  ? "https://khalti.com/api/v2/"
  : "https://dev.khalti.com/api/v2/";

export { khaltiEnabled };

function authHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `key ${env.KHALTI_SECRET_KEY}`,
  };
}

export interface KhaltiInitiateResult {
  pidx: string;
  payment_url: string;
  expires_at: string;
  expires_in: number;
}

// Unlike eSewa/Stripe's checkout-session pattern, Khalti's initiate call
// itself returns a ready-made payment_url — the frontend just redirects
// there directly (window.location.href), no form-building needed.
export async function initiateKhaltiPayment(params: {
  amount: number; // in NPR — converted to paisa below, Khalti's base unit
  purchaseOrderId: string;
  purchaseOrderName: string;
  returnUrl: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
}): Promise<KhaltiInitiateResult> {
  const res = await fetch(`${BASE_URL}epayment/initiate/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      return_url: params.returnUrl,
      website_url: env.FRONTEND_URL,
      amount: Math.round(params.amount * 100), // NPR -> paisa
      purchase_order_id: params.purchaseOrderId,
      purchase_order_name: params.purchaseOrderName,
      customer_info: {
        name: params.customerName || "Guest",
        email: params.customerEmail,
        phone: params.customerPhone,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Khalti initiate failed: ${res.status} ${body}`);
  }
  return res.json();
}

export interface KhaltiLookupResult {
  pidx: string;
  total_amount: number; // paisa
  status: string; // "Completed" | "Pending" | "Expired" | "User canceled" | "Refunded" | ...
  transaction_id: string | null;
  fee: number;
  refunded: boolean;
}

// KPG-2 has no webhooks at all — Khalti's own docs describe the flow as
// always redirect-then-server-side-lookup, never push notifications. The
// return_url query params are never trusted directly (trivially
// forgeable); this lookup call, authenticated with our own secret key, is
// the only trustworthy source of truth.
export async function lookupKhaltiPayment(pidx: string): Promise<KhaltiLookupResult> {
  const res = await fetch(`${BASE_URL}epayment/lookup/`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ pidx }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Khalti lookup failed: ${res.status} ${body}`);
  }
  return res.json();
}
