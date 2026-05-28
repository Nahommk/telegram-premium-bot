// Leul Verify API wrapper. Docs: https://verify.leul.et/docs
// Server-only. Reads LEUL_VERIFY_API_KEY from process.env.
//
// IMPORTANT: The marketing site lives at verify.leul.et but the actual API
// is served from verifyapi.leulzenebe.pro — hitting the marketing host
// returns 404 for every /verify-* call.

const BASE = "https://verifyapi.leulzenebe.pro";
const REQUEST_HEADERS = {
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
};

export interface VerifyResult {
  ok: boolean;
  provider?: "telebirr" | "cbe" | string;
  amount_cents?: number;
  reference?: string;
  payer?: string;
  receiver?: string;
  receiverName?: string;
  date?: string;
  raw: unknown;
  error?: string;
}

function getKey(): string {
  const k = process.env.LEUL_VERIFY_API_KEY;
  if (!k) throw new Error("LEUL_VERIFY_API_KEY is not configured");
  return k;
}

async function call(path: string, body: Record<string, unknown>): Promise<VerifyResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        ...REQUEST_HEADERS,
        "Content-Type": "application/json",
        "x-api-key": getKey(),
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, raw: null, error: `network: ${(e as Error).message}` };
  }

  let json: any = null;
  try { json = await res.json(); } catch { /* keep null */ }

  if (!res.ok) {
    return {
      ok: false,
      raw: json ?? { status: res.status },
      error: json?.message || json?.error || `http_${res.status}`,
    };
  }

  // Leul Verify typically returns { success: true, data: { ... } }
  const data = json?.data ?? json;
  const success =
    json?.success === true ||
    json?.status === "success" ||
    json?.ok === true ||
    (data && (data.amount !== undefined || data.txn_ref !== undefined || data.reference !== undefined));

  if (!success) {
    return { ok: false, raw: json, error: json?.message || "verification_failed" };
  }

  const amountRaw =
    data?.amount ?? data?.total ?? data?.txn_amount ?? data?.transaction_amount ?? data?.transactionAmount ??
    data?.settled_amount ?? data?.settledAmount ?? data?.total_paid_amount ?? data?.totalPaidAmount;
  const amountNum =
    typeof amountRaw === "string" ? parseFloat(amountRaw.replace(/[, ]/g, "")) :
    typeof amountRaw === "number" ? amountRaw : NaN;

  const providerRaw = (data?.provider ?? json?.provider ?? "").toString().toLowerCase();
  const provider: "telebirr" | "cbe" | string | undefined =
    providerRaw.includes("telebirr") ? "telebirr" :
    providerRaw.includes("cbe") ? "cbe" :
    providerRaw || undefined;

  return {
    ok: true,
    provider,
    amount_cents: Number.isFinite(amountNum) ? Math.round(amountNum * 100) : undefined,
    reference: data?.txn_ref ?? data?.reference ?? data?.transaction_id ?? data?.transactionReference ?? data?.receiptNumber ?? data?.id,
    payer: data?.payer ?? data?.from ?? data?.payer_name ?? data?.payerName ?? data?.senderName,
    receiver: data?.receiver ?? data?.to ?? data?.receiver_name ?? data?.receiverName ?? data?.receiverAccount ??
      data?.credited_account ?? data?.creditedAccount ?? data?.creditedPartyAccountNo ?? data?.creditedPartyAccount ?? data?.creditedPartyName,
    receiverName: data?.receiver_name ?? data?.receiverName ?? data?.creditedPartyName,
    date: data?.date ?? data?.created_at ?? data?.payment_date ?? data?.transactionDate ?? data?.paymentDate,
    raw: json,
  };
}

async function callImage(file: Blob, suffix?: string): Promise<VerifyResult> {
  let res: Response;
  try {
    const body = new FormData();
    body.append("file", file, "receipt.jpg");
    if (suffix) body.append("suffix", suffix);
    res = await fetch(`${BASE}/verify-image?autoVerify=true`, {
      method: "POST",
      headers: {
        ...REQUEST_HEADERS,
        "x-api-key": getKey(),
      },
      body,
    });
  } catch (e) {
    return { ok: false, raw: null, error: `network: ${(e as Error).message}` };
  }

  let json: any = null;
  try { json = await res.json(); } catch { /* keep null */ }

  if (!res.ok) {
    return {
      ok: false,
      raw: json ?? { status: res.status },
      error: json?.message || json?.error || `http_${res.status}`,
    };
  }

  const data = json?.data ?? json?.extractedData ?? json?.result ?? json;
  const reference =
    data?.txn_ref ?? data?.reference ?? data?.transaction_id ?? data?.transactionReference ??
    data?.receiptNumber ?? data?.receipt_number ?? data?.id;
  if (!reference) {
    return { ok: false, raw: json, error: json?.message || "receipt_reference_missing" };
  }

  const amountRaw =
    data?.amount ?? data?.total ?? data?.txn_amount ?? data?.transaction_amount ?? data?.transactionAmount ??
    data?.settled_amount ?? data?.settledAmount ?? data?.total_paid_amount ?? data?.totalPaidAmount;
  const amountNum =
    typeof amountRaw === "string" ? parseFloat(amountRaw.replace(/[, ]/g, "")) :
    typeof amountRaw === "number" ? amountRaw : NaN;

  const providerRaw = (data?.provider ?? data?.type ?? json?.provider ?? json?.type ?? "").toString().toLowerCase();
  const provider: "telebirr" | "cbe" | string | undefined =
    providerRaw.includes("telebirr") ? "telebirr" :
    providerRaw.includes("cbe") ? "cbe" :
    providerRaw || undefined;

  const receiver = data?.receiver ?? data?.to ?? data?.receiver_name ?? data?.receiverName ?? data?.receiverAccount ??
    data?.credited_account ?? data?.creditedAccount ?? data?.creditedPartyAccountNo ?? data?.creditedPartyAccount ?? data?.creditedPartyName ??
    data?.bankAccountNumber ?? data?.bank_account_number ?? data?.accountNumber ?? data?.account_number ??
    data?.transactionTo ?? data?.transaction_to ?? data?.receiverPhone ?? data?.receiver_phone ?? data?.beneficiaryAccount;
  const receiverName = data?.receiver_name ?? data?.receiverName ?? data?.creditedPartyName ??
    data?.transactionTo ?? data?.transaction_to ?? data?.receiverFullName ?? data?.beneficiaryName ?? data?.toName;

  if (!receiver && !receiverName) {
    console.warn("[verifyReceiptImage] receiver not extracted; raw=", JSON.stringify(json).slice(0, 1500));
  }

  return {
    ok: true,
    provider,
    amount_cents: Number.isFinite(amountNum) ? Math.round(amountNum * 100) : undefined,
    reference,
    payer: data?.payer ?? data?.from ?? data?.payer_name ?? data?.payerName ?? data?.senderName ??
      data?.payerAccount ?? data?.debitedPartyName ?? data?.debitedPartyAccount ?? data?.transactionFrom ?? data?.transaction_from,
    receiver,
    receiverName,
    date: data?.date ?? data?.created_at ?? data?.payment_date ?? data?.transactionDate ?? data?.paymentDate,
    raw: json,
  };
}

// Universal endpoint — auto-detects provider from the reference format.
// Pass `suffix` (last 8 of CBE account) when known; Telebirr/Dashen ignore it.
// Pass `phoneNumber` when known (required by CBE Birr / M-Pesa).
export function verifyAuto(reference: string, suffix?: string, phoneNumber?: string): Promise<VerifyResult> {
  const body: Record<string, unknown> = { reference };
  if (suffix) body.suffix = suffix;
  if (phoneNumber) body.phoneNumber = phoneNumber;
  return call("/verify", body);
}

export function verifyTelebirr(reference: string): Promise<VerifyResult> {
  return call("/verify-telebirr", { reference });
}

export async function verifyCBE(reference: string, suffix?: string): Promise<VerifyResult> {
  // Some CBE references (e.g. 10-char) reject when a suffix is supplied.
  // Try with suffix first, then transparently retry without it.
  const first = await call("/verify-cbe", suffix ? { reference, accountSuffix: suffix } : { reference });
  if (first.ok) return first;
  const err = (first.error || "").toLowerCase();
  if (suffix && (err.includes("suffix") || err.includes("not expected"))) {
    return call("/verify-cbe", { reference });
  }
  return first;
}

export function verifyDashen(reference: string): Promise<VerifyResult> {
  return call("/verify-dashen", { reference });
}

export function verifyAbyssinia(reference: string, suffix?: string): Promise<VerifyResult> {
  // BoA endpoint hard-requires a suffix — skip the call if we don't have one
  // configured, so the broad search doesn't waste a slot and report a noisy
  // "Missing required parameters" error.
  if (!suffix) return Promise.resolve({ ok: false, raw: null, error: "abyssinia_suffix_not_configured" });
  return call("/verify-abyssinia", { reference, accountSuffix: suffix, suffix });
}

export function verifyCbeBirr(reference: string, phoneNumber?: string): Promise<VerifyResult> {
  // CBE Birr hard-requires the merchant phone number.
  if (!phoneNumber) return Promise.resolve({ ok: false, raw: null, error: "cbebirr_phone_not_configured" });
  return call("/verify-cbebirr", { reference, phoneNumber, receiptNumber: reference });
}

export function verifyMpesa(reference: string, phoneNumber?: string): Promise<VerifyResult> {
  if (!phoneNumber) return Promise.resolve({ ok: false, raw: null, error: "mpesa_phone_not_configured" });
  return call("/verify-mpesa", { reference, phoneNumber, receiptReference: reference });
}

export function verifyReceiptImage(file: Blob, suffix?: string): Promise<VerifyResult> {
  return callImage(file, suffix);
}
