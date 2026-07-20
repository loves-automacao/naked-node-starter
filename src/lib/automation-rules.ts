export interface AutomationInput {
  id?: string;
  name: string;
  instagram_post_id: string;
  instagram_post_type: string;
  custom_message: string;
  followup_message: string;
  quick_replies: { title: string; payload: string }[];
  buttons: { type: string; title: string; payload?: string; url?: string }[];
  is_active: boolean;
  keyword_filter_enabled: boolean;
  keywords: string[];
  delay_min_seconds: number;
  delay_max_seconds: number;
  trigger_on_dm?: boolean;
}

function boundedDelay(value: number, fallback: number): number {
  const candidate = Number.isFinite(value) ? value : fallback;
  return Math.max(30, Math.min(120, candidate || fallback));
}

export function validateAutomationInput(input: AutomationInput): AutomationInput {
  const name = input.name?.trim();
  if (!name || name.length > 200) throw new Error("Nome inválido");

  const postId = input.instagram_post_id?.trim();
  if (!postId) throw new Error("Post ID é obrigatório");

  const min = boundedDelay(input.delay_min_seconds, 30);
  const max = Math.max(min, boundedDelay(input.delay_max_seconds, 60));
  const keywords = (input.keywords || [])
    .map((keyword) => keyword.trim().toLowerCase())
    .filter(Boolean);

  return {
    ...input,
    name,
    instagram_post_id: postId,
    custom_message: input.custom_message ?? "",
    followup_message: input.followup_message ?? "",
    delay_min_seconds: min,
    delay_max_seconds: max,
    quick_replies: (input.quick_replies || []).slice(0, 13),
    buttons: (input.buttons || []).slice(0, 3),
    keywords: [...new Set(keywords)],
  };
}
