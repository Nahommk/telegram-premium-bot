import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  verifyAuto, verifyCBE, verifyTelebirr, verifyDashen, verifyAbyssinia,
  verifyCbeBirr, verifyMpesa, verifyReceiptImage, type VerifyResult,
} from "./leulVerify";
import { recordAbuse } from "./security";
import { grantReward } from "./referral";
import { verifyAnyReceiver, loadAccounts, type PayoutProvider } from "./payoutAccounts";
import { renderMessage } from "./templates";

export interface ProcessResult {
  status: "delivered" | "waiting_manual" | "failed";
  code?: string;
  short_id?: string;
  reason?: string;
  reference?: string;
  amount_cents?: number;
  tip_cents?: number;
}

type PaymentOrder = {
  id: string;
  status: string;
  payment_method: "telebirr" | "cbe" | null;
  total_cents: number;
  expires_at: string;
};

async function logAttempt(opts: {
  orderId?: string; userTelegramId: number; reference?: string; status: string; error?: string;
}) {
  await supabaseAdmin.from("payment_attempts").insert({
    order_id: opts.orderId,
    user_telegram_id: opts.userTelegramId,
    reference: opts.reference,
    status: opts.status,
    error: opts.error,
  });
}

async function paymentReason(key: string, fallback: string, vars: Record<string, string | number | undefined | null> = {}) {
  return renderMessage(`payment_error_${key}`, fallback, vars);
}

function isProcessResult(value: PaymentOrder | ProcessResult): value is ProcessResult {
  return !("total_cents" in value);
}

async function cbeSuffix(): Promise<string | undefined> {
  const cbeAccounts = await loadAccounts("cbe");
  return (cbeAccounts[0]?.account || "").replace(/\D+/g, "").slice(-8) || undefined;
}

async function abyssiniaSuffix(): Promise<string | undefined> {
  const a = await loadAccounts("abyssinia");
  return (a[0]?.account || "").replace(/\D+/g, "").slice(-4) || undefined;
}

async function providerPhone(provider: "cbebirr" | "mpesa"): Promise<string | undefined> {
  const accounts = await loadAccounts(provider);
  return (accounts[0]?.msisdn ?? accounts[0]?.account ?? "").replace(/\D+/g, "") || undefined;
}

function verificationScore(v: VerifyResult): number {
  if (!v.ok) return -1;
  return (v.amount_cents !== undefined ? 4 : 0) +
    (v.receiver || v.receiverName ? 2 : 0) +
    (v.reference ? 1 : 0) +
    (v.provider ? 1 : 0);
}

// Detect provider from verification metadata + reference pattern. Falls back
// to telebirr if we can't tell (matches old behaviour).
function detectProvider(v: VerifyResult, reference: string): PayoutProvider {
  const p = String(v.provider ?? "").toLowerCase();
  if (p.includes("cbebirr") || p.includes("cbe birr") || p.includes("cbe_birr")) return "cbebirr";
  if (p.includes("mpesa") || p.includes("m-pesa")) return "mpesa";
  if (p.includes("dashen")) return "dashen";
  if (p.includes("abyssinia") || p.includes("boa")) return "abyssinia";
  if (p.includes("cbe")) return "cbe";
  if (p.includes("telebirr")) return "telebirr";
  if (/^FT[A-Z0-9]{10}$/i.test(reference)) return "cbe";
  return "telebirr";
}

// Map a verified provider to one of the two enum values stored on orders.
function enumProvider(p: PayoutProvider): "telebirr" | "cbe" {
  return (p === "cbe" || p === "cbebirr") ? "cbe" : "telebirr";
}

// Best-effort universal verification across every Leul-supported bank.
// We try the universal endpoint first (handles CBE / Telebirr / Dashen /
// Abyssinia / CBE Birr). If that fails we fall back to the dedicated
// endpoints for providers the universal router doesn't yet cover, so the
// admin can accept references from any bank Leul Verify supports.
export async function verifyReferenceAnyBank(reference: string): Promise<VerifyResult> {
  const ref = reference.trim();
  // Load all account context in parallel up-front instead of sequentially.
  const [suffix, boaSuffix, cbeBirrPhone, mpesaPhone] = await Promise.all([
    cbeSuffix(),
    abyssiniaSuffix(),
    providerPhone("cbebirr"),
    providerPhone("mpesa"),
  ]);

  const isCbeBankRef = /^FT[A-Z0-9]{10}$/i.test(ref);
  const isTelebirrRef = /^DEM[A-Z0-9]{6,}$/i.test(ref);

  // Fast path: if the reference pattern uniquely identifies a bank, try just
  // that endpoint first and return immediately on success — no need to race
  // every other provider.
  if (isCbeBankRef) {
    try {
      const r = await verifyCBE(ref, suffix);
      if (r.ok && verificationScore(r) >= 4) return r;
    } catch { /* fall through to broad search */ }
  } else if (isTelebirrRef) {
    try {
      const r = await verifyTelebirr(ref);
      if (r.ok && verificationScore(r) >= 4) return r;
    } catch { /* fall through */ }
  }

  // Broad search: race all remaining endpoints in parallel. Resolve as soon
  // as we get a high-confidence hit; otherwise wait for all and pick best.
  const candidates: Array<Promise<VerifyResult>> = [
    verifyAuto(ref, suffix),
    verifyTelebirr(ref),
    verifyDashen(ref),
    verifyAbyssinia(ref, boaSuffix ?? suffix),
    verifyCbeBirr(ref, cbeBirrPhone),
    verifyMpesa(ref, mpesaPhone),
  ].map((p) => p.catch((e): VerifyResult => ({ ok: false, raw: null, error: (e as Error).message })));

  return await new Promise<VerifyResult>((resolve) => {
    let bestOk: VerifyResult | undefined;
    let lastErr: VerifyResult = { ok: false, raw: null, error: "verification_not_attempted" };
    let remaining = candidates.length;
    let settled = false;
    for (const p of candidates) {
      p.then((r) => {
        if (settled) return;
        if (r.ok) {
          if (!bestOk || verificationScore(r) > verificationScore(bestOk)) bestOk = r;
          if (verificationScore(r) >= 7) {
            settled = true;
            resolve(r);
            return;
          }
        } else {
          lastErr = r;
        }
        if (--remaining === 0 && !settled) {
          settled = true;
          resolve(bestOk ?? lastErr);
        }
      });
    }
  });
}

async function loadAndCheckOrder(orderId: string, userTelegramId: number, reference?: string): Promise<PaymentOrder | ProcessResult> {
  const { data: order, error: orderErr } = await supabaseAdmin
    .from("orders")
    .select("id, status, payment_method, total_cents, expires_at")
    .eq("id", orderId)
    .maybeSingle();

  if (orderErr || !order) {
    await logAttempt({ orderId, userTelegramId, reference, status: "order_missing", error: orderErr?.message });
    return { status: "failed", reason: await paymentReason("order_missing", "Order not found.") };
  }
  if (order.status !== "pending") {
    await logAttempt({ orderId, userTelegramId, reference, status: "order_not_pending" });
    return { status: "failed", reason: await paymentReason("order_not_pending", "Order is {order_status}, can't verify.", { order_status: order.status }) };
  }
  if (!order.payment_method) {
    await logAttempt({ orderId, userTelegramId, reference, status: "no_method" });
    return { status: "failed", reason: await paymentReason("no_method", "Pick a payment method first.") };
  }
  if (new Date(order.expires_at) < new Date()) {
    await supabaseAdmin.from("orders").update({ status: "expired" }).eq("id", orderId);
    await logAttempt({ orderId, userTelegramId, reference, status: "expired" });
    return { status: "failed", reason: await paymentReason("expired", "Order has expired.") };
  }
  return order as PaymentOrder;
}

async function finishVerifiedPayment(opts: {
  order: PaymentOrder;
  orderId: string;
  userTelegramId: number;
  reference: string;
  verification: VerifyResult;
}): Promise<ProcessResult> {
  const { order, orderId, userTelegramId, reference, verification: v } = opts;
  const detectedProvider = detectProvider(v, reference);
  const recv = await verifyAnyReceiver(detectedProvider, v.receiver, v.receiverName);

  if (!recv.ok) {
    await logAttempt({ orderId, userTelegramId, reference, status: "receiver_mismatch", error: `receiver=${v.receiver}` });
    await recordAbuse(userTelegramId, "receiver_mismatch", 5, { reference, receiver: v.receiver });
    return { status: "failed", reason: await paymentReason("receiver_mismatch", recv.reason ?? "Receipt recipient does not match our accounts.", { reference, receiver: v.receiver }) };
  }

  if (v.amount_cents === undefined) {
    await logAttempt({ orderId, userTelegramId, reference, status: "no_amount" });
    return { status: "failed", reason: await paymentReason("no_amount", "Could not read amount from receipt.", { reference }) };
  }
  if (v.amount_cents < order.total_cents) {
    await logAttempt({
      orderId, userTelegramId, reference, status: "amount_mismatch",
      error: `expected=${order.total_cents} got=${v.amount_cents}`,
    });
    await recordAbuse(userTelegramId, "amount_mismatch", 4, { reference });
    return { status: "failed", reason: await paymentReason("amount_mismatch", "Amount mismatch. Expected {expected} ETB, receipt shows {received} ETB.", {
      reference,
      expected: (order.total_cents / 100).toFixed(2),
      received: (v.amount_cents / 100).toFixed(2),
    }) };
  }
  const tipCents = v.amount_cents - order.total_cents;

  // The DB enum only knows telebirr/cbe — map the detected bank into one of
  // those two for storage. The actual matched provider is captured in the
  // raw response we save below.
  const storedProvider = enumProvider(detectedProvider);
  if (order.payment_method !== storedProvider) {
    await supabaseAdmin.from("orders").update({ payment_method: storedProvider }).eq("id", orderId);
  }

  const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc("process_payment", {
    p_order_id: orderId,
    p_reference: reference,
    p_provider: storedProvider,
    p_amount_cents: v.amount_cents,
    p_raw: { detected_provider: detectedProvider, matched_provider: recv.matchedProvider, ...(v.raw as any) },
  });

  if (rpcErr) {
    const msg = rpcErr.message || "rpc_failed";
    await logAttempt({ orderId, userTelegramId, reference, status: "rpc_error", error: msg });
    const friendly = msg.includes("out_of_stock")
      ? await paymentReason("out_of_stock", "Out of stock — contact support, your payment is recorded.", { reference, error: msg })
      : msg.includes("duplicate") || msg.includes("unique")
      ? await paymentReason("duplicate_reference", "This reference was already used.", { reference, error: msg })
      : await paymentReason("finalize_failed", "Could not finalize delivery. Contact support.", { reference, error: msg });
    return { status: "failed", reason: friendly };
  }

  const row: any = Array.isArray(rpcData) ? rpcData[0] : rpcData;
  await logAttempt({ orderId, userTelegramId, reference, status: "delivered" });
  try { await grantReward(orderId); } catch (e) { console.error("[grantReward]", e); }

  if (row?.delivery_mode === "manual") {
    return { status: "waiting_manual", short_id: row?.short_id, reference, amount_cents: v.amount_cents, tip_cents: tipCents };
  }
  const deliveredCode =
  row?.delivered_code ??
  row?.code ??
  row?.content ??
  row?.delivery_code ??
  "";

return {
  status: "delivered",
  code: String(deliveredCode),
  short_id: row?.short_id,
  reference,
  amount_cents: v.amount_cents,
  tip_cents: tipCents,
};
}

async function duplicateCheck(orderId: string, userTelegramId: number, reference: string): Promise<ProcessResult | null> {
  const { data: existing } = await supabaseAdmin
    .from("payments")
    .select("id")
    .eq("reference", reference)
    .maybeSingle();
  if (!existing) return null;
  await logAttempt({ orderId, userTelegramId, reference, status: "duplicate_reference" });
  await recordAbuse(userTelegramId, "duplicate_reference", 3, { reference });
  return { status: "failed", reason: await paymentReason("duplicate_reference", "This reference was already used.", { reference }) };
}

async function reasonForVerifyFailure(reference: string, firstErr?: string): Promise<string> {
  const err = (firstErr || "").toLowerCase();
  if (err.includes("cbebirr_phone_not_configured")) {
    return paymentReason("cbebirr_unconfigured", "CBE Birr verification needs the merchant phone configured in Admin → Payment Accounts → CBE Birr.", { reference });
  }
  if (err.includes("abyssinia_suffix_not_configured")) {
    return paymentReason("abyssinia_unconfigured", "Bank of Abyssinia verification needs the account configured in Admin → Payment Accounts → Bank of Abyssinia.", { reference });
  }
  if (err.includes("404") || err.includes("not_found") || err.includes("not found")) {
    return paymentReason("not_found", "We couldn't find this reference on any supported bank yet. Banks can take 1–5 minutes to publish a transaction. Please wait a moment and resend the same reference, and double-check it matches your SMS exactly.", { reference, error: firstErr });
  }
  if (err.includes("401") || err.includes("403") || err.includes("unauthor")) {
    return paymentReason("unauthorized", "Verification service is misconfigured. Please contact support.", { reference, error: firstErr });
  }
  if (err.includes("network")) {
    return paymentReason("network", "Network issue while contacting the verification service. Please try again in a moment.", { reference, error: firstErr });
  }
  if (err.includes("timeout")) {
    return paymentReason("timeout", "Verification timed out. Please try again.", { reference, error: firstErr });
  }
  return paymentReason("generic", "Could not verify this reference ({error}). Make sure you sent to one of our accounts and copied the reference exactly from your SMS.", { reference, error: firstErr || "unknown error" });
}

export async function verifyAndDeliver(opts: {
  orderId: string;
  userTelegramId: number;
  reference: string;
}): Promise<ProcessResult> {
  const { orderId, userTelegramId } = opts;
  const reference = opts.reference.trim();
  const order = await loadAndCheckOrder(orderId, userTelegramId, reference);
  if (isProcessResult(order)) return order;

  const dup = await duplicateCheck(orderId, userTelegramId, reference);
  if (dup) return dup;

  let verification: VerifyResult;
  try {
    verification = await verifyReferenceAnyBank(reference);
  } catch (e) {
    await logAttempt({ orderId, userTelegramId, reference, status: "verify_threw", error: (e as Error).message });
    return { status: "failed", reason: await paymentReason("service_unavailable", "Verification service is temporarily unavailable. Please try again in a moment.", { error: (e as Error).message }) };
  }

  if (!verification.ok) {
    await logAttempt({ orderId, userTelegramId, reference, status: "verify_failed", error: verification.error });
    await recordAbuse(userTelegramId, "verify_failed", 2, { reference });
    return { status: "failed", reason: await reasonForVerifyFailure(reference, verification.error) };
  }

  return finishVerifiedPayment({ order, orderId, userTelegramId, reference, verification });
}

export async function verifyReceiptAndDeliver(opts: {
  orderId: string;
  userTelegramId: number;
  file: Blob;
  receiptHash?: string;
}): Promise<ProcessResult> {
  const { orderId, userTelegramId, file, receiptHash } = opts;
  const order = await loadAndCheckOrder(orderId, userTelegramId);
  if (isProcessResult(order)) return order;

  if (receiptHash) {
    const { data: existingHash } = await supabaseAdmin
      .from("receipt_hashes")
      .select("sha256")
      .eq("sha256", receiptHash)
      .maybeSingle();
    if (existingHash) {
      await logAttempt({ orderId, userTelegramId, status: "duplicate_receipt" });
      return { status: "failed", reason: await paymentReason("duplicate_receipt", "This receipt image was already used.") };
    }
  }

  let verification: VerifyResult;
  try {
    verification = await verifyReceiptImage(file, await cbeSuffix());
  } catch (e) {
    await logAttempt({ orderId, userTelegramId, status: "receipt_verify_threw", error: (e as Error).message });
    return { status: "failed", reason: await paymentReason("receipt_service_unavailable", "Receipt verification is temporarily unavailable. Please try again in a moment.", { error: (e as Error).message }) };
  }

  if (!verification.ok || !verification.reference) {
    await logAttempt({ orderId, userTelegramId, reference: verification.reference, status: "receipt_verify_failed", error: verification.error });
    await recordAbuse(userTelegramId, "receipt_verify_failed", 2, { error: verification.error });
    return { status: "failed", reason: await paymentReason("receipt_generic", "Could not verify this receipt image ({error}). Please send a clear screenshot/photo of the full receipt from any supported bank.", { error: verification.error || "unknown error" }) };
  }

  const reference = verification.reference.trim();
  const dup = await duplicateCheck(orderId, userTelegramId, reference);
  if (dup) return dup;

  // Receipt OCR is only trusted for extracting the reference. Amount and
  // recipient must come from reference verification, not from the picture.
  try {
    const refVerification = await verifyReferenceAnyBank(reference);
    if (refVerification.ok) {
      verification = { ...refVerification, raw: { image: verification.raw, reference: refVerification.raw } };
    } else {
      await logAttempt({ orderId, userTelegramId, reference, status: "receipt_reference_verify_failed", error: refVerification.error });
      return { status: "failed", reason: await reasonForVerifyFailure(reference, refVerification.error) };
    }
  } catch (e) {
    console.warn("[verifyReceiptAndDeliver] reference verification failed:", (e as Error).message);
    await logAttempt({ orderId, userTelegramId, reference, status: "receipt_reference_verify_threw", error: (e as Error).message });
    return { status: "failed", reason: await paymentReason("service_unavailable", "Verification service is temporarily unavailable. Please try again in a moment.", { reference, error: (e as Error).message }) };
  }

  const result = await finishVerifiedPayment({ order, orderId, userTelegramId, reference, verification });
  if (result.status !== "failed" && receiptHash) {
    await supabaseAdmin.from("receipt_hashes").insert({
      sha256: receiptHash,
      uploaded_by_telegram_id: userTelegramId,
      order_id: orderId,
    });
  }
  return result;
}
