import crypto from "node:crypto";
import { env, fonepayEnabled } from "./env.js";

// Fonepay's web-redirect API is shaped differently from all three other
// gateways here: not a hosted checkout session (Stripe), not a signed form
// POST (eSewa), not a JSON initiate-then-redirect call (Khalti) — it's a
// plain GET redirect where the signature itself is baked into the query
// string. Sandbox vs live is a different host, picked from NODE_ENV like
// every other gateway in this codebase.
const isProd = env.NODE_ENV === "production";

const BASE_URL = isProd
  ? "https://clientapi.fonepay.com"
  : "https://dev-clientapi.fonepay.com";

export { fonepayEnabled };

function hmac(message: string): string {
  return crypto.createHmac("sha512", env.FONEPAY_SECRET_KEY!).update(message, "utf-8").digest("hex");
}

function todayAsMMDDYYYY(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getFullYear()}`;
}

export interface FonepayCheckoutParams {
  amount: number;
  prn: string; // our transaction id — same role as eSewa's transaction_uuid
  remarks1: string; // max 160 chars per Fonepay's spec
  remarks2: string; // max 50 chars per Fonepay's spec
  returnUrl: string;
}

// Builds the full URL the frontend redirects the customer's browser to
// (window.location.href = url — no form to build, unlike eSewa). Field set
// and DV order are from Fonepay's own web-integration spec:
// PID,MD,PRN,AMT,CRN,DT,R1,R2,RU
export function buildFonepayCheckoutUrl(params: FonepayCheckoutParams): string {
  const fields = {
    PID: env.FONEPAY_MERCHANT_CODE!,
    MD: "P",
    PRN: params.prn,
    AMT: params.amount,
    CRN: "NPR",
    DT: todayAsMMDDYYYY(),
    R1: params.remarks1.slice(0, 160),
    R2: params.remarks2.slice(0, 50),
    RU: params.returnUrl,
  };

  const dv = hmac(
    `${fields.PID},${fields.MD},${fields.PRN},${fields.AMT},${fields.CRN},${fields.DT},${fields.R1},${fields.R2},${fields.RU}`
  );

  const qs = new URLSearchParams({
    PID: fields.PID,
    MD: fields.MD,
    PRN: fields.PRN,
    AMT: String(fields.AMT),
    CRN: fields.CRN,
    DT: fields.DT,
    R1: fields.R1,
    R2: fields.R2,
    RU: fields.RU,
    DV: dv,
  });

  return `${BASE_URL}/api/merchantRequest?${qs.toString()}`;
}

// Shape of the query params Fonepay appends to RU when it redirects the
// customer's browser back — closest in spirit to Khalti's pidx/status
// params: trivially forgeable on their own (they pass through the
// customer's browser), only useful once verified two ways below.
export interface FonepayCallbackParams {
  PRN: string;
  PID: string;
  PS: string; // "success" | "failure"
  RC: string; // "successful" on a genuine success
  UID: string; // Fonepay's own transaction id
  BC: string; // bank code that processed the payment
  INI: string; // transaction initiator
  P_AMT: string;
  R_AMT: string;
  DV: string;
}

// First check: confirms these specific params were produced by Fonepay (or
// someone holding our secret key) and weren't tampered with in the
// browser. Field order is PRN,PID,PS,RC,UID,BC,INI,P_AMT,R_AMT per
// Fonepay's spec; compared case-insensitively since their own sample code
// uppercases both sides before comparing.
export function verifyFonepayCallbackSignature(p: FonepayCallbackParams): boolean {
  const message = `${p.PRN},${p.PID},${p.PS},${p.RC},${p.UID},${p.BC},${p.INI},${p.P_AMT},${p.R_AMT}`;
  return hmac(message).toUpperCase() === p.DV.toUpperCase();
}

// Second, authoritative check — a signed callback still passes through the
// customer's browser and is never sufficient alone (same reasoning as the
// Stripe webhook / eSewa status check / Khalti lookup). Hits Fonepay's own
// server-to-server verification endpoint before a single cent is credited.
//
// CAVEAT — flagging this clearly rather than burying it: Fonepay's own
// public docs don't clearly spell out this endpoint's response format.
// The field list (PID, AMT, PRN, BID, UID, and a DV over
// "PID,AMT,PRN,BID,UID") and the plain-text/XML-ish response shape below
// are reconstructed from third-party integration write-ups, not confirmed
// against Fonepay's official spec. This needs a real sandbox transaction
// to confirm before you rely on it in production — if the response shape
// doesn't match what's parsed here, treat that as a signal to log the raw
// response and adjust, not silently trust either outcome.
export async function verifyFonepayTransaction(params: {
  prn: string;
  amount: number | string;
  bankCode: string;
  uid: string;
}): Promise<{ success: boolean; raw: string }> {
  const pid = env.FONEPAY_MERCHANT_CODE!;
  const dv = hmac(`${pid},${params.amount},${params.prn},${params.bankCode},${params.uid}`);

  const qs = new URLSearchParams({
    PRN: params.prn,
    PID: pid,
    BID: params.bankCode,
    AMT: String(params.amount),
    UID: params.uid,
    DV: dv,
  });

  const res = await fetch(`${BASE_URL}/api/merchantRequest/verificationMerchant?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Fonepay verification request failed: ${res.status}`);
  }
  const raw = await res.text();

  // Deliberately not pulling in an XML parser for one field — the response
  // is small and flat, so a couple of tolerant regexes over the raw text
  // cover both response shapes reported by integrators (an XML-ish
  // <response_code>successful</response_code>, or a <success>true</success>
  // flag). See the caveat above: confirm this against a real sandbox
  // response before trusting it in production.
  const success =
    /<response_code>\s*successful\s*<\/response_code>/i.test(raw) ||
    /<success>\s*true\s*<\/success>/i.test(raw);

  return { success, raw };
}
