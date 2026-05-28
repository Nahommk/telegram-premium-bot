import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PayoutProvider = "telebirr" | "cbe" | "dashen" | "abyssinia" | "cbebirr" | "mpesa";

export const ALL_PROVIDERS: PayoutProvider[] = [
  "telebirr", "cbe", "dashen", "abyssinia", "cbebirr", "mpesa",
];

export const PROVIDER_LABELS: Record<PayoutProvider, string> = {
  telebirr: "Telebirr",
  cbe: "CBE",
  dashen: "Dashen",
  abyssinia: "Bank of Abyssinia",
  cbebirr: "CBE Birr",
  mpesa: "M-Pesa",
};

export interface PayoutAccount {
  // Free-form identifier for the account (phone for mobile money, account
  // number for banks). Either `msisdn` or `account` may be set; we read both.
  msisdn?: string;
  account?: string;
  name?: string;
}

function normDigits(s: string | undefined | null): string {
  if (!s) return "";
  const d = s.replace(/\D+/g, "");
  return d.length > 9 ? d.slice(-9) : d;
}

function normName(s: string | undefined | null): string {
  return (s || "")
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|ato|wro|dr)\.?\b/g, "")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function digitMatch(configured: string, received: string, nameMatches: boolean): boolean {
  if (!configured || !received) return false;
  if (configured === received) return true;
  const shorter = configured.length <= received.length ? configured : received;
  const longer = configured.length > received.length ? configured : received;
  if (shorter.length >= 8 && longer.endsWith(shorter)) return true;
  return nameMatches && shorter.length >= 4 && longer.endsWith(shorter);
}

function nameMatch(configured: string | undefined, received: string): boolean {
  const confName = normName(configured);
  if (!confName || !received) return false;
  return confName === received || confName.includes(received) || received.includes(confName);
}

function settingsKey(p: PayoutProvider): string {
  return `payout_${p}`;
}

export async function loadAccounts(provider: PayoutProvider): Promise<PayoutAccount[]> {
  const { data } = await supabaseAdmin.from("settings").select("value").eq("key", settingsKey(provider)).maybeSingle();
  const raw = data?.value;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as PayoutAccount[];
  return [raw as PayoutAccount];
}

export async function loadAllAccounts(): Promise<Record<PayoutProvider, PayoutAccount[]>> {
  const entries = await Promise.all(
    ALL_PROVIDERS.map(async (p) => [p, await loadAccounts(p)] as const),
  );
  return Object.fromEntries(entries) as Record<PayoutProvider, PayoutAccount[]>;
}

export async function verifyReceiver(
  provider: PayoutProvider,
  receiver: string | undefined,
  receiverName?: string | undefined,
): Promise<{ ok: boolean; configured: boolean; reason?: string }> {
  const accounts = await loadAccounts(provider);
  if (accounts.length === 0) {
    return { ok: true, configured: false };
  }

  const recvDigits = normDigits(receiver);
  const recvName = normName(receiverName);

  for (const a of accounts) {
    const isMobile = provider === "telebirr" || provider === "cbebirr" || provider === "mpesa";
    const acctDigits = normDigits(isMobile ? (a.msisdn ?? a.account) : (a.account ?? a.msisdn));
    const namesMatch = nameMatch(a.name, recvName);
    if (digitMatch(acctDigits, recvDigits, namesMatch)) {
      return { ok: true, configured: true };
    }
    if (namesMatch) {
      return { ok: true, configured: true };
    }
  }

  const expected = accounts
    .map((a) => `${a.name ?? "?"} (${a.msisdn ?? a.account ?? "?"})`)
    .join(", ");
  const got = [receiverName, receiver].filter(Boolean).join(" / ") || "unknown";
  return {
    ok: false,
    configured: true,
    reason: `Receipt was paid to "${got}" but our ${PROVIDER_LABELS[provider]} account is ${expected}. Please pay to the correct account.`,
  };
}

// Check the receipt against ALL configured payout accounts across every
// supported provider. Order: preferred provider first, then the rest.
export async function verifyAnyReceiver(
  preferredProvider: PayoutProvider | undefined,
  receiver: string | undefined,
  receiverName?: string | undefined,
): Promise<{ ok: boolean; configured: boolean; matchedProvider?: PayoutProvider; reason?: string }> {
  const order: PayoutProvider[] = preferredProvider
    ? [preferredProvider, ...ALL_PROVIDERS.filter((p) => p !== preferredProvider)]
    : [...ALL_PROVIDERS];

  let firstReason: string | undefined;
  let anyConfigured = false;
  for (const p of order) {
    const r = await verifyReceiver(p, receiver, receiverName);
    if (r.ok) return { ...r, matchedProvider: p };
    if (r.configured) {
      anyConfigured = true;
      firstReason ??= r.reason;
    }
  }
  return {
    ok: false,
    configured: anyConfigured,
    reason: firstReason ?? "Receipt is not paid to any of our configured accounts.",
  };
}
