import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Bot } from "grammy";
import type { BotCtx } from "@/bot/bot";
import { toHtml } from "@/bot/messaging";

export interface BroadcastInput {
  adminId: number;
  kind: "text" | "photo";
  text?: string;
  photoFileId?: string;
  buttons?: { label: string; url: string }[];
}

export async function createBroadcast(input: BroadcastInput): Promise<string> {
  const { data: users } = await supabaseAdmin
    .from("bot_users").select("telegram_id").eq("is_banned", false);
  const ids = (users ?? []).map((u: any) => Number(u.telegram_id));

  const { data: bc, error } = await supabaseAdmin.from("broadcasts").insert({
    admin_telegram_id: input.adminId,
    kind: input.kind,
    text: input.text ?? null,
    photo_file_id: input.photoFileId ?? null,
    buttons: (input.buttons as any) ?? null,
    total: ids.length,
    status: "queued",
  }).select("id").single();
  if (error || !bc) throw error ?? new Error("broadcast_insert_failed");

  if (ids.length > 0) {
    const chunks: any[] = ids.map((tid) => ({ broadcast_id: bc.id, telegram_id: tid }));
    // Insert in batches of 1000
    for (let i = 0; i < chunks.length; i += 1000) {
      await supabaseAdmin.from("broadcast_targets").insert(chunks.slice(i, i + 1000));
    }
  }
  return bc.id;
}

export async function cancelBroadcast(id: string) {
  await supabaseAdmin.from("broadcasts").update({ status: "cancelled" }).eq("id", id);
}

export async function getBroadcast(id: string) {
  const { data } = await supabaseAdmin.from("broadcasts").select("*").eq("id", id).maybeSingle();
  return data;
}

// Process a batch. Caller decides how often to invoke.
export async function processBatch(bot: Bot<BotCtx>, id: string, batchSize = 25): Promise<{ done: boolean; sent: number; failed: number }> {
  const bc = await getBroadcast(id);
  if (!bc) return { done: true, sent: 0, failed: 0 };
  if (bc.status === "cancelled" || bc.status === "done") return { done: true, sent: 0, failed: 0 };

  await supabaseAdmin.from("broadcasts").update({ status: "running" }).eq("id", id);

  const { data: targets } = await supabaseAdmin
    .from("broadcast_targets").select("telegram_id")
    .eq("broadcast_id", id).eq("status", "pending").limit(batchSize);

  if (!targets || targets.length === 0) {
    await supabaseAdmin.from("broadcasts").update({ status: "done" }).eq("id", id);
    return { done: true, sent: 0, failed: 0 };
  }

  let sent = 0, failed = 0;
  const inline = bc.buttons && Array.isArray(bc.buttons) && bc.buttons.length
    ? { inline_keyboard: [(bc.buttons as any[]).map((b) => ({ text: b.label, url: b.url }))] }
    : undefined;

  for (const t of targets as any[]) {
    const tid = Number(t.telegram_id);
    try {
      const htmlText = toHtml(String(bc.text ?? ""));

if (bc.kind === "photo" && bc.photo_file_id) {
  await bot.api.sendPhoto(tid, bc.photo_file_id, {
    caption: htmlText || undefined,
    parse_mode: htmlText ? "HTML" : undefined,
    reply_markup: inline,
  });
} else {
  await bot.api.sendMessage(tid, htmlText, {
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: inline,
  });
}
      await supabaseAdmin.from("broadcast_targets").update({
        status: "sent", sent_at: new Date().toISOString(),
      }).eq("broadcast_id", id).eq("telegram_id", tid);
      sent++;
    } catch (e: any) {
      await supabaseAdmin.from("broadcast_targets").update({
        status: "failed", error: e?.message?.slice(0, 200),
      }).eq("broadcast_id", id).eq("telegram_id", tid);
      failed++;
    }
    // Telegram rate limit ~30 msg/sec globally
    await new Promise((r) => setTimeout(r, 40));
  }

  await supabaseAdmin.from("broadcasts").update({
    sent: (bc.sent ?? 0) + sent,
    failed: (bc.failed ?? 0) + failed,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  // Progress message edit
  if (bc.progress_chat_id && bc.progress_message_id) {
    const totalDone = (bc.sent ?? 0) + sent + (bc.failed ?? 0) + failed;
    try {
      await bot.api.editMessageText(
        Number(bc.progress_chat_id), Number(bc.progress_message_id),
        `📣 Broadcast progress: ${totalDone}/${bc.total} (✅ ${(bc.sent ?? 0) + sent} · ❌ ${(bc.failed ?? 0) + failed})`,
      );
    } catch { /* ignore */ }
  }

  return { done: false, sent, failed };
}

export async function runUntilDrained(bot: Bot<BotCtx>, id: string, maxBatches = 50) {
  for (let i = 0; i < maxBatches; i++) {
    const { done } = await processBatch(bot, id, 25);
    if (done) return;
  }
}
