// Server-only helpers for the bot.
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function envAdminIds(): Set<string> {
  const raw = process.env.ADMIN_TELEGRAM_IDS ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

// Hard-coded env admins are always allowed AND cannot be removed via the bot UI.
export function isEnvAdmin(telegramId: number | bigint): boolean {
  return envAdminIds().has(String(telegramId));
}

// Cache DB admins for 30s to avoid hitting the DB on every update.
let _dbAdmins: Set<string> | null = null;
let _dbAdminsTs = 0;
const ADMIN_CACHE_MS = 30_000;

export function invalidateAdminCache() {
  _dbAdmins = null;
  _dbAdminsTs = 0;
}

async function loadDbAdmins(): Promise<Set<string>> {
  if (_dbAdmins && Date.now() - _dbAdminsTs < ADMIN_CACHE_MS) return _dbAdmins;
  const { data } = await supabaseAdmin.from("admins").select("telegram_id");
  _dbAdmins = new Set((data ?? []).map((r: any) => String(r.telegram_id)));
  _dbAdminsTs = Date.now();
  return _dbAdmins;
}

export async function isAdmin(telegramId: number | bigint): Promise<boolean> {
  const id = String(telegramId);
  if (envAdminIds().has(id)) return true;
  const db = await loadDbAdmins();
  return db.has(id);
}

export async function listAllAdmins(): Promise<
  Array<{ telegram_id: number; source: "env" | "db"; added_by_telegram_id?: number | null; note?: string | null }>
> {
  const env = Array.from(envAdminIds()).map((s) => ({ telegram_id: Number(s), source: "env" as const }));
  const { data } = await supabaseAdmin
    .from("admins").select("telegram_id, added_by_telegram_id, note")
    .order("created_at", { ascending: true });
  const db = (data ?? []).map((r: any) => ({
    telegram_id: Number(r.telegram_id),
    source: "db" as const,
    added_by_telegram_id: r.added_by_telegram_id,
    note: r.note,
  }));
  return [...env, ...db];
}

export async function addDbAdmin(telegramId: number, addedBy: number, note?: string) {
  const { error } = await supabaseAdmin.from("admins").insert({
    telegram_id: telegramId, added_by_telegram_id: addedBy, note: note ?? null,
  });
  if (error) throw error;
  invalidateAdminCache();
}

export async function removeDbAdmin(telegramId: number) {
  if (isEnvAdmin(telegramId)) throw new Error("env_admin_cannot_be_removed");
  const { error } = await supabaseAdmin.from("admins").delete().eq("telegram_id", telegramId);
  if (error) throw error;
  invalidateAdminCache();
}

export function formatPrice(cents: number): string {
  // ETB has 2 decimals; price stored in cents (1 ETB = 100 cents).
  return (cents / 100).toFixed(2);
}

// Kept for existing imports; message template rendering lives in services/templates.
export function renderTemplate(body: string, vars: Record<string, string | number | undefined | null>): string {
  return body.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
