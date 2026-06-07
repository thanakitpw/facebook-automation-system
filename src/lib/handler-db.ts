import { serviceClient } from './supabase/server'
import type { HandlerDb } from './handlers'

export function makeHandlerDb(): HandlerDb {
  const sb = serviceClient()
  return {
    async findPageByFbId(fbPageId) {
      const { data } = await sb.from('pages').select('id, access_token_enc').eq('fb_page_id', fbPageId).maybeSingle()
      return data ?? null
    },
    async upsertContact(c) {
      await sb.from('contacts').upsert(
        { page_id: c.pageId, psid: c.psid, name: c.name ?? null, last_interaction_at: c.lastInteractionAt?.toISOString() ?? null },
        { onConflict: 'page_id,psid' },
      )
    },
    async rulesForPost(fbPostId) {
      const { data: post } = await sb.from('posts').select('id').eq('fb_post_id', fbPostId).maybeSingle()
      if (!post) return []
      const { data } = await sb.from('keyword_rules').select('id, keyword, match_type, template_id, reply_once').eq('post_id', post.id)
      return data ?? []
    },
    async alreadyReplied(commentId, ruleId) {
      const { data } = await sb.from('message_queue').select('id').eq('idempotency_key', `reply:${commentId}:${ruleId}`).maybeSingle()
      return !!data
    },
    async enqueue(job) {
      await sb.from('message_queue').insert(job)
    },
  }
}
