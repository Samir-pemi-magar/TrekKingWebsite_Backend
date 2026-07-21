import { NextFunction, Request, Response } from "express";
import Stripe from "stripe";
import { PaymentMethod } from "@prisma/client";
import { ApiError } from "../utils/apiError.js";
import { requireStringParam } from "../utils/params.js";
import * as BookingModel from "../models/booking.model.js";
import { stripe } from "../config/stripe.js";
import { env, stripeEnabled, esewaEnabled } from "../config/env.js";
import {
  esewaFormUrl,
  buildEsewaCheckout,
  decodeEsewaCallback,
  verifyEsewaCallbackSignature,
  checkEsewaTransactionStatus,
} from "../config/esewa.js";
import { khaltiEnabled, initiateKhaltiPayment, lookupKhaltiPayment } from "../config/khalti.js";
import {
  fonepayEnabled,
  buildFonepayCheckoutUrl,
  verifyFonepayCallbackSignature,
  verifyFonepayTransaction,
  type FonepayCallbackParams,
} from "../config/fonepay.js";
import { sendMail, templates } from "../config/mailer.js";
import { recordAuditLog } from "../utils/auditLog.js";

// Public — lets the frontend know which payment methods are actually
// configured, so it can hide (not just disable) a button for a gateway the
// client hasn't set up yet, instead of hardcoding assumptions on the client
// side that can drift from the real env vars.
export function getPaymentMethodsConfig(_req: Request, res: Response) {
  res.json({
    status: "success",
    data: { stripe: stripeEnabled, esewa: esewaEnabled, khalti: khaltiEnabled, fonepay: fonepayEnabled },
  });
}

// Public — a guest or logged-in customer calls this right after creating a
// booking, to get a Stripe-hosted Checkout URL to redirect to.
//
// No auth beyond the booking id itself: ids are UUIDs (unguessable), and
// paying towards someone else's booking isn't something an attacker would
// gain from — same trust model as an emailed order-confirmation link.
export async function createStripeCheckoutSession(req: Request, res: Response, next: NextFunction) {
  try {
    if (!stripe) throw ApiError.badRequest("Card payments aren't configured yet");

    const id = requireStringParam(req.params.id);
    const booking = await BookingModel.getBookingById(id);
    if (!booking) throw ApiError.notFound("Booking not found");

    const amountDue = booking.totalPrice - booking.amountPaid;
    if (amountDue <= 0) {
      throw ApiError.badRequest("There's nothing left to pay on this booking");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountDue * 100, // Stripe wants the smallest currency unit
            product_data: {
              name: `${booking.trip.name} — booking #${booking.id.slice(0, 8)}`,
            },
          },
          quantity: 1,
        },
      ],
      // How the webhook maps a completed payment back to a booking row —
      // Stripe has no idea what a "booking" is otherwise.
      metadata: { bookingId: booking.id },
      customer_email: booking.user?.email ?? booking.guestEmail ?? undefined,
      success_url: `${env.FRONTEND_URL}/trips/${booking.tripId}?booking=${booking.id}&payment=success`,
      cancel_url: `${env.FRONTEND_URL}/trips/${booking.tripId}?booking=${booking.id}&payment=cancelled`,
    });

    res.json({ status: "success", data: { url: session.url } });
  } catch (err) {
    next(err);
  }
}

// Mounted directly in app.ts with express.raw() BEFORE express.json() —
// Stripe's signature check needs the exact, untouched raw request body, so
// this route can't live behind the normal JSON-parsed router in
// routes/index.ts.
export async function handleStripeWebhook(req: Request, res: Response) {
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) {
    return res.status(400).send("Stripe not configured");
  }

  const signature = req.headers["stripe-signature"];
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature as string, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe webhook] signature verification failed:", err);
    return res.status(400).send(`Webhook Error: ${(err as Error).message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const bookingId = session.metadata?.bookingId;

    if (bookingId) {
      try {
        const existing = await BookingModel.getBookingById(bookingId);
        if (existing) {
          // Accumulate rather than overwrite — this webhook can fire for a
          // booking that already had a partial manual payment recorded
          // (e.g. a deposit paid by wire transfer earlier).
          const paidNow = (session.amount_total ?? 0) / 100;
          const newAmountPaid = Math.min(existing.amountPaid + paidNow, existing.totalPrice);

          const updated = await BookingModel.updateBooking(
            bookingId,
            { amountPaid: newAmountPaid, paymentMethod: PaymentMethod.STRIPE },
            existing.totalPrice
          );

          recordAuditLog({
            actorId: undefined, // no human actor — this is a webhook
            action: "booking.payment.stripe",
            entityType: "Booking",
            entityId: bookingId,
            meta: { sessionId: session.id, paidNow, derivedPaymentStatus: updated.paymentStatus },
          });

          const contactEmail = updated.user?.email ?? existing.guestEmail;
          const contactName = updated.user?.name ?? existing.guestName ?? "there";
          if (contactEmail) {
            void sendMail(
              contactEmail,
              "Payment received",
              templates.paymentReceived(contactName, updated.trip.name, paidNow, updated.paymentStatus)
            );
          }
        }
      } catch (err) {
        // Log and still 200 below — a non-2xx makes Stripe retry the
        // webhook indefinitely, which is worse than one missed update we
        // can catch and fix manually via the audit log.
        console.error("[stripe webhook] failed to update booking:", err);
      }
    }
  }

  res.json({ received: true });
}

// Public — same trust model as createStripeCheckoutSession (booking id is
// an unguessable UUID, and paying towards someone else's booking isn't
// something an attacker gains from). Unlike Stripe, eSewa isn't a
// server-to-server session: this just returns the signed form fields, and
// the frontend does a real browser-form POST to eSewa's own hosted page.
export async function createEsewaCheckoutSession(req: Request, res: Response, next: NextFunction) {
  try {
    if (!esewaEnabled) throw ApiError.badRequest("eSewa isn't configured yet");

    const id = requireStringParam(req.params.id);
    const booking = await BookingModel.getBookingById(id);
    if (!booking) throw ApiError.notFound("Booking not found");

    const amountDue = booking.totalPrice - booking.amountPaid;
    if (amountDue <= 0) {
      throw ApiError.badRequest("There's nothing left to pay on this booking");
    }

    // booking.id (a uuid) plus a timestamp — so a retried/abandoned
    // attempt gets its own transaction_uuid at eSewa instead of colliding
    // with an earlier one. Kept parseable: verifyEsewaPayment below strips
    // everything after the last "-" to recover the booking id.
    const transactionUuid = `${booking.id}-${Date.now()}`;

    const fields = buildEsewaCheckout({
      amount: amountDue,
      transactionUuid,
      // eSewa appends its own `?data=...` (or `&data=...`) to whatever
      // success_url we give it, so this doesn't set payment=success itself
      // — the frontend reads `data` and calls verifyEsewaPayment below,
      // which is the only thing allowed to actually confirm the payment.
      successUrl: `${env.FRONTEND_URL}/trips/${booking.tripId}`,
      failureUrl: `${env.FRONTEND_URL}/trips/${booking.tripId}?booking=${booking.id}&payment=cancelled&method=esewa`,
    });

    res.json({ status: "success", data: { action: esewaFormUrl, fields } });
  } catch (err) {
    next(err);
  }
}

// Public — the frontend calls this once, right after eSewa redirects the
// customer's browser back with a base64 `data` query param. Two independent
// checks gate crediting anything: the signature on the redirect payload
// itself, and eSewa's own server-to-server status-check API. The redirect
// alone passes through the customer's browser and is never sufficient on
// its own — same reasoning as the Stripe webhook, just verified via a
// signed payload + follow-up API call instead of a signed header.
export async function verifyEsewaPayment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!esewaEnabled) throw ApiError.badRequest("eSewa isn't configured yet");

    const { data } = req.body as { data?: string };
    if (!data) throw ApiError.badRequest("Missing eSewa response data");

    const payload = decodeEsewaCallback(data);
    if (!verifyEsewaCallbackSignature(payload)) {
      throw ApiError.badRequest("Invalid eSewa signature");
    }

    // transaction_uuid is `${bookingId}-${timestamp}` and bookingId is
    // itself a dash-containing uuid, so split on the *last* dash rather
    // than the first to recover it correctly.
    const lastDash = payload.transaction_uuid.lastIndexOf("-");
    const bookingId = payload.transaction_uuid.slice(0, lastDash);

    const existing = await BookingModel.getBookingById(bookingId);
    if (!existing) throw ApiError.notFound("Booking not found for this transaction");

    if (payload.status !== "COMPLETE") {
      // Customer bailed or eSewa declined it — nothing to credit, but not
      // an error either; hand back the booking unchanged.
      return res.json({ status: "success", data: existing });
    }

    const statusCheck = await checkEsewaTransactionStatus({
      productCode: payload.product_code,
      totalAmount: payload.total_amount,
      transactionUuid: payload.transaction_uuid,
    });
    if (statusCheck.status !== "COMPLETE") {
      throw ApiError.badRequest("eSewa has not confirmed this payment yet");
    }

    // Accumulate rather than overwrite — mirrors the Stripe webhook, since
    // this can also fire for a booking that already had a partial manual
    // payment (e.g. a deposit paid by wire transfer earlier).
    const paidNow = Number(payload.total_amount);
    const newAmountPaid = Math.min(existing.amountPaid + paidNow, existing.totalPrice);

    const updated = await BookingModel.updateBooking(
      bookingId,
      { amountPaid: newAmountPaid, paymentMethod: PaymentMethod.ESEWA },
      existing.totalPrice
    );

    recordAuditLog({
      actorId: undefined, // no human actor — this is a gateway-verified payment
      action: "booking.payment.esewa",
      entityType: "Booking",
      entityId: bookingId,
      meta: {
        transactionUuid: payload.transaction_uuid,
        refId: statusCheck.ref_id,
        paidNow,
        derivedPaymentStatus: updated.paymentStatus,
      },
    });

    const contactEmail = updated.user?.email ?? existing.guestEmail;
    const contactName = updated.user?.name ?? existing.guestName ?? "there";
    if (contactEmail) {
      void sendMail(
        contactEmail,
        "Payment received",
        templates.paymentReceived(contactName, updated.trip.name, paidNow, updated.paymentStatus)
      );
    }

    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}

// Public — same trust model as the Stripe/eSewa checkout starters.
// Khalti's initiate call returns a ready payment_url, so unlike eSewa this
// is a plain redirect (window.location.href), same shape as Stripe.
export async function createKhaltiCheckoutSession(req: Request, res: Response, next: NextFunction) {
  try {
    if (!khaltiEnabled) throw ApiError.badRequest("Khalti isn't configured yet");

    const id = requireStringParam(req.params.id);
    const booking = await BookingModel.getBookingById(id);
    if (!booking) throw ApiError.notFound("Booking not found");

    const amountDue = booking.totalPrice - booking.amountPaid;
    if (amountDue <= 0) {
      throw ApiError.badRequest("There's nothing left to pay on this booking");
    }

    // Khalti appends its own pidx/status/transaction_id/amount query params
    // to whatever return_url we give it — none of which are trusted
    // directly (see verifyKhaltiPayment below), they just tell the
    // frontend which pidx to hand to the verify endpoint.
    const returnUrl = `${env.FRONTEND_URL}/trips/${booking.tripId}?booking=${booking.id}&method=khalti`;

    const result = await initiateKhaltiPayment({
      amount: amountDue,
      purchaseOrderId: booking.id,
      purchaseOrderName: `${booking.trip.name} — booking #${booking.id.slice(0, 8)}`,
      returnUrl,
      customerName: booking.user?.name ?? booking.guestName ?? undefined,
      customerEmail: booking.user?.email ?? booking.guestEmail ?? undefined,
      customerPhone: booking.user?.phone ?? booking.guestPhone ?? undefined,
    });

    res.json({ status: "success", data: { url: result.payment_url } });
  } catch (err) {
    next(err);
  }
}

// Public — the frontend calls this once, right after Khalti redirects the
// customer's browser back with a `pidx` query param. KPG-2 has no webhooks
// at all, so this lookup call — authenticated with our own secret key — is
// the *only* trustworthy confirmation; the return_url query params
// (including its own status field) are trivially forgeable and never used
// to decide anything on their own.
export async function verifyKhaltiPayment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!khaltiEnabled) throw ApiError.badRequest("Khalti isn't configured yet");

    const { pidx } = req.body as { pidx?: string };
    if (!pidx) throw ApiError.badRequest("Missing Khalti pidx");

    const lookup = await lookupKhaltiPayment(pidx);

    // purchase_order_id was set to booking.id when we initiated — Khalti
    // doesn't echo it back on lookup, so we rely on the frontend having
    // sent us the right booking (see bookingId below) plus this pidx
    // belonging to it; lookupKhaltiPayment's own auth key scopes results
    // to our merchant account, so a forged pidx from elsewhere fails here.
    const { bookingId } = req.body as { bookingId?: string };
    if (!bookingId) throw ApiError.badRequest("Missing booking id");

    const existing = await BookingModel.getBookingById(bookingId);
    if (!existing) throw ApiError.notFound("Booking not found");

    if (lookup.status !== "Completed") {
      // Pending/expired/cancelled — nothing to credit, not an error.
      return res.json({ status: "success", data: existing });
    }

    const paidNow = lookup.total_amount / 100; // paisa -> NPR
    const newAmountPaid = Math.min(existing.amountPaid + paidNow, existing.totalPrice);

    const updated = await BookingModel.updateBooking(
      bookingId,
      { amountPaid: newAmountPaid, paymentMethod: PaymentMethod.KHALTI },
      existing.totalPrice
    );

    recordAuditLog({
      actorId: undefined, // no human actor — this is a gateway-verified payment
      action: "booking.payment.khalti",
      entityType: "Booking",
      entityId: bookingId,
      meta: {
        pidx,
        transactionId: lookup.transaction_id,
        paidNow,
        derivedPaymentStatus: updated.paymentStatus,
      },
    });

    const contactEmail = updated.user?.email ?? existing.guestEmail;
    const contactName = updated.user?.name ?? existing.guestName ?? "there";
    if (contactEmail) {
      void sendMail(
        contactEmail,
        "Payment received",
        templates.paymentReceived(contactName, updated.trip.name, paidNow, updated.paymentStatus)
      );
    }

    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}

// Public — same trust model as the other checkout starters. Unlike
// eSewa (form POST) or Khalti/Stripe (JSON call returning a URL to fetch
// then redirect to), Fonepay's flow is a single signed GET redirect — the
// frontend just does window.location.href = url directly.
export async function createFonepayCheckoutSession(req: Request, res: Response, next: NextFunction) {
  try {
    if (!fonepayEnabled) throw ApiError.badRequest("Fonepay isn't configured yet");

    const id = requireStringParam(req.params.id);
    const booking = await BookingModel.getBookingById(id);
    if (!booking) throw ApiError.notFound("Booking not found");

    const amountDue = booking.totalPrice - booking.amountPaid;
    if (amountDue <= 0) {
      throw ApiError.badRequest("There's nothing left to pay on this booking");
    }

    // booking.id plus a timestamp, same trick as eSewa's transaction_uuid —
    // a retried/abandoned attempt gets its own PRN instead of colliding
    // with an earlier one. Kept parseable: verifyFonepayPayment below
    // strips everything after the last "-" to recover the booking id.
    const prn = `${booking.id}-${Date.now()}`;

    // Fonepay appends its own PS/RC/UID/BC/INI/P_AMT/R_AMT/DV query params
    // to whatever RU we give it, same shape as eSewa/Khalti's return URLs —
    // the frontend reads those and calls verifyFonepayPayment below, which
    // is the only thing allowed to actually confirm the payment.
    const returnUrl = `${env.FRONTEND_URL}/trips/${booking.tripId}?booking=${booking.id}&method=fonepay`;

    const url = buildFonepayCheckoutUrl({
      amount: amountDue,
      prn,
      remarks1: booking.trip.name,
      remarks2: `Booking #${booking.id.slice(0, 8)}`,
      returnUrl,
    });

    res.json({ status: "success", data: { url } });
  } catch (err) {
    next(err);
  }
}

// Public — the frontend calls this once, right after Fonepay redirects the
// customer's browser back with PRN/PID/PS/RC/UID/BC/INI/P_AMT/R_AMT/DV
// query params. Two independent checks gate crediting anything: the
// signature on the callback params themselves, and Fonepay's own
// server-to-server verification API — the redirect alone passes through
// the customer's browser and is never sufficient on its own (same
// reasoning as every other gateway here).
export async function verifyFonepayPayment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!fonepayEnabled) throw ApiError.badRequest("Fonepay isn't configured yet");

    const params = req.body as Partial<FonepayCallbackParams>;
    const required: (keyof FonepayCallbackParams)[] = [
      "PRN", "PID", "PS", "RC", "UID", "BC", "INI", "P_AMT", "R_AMT", "DV",
    ];
    for (const key of required) {
      if (!params[key]) throw ApiError.badRequest(`Missing Fonepay response field: ${key}`);
    }
    const payload = params as FonepayCallbackParams;

    if (!verifyFonepayCallbackSignature(payload)) {
      throw ApiError.badRequest("Invalid Fonepay signature");
    }

    // PRN is `${bookingId}-${timestamp}` and bookingId is itself a
    // dash-containing uuid, so split on the *last* dash, same as eSewa's
    // transaction_uuid parsing.
    const lastDash = payload.PRN.lastIndexOf("-");
    const bookingId = payload.PRN.slice(0, lastDash);

    const existing = await BookingModel.getBookingById(bookingId);
    if (!existing) throw ApiError.notFound("Booking not found for this transaction");

    if (payload.PS !== "success" || payload.RC !== "successful") {
      // Customer bailed or the bank declined it — nothing to credit, but
      // not an error either; hand back the booking unchanged.
      return res.json({ status: "success", data: existing });
    }

    const verification = await verifyFonepayTransaction({
      prn: payload.PRN,
      amount: payload.P_AMT,
      bankCode: payload.BC,
      uid: payload.UID,
    });
    if (!verification.success) {
      throw ApiError.badRequest("Fonepay has not confirmed this payment yet");
    }

    // Accumulate rather than overwrite — mirrors eSewa/Khalti, since this
    // can also fire for a booking that already had a partial manual
    // payment (e.g. a deposit paid by wire transfer earlier).
    const paidNow = Number(payload.P_AMT);
    const newAmountPaid = Math.min(existing.amountPaid + paidNow, existing.totalPrice);

    const updated = await BookingModel.updateBooking(
      bookingId,
      { amountPaid: newAmountPaid, paymentMethod: PaymentMethod.FONEPAY },
      existing.totalPrice
    );

    recordAuditLog({
      actorId: undefined, // no human actor — this is a gateway-verified payment
      action: "booking.payment.fonepay",
      entityType: "Booking",
      entityId: bookingId,
      meta: {
        prn: payload.PRN,
        uid: payload.UID,
        paidNow,
        derivedPaymentStatus: updated.paymentStatus,
      },
    });

    const contactEmail = updated.user?.email ?? existing.guestEmail;
    const contactName = updated.user?.name ?? existing.guestName ?? "there";
    if (contactEmail) {
      void sendMail(
        contactEmail,
        "Payment received",
        templates.paymentReceived(contactName, updated.trip.name, paidNow, updated.paymentStatus)
      );
    }

    res.json({ status: "success", data: updated });
  } catch (err) {
    next(err);
  }
}