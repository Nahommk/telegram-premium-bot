import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Inlined to avoid a circular import with @/bot/messaging.
function stripEmojiTagsLocal(s: string): string {
  return s
    .replace(/<ce:\d+>([\s\S]*?)<\/ce>/g, "$1")
    .replace(/<tg-emoji\s+emoji-id="\d+">([\s\S]*?)<\/tg-emoji>/g, "$1");
}

type TemplateVars = Record<string, string | number | undefined | null>;

export function renderMessageTemplate(body: string, vars: TemplateVars = {}): string {
  return body.replace(/\{(\w+)\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
}

export async function getMessageTemplate(key: string, fallback = ""): Promise<string> {
  const { data } = await supabaseAdmin
    .from("message_templates")
    .select("body")
    .eq("key", key)
    .maybeSingle();
  if (!data && fallback) {
    await supabaseAdmin.from("message_templates").insert({ key, body: fallback });
  }
  return data?.body ?? fallback;
}

export async function renderMessage(
  key: string,
  fallback: string,
  vars: TemplateVars = {},
): Promise<string> {
  return renderMessageTemplate(await getMessageTemplate(key, fallback), vars);
}

// Same as getMessageTemplate but strips <tg-emoji>/<ce:> markers down to
// their fallback char. Use for inline keyboard button labels and other
// surfaces where Telegram does not render HTML.
export async function getButtonLabel(key: string, fallback = ""): Promise<string> {
  return stripEmojiTagsLocal(await getMessageTemplate(key, fallback));
}
