export type WebhookEvent =
  | { type: 'message'; pageId: string; psid: string; text: string; timestamp: number }
  | { type: 'comment'; pageId: string; commentId: string; postId: string; fromId: string; fromName?: string; message: string }

export function parseWebhook(body: any): WebhookEvent[] {
  if (body?.object !== 'page' || !Array.isArray(body.entry)) return []
  const out: WebhookEvent[] = []
  for (const entry of body.entry) {
    const pageId = entry.id
    for (const m of entry.messaging ?? []) {
      if (m.message?.text && m.sender?.id) {
        out.push({ type: 'message', pageId, psid: m.sender.id, text: m.message.text, timestamp: m.timestamp })
      }
    }
    for (const c of entry.changes ?? []) {
      const v = c.value
      if (c.field === 'feed' && v?.item === 'comment' && v.verb === 'add') {
        out.push({ type: 'comment', pageId, commentId: v.comment_id, postId: v.post_id, fromId: v.from?.id, fromName: v.from?.name, message: v.message ?? '' })
      }
    }
  }
  return out
}
