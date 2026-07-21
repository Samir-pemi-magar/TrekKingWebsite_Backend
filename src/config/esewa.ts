import crypto from "node:crypto";
import { env, esewaEnabled } from "./env.js";

// eSewa's ePay v2 API has no test-key prefix like Stripe's sk_test_ — the
// same merchant code/secret works against both hosts, and sandbox vs live
// is purely which URL you point at. We pick that from NODE_ENV, same as
// every other "is this really production" check in this codebase.
const isProd = env.NODE_ENV === "production";

export const esewaFormUrl = isProd
  ? "https://epay.esewa.com.np/api/epay/main/v2/form"
  : "https://rc-epay.esewa.com.np/api/epay/main/v2/form";

const STATUS_URL = isProd
  ? "https://epay.esewa.com.np/api/epay/transaction/status/"
  : "https://rc.esewa.com.np/api/epay/transaction/status/";

export { esewaEnabled };

// eSewa signs a specific, comma-joined subset of fields with HMAC-SHA256,
// base64-encoded — as "name=value" pairs joined by commas, per their spec.
// Both signing an outgoing request and verifying an incoming callback use
// this same routine; only the field list (and which side calls it) differs.
function sign(fields: Record<string, unknown>, fieldNames: string[]): string {
  const message = fieldNames.map((name) => `${name}=${fields[name]}`).join(",");
  return crypto.createHmac("sha256", env.ESEWA_SECRET_KEY!).update(message).digest("base64");
}

export interface EsewaCheckoutFields {
  amount: number;
  tax_amount: number;
  total_amount: number;
  transaction_uuid: string;
  product_code: string;
  product_service_charge: number;
  product_delivery_charge: number;
  success_url: string;
  failure_url: string;
  signed_field_names: string;
  signature: string;
}

// Builds the exact field set the frontend needs to POST (as a real HTML
// form submit, not fetch/XHR — eSewa's form endpoint expects a browser
// navigation so it can redirect through its own payment UI) to eSewa's
// form URL.
export function buildEsewaCheckout(params: {
  amount: number;
  transactionUuid: string;
  successUrl: string;
  failureUrl: string;
}): EsewaCheckoutFields {
  const signedFieldNames = ["total_amount", "transaction_uuid", "product_code"];

  const fields = {
    amount: params.amount,
    tax_amount: 0,
    total_amount: params.amount, // no separate service/delivery charge in our flow
    transaction_uuid: params.transactionUuid,
    product_code: env.ESEWA_MERCHANT_CODE!,
    product_service_charge: 0,
    product_delivery_charge: 0,
    success_url: params.successUrl,
    failure_url: params.failureUrl,
  };

  return {
    ...fields,
    signed_field_names: signedFieldNames.join(","),
    signature: sign(fields, signedFieldNames),
  };
}

// Shape of the base64 `data` query param eSewa appends to success_url when
// it redirects the customer's browser back.
export interface EsewaCallbackPayload {
  transaction_code: string;
  status: string; // "COMPLETE" is the only value that means money moved
  total_amount: string;
  transaction_uuid: string;
  product_code: string;
  signed_field_names: string;
  signature: string;
  [key: string]: unknown;
}

export function decodeEsewaCallback(data: string): EsewaCallbackPayload {
  const json = Buffer.from(data, "base64").toString("utf-8");
  return JSON.parse(json);
}

export function verifyEsewaCallbackSignature(payload: EsewaCallbackPayload): boolean {
  const fieldNames = payload.signed_field_names.split(",");
  return sign(payload, fieldNames) === payload.signature;
}

// Never trust the redirect alone — it passes through the customer's
// browser, same as any client-side return_url. eSewa's status-check API is
// the authoritative, server-to-server confirmation that money actually
// moved, called before a single cent is credited to the booking.
export async function checkEsewaTransactionStatus(params: {
  productCode: string;
  totalAmount: string | number;
  transactionUuid: string;
}): Promise<{ status: string; ref_id?: string }> {
  const url = new URL(STATUS_URL);
  url.searchParams.set("product_code", params.productCode);
  url.searchParams.set("total_amount", String(params.totalAmount));
  url.searchParams.set("transaction_uuid", params.transactionUuid);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`eSewa status check request failed: ${res.status}`);
  }
  return res.json();
}
