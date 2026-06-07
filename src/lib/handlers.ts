import type { WebhookEvent } from './facebook/parse'
import { matchRules } from './matching'

export interface HandlerDb {
  findPageByFbId(fbPageId: string): Promise<{ id: string; access_token_enc: string } | null>
  upsertContact(c: { pageId: string; psid: string; name?: string; lastInteractionAt?: Date }): Promise<void>
  rulesForPost(fbPostId: string): Promise<Array<{ id: string; keyword: string; match_type: 'exact' | 'contains'; template_id: string; reply_once: boolean }>>
  alreadyReplied(commentId: string, ruleId: string): Promise<boolean>
  enqueue(job: { page_id: string; recipient_psid: string; job_type: 'auto_reply'; payload: any; idempotency_key: string }): Promise<void>
}

export async function handleEvents(events: WebhookEvent[], db: HandlerDb): Promise<void> {
  for (const ev of events) {
    const page = await db.findPageByFbId(ev.pageId)
    if (!page) continue

    if (ev.type === 'message') {
      await db.upsertContact({ pageId: page.id, psid: ev.psid, lastInteractionAt: new Date(ev.timestamp) })
      continue
    }

    // comment
    await db.upsertContact({ pageId: page.id, psid: ev.fromId, name: ev.fromName })
    const rules = await db.rulesForPost(ev.postId)
    const matched = matchRules(ev.message, rules)
    for (const rule of matched) {
      if (rule.reply_once && (await db.alreadyReplied(ev.commentId, rule.id))) continue
      await db.enqueue({
        page_id: page.id,
        recipient_psid: ev.fromId,
        job_type: 'auto_reply',
        payload: { commentId: ev.commentId, templateId: rule.template_id, ruleId: rule.id },
        idempotency_key: `reply:${ev.commentId}:${rule.id}`,
      })
    }
  }
}
