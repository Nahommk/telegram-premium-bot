import { createHash, timingSafeEqual } from "crypto";

const TELEGRAM_SECRET_RE = /^[A-Za-z0-9_-]{1,256}$/;

export function getTelegramWebhookSecret(): string | null {
  const raw = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!raw) return null;
  if (TELEGRAM_SECRET_RE.test(raw)) return raw;
  return createHash("sha256").update(raw).digest("base64url");
}

export function safeEqualSecret(actual: string, expected: string): boolean {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}