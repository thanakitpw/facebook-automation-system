const DAY_MS = 24 * 60 * 60 * 1000

export const ALLOWED_TAGS = ['ACCOUNT_UPDATE', 'CONFIRMED_EVENT_UPDATE', 'POST_PURCHASE_UPDATE', 'HUMAN_AGENT'] as const

export type SendDecision =
  | { ok: true; messagingType: 'RESPONSE' }
  | { ok: true; messagingType: 'MESSAGE_TAG'; tag: string }
  | { ok: false; reason: 'outside_window_no_tag' }

export function canSend(args: {
  lastInteractionAt: Date | null
  tag: string | null
  now: Date
}): SendDecision {
  const { lastInteractionAt, tag, now } = args
  const inWindow = lastInteractionAt != null && now.getTime() - lastInteractionAt.getTime() < DAY_MS
  if (inWindow) return { ok: true, messagingType: 'RESPONSE' }
  if (tag && (ALLOWED_TAGS as readonly string[]).includes(tag)) return { ok: true, messagingType: 'MESSAGE_TAG', tag }
  return { ok: false, reason: 'outside_window_no_tag' }
}
