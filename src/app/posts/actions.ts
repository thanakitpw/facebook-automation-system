'use server'
import { serviceClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/crypto'

const V = process.env.FB_GRAPH_VERSION!

export async function syncPosts(pageRowId: string) {
  const sb = serviceClient()
  const { data: page } = await sb.from('pages').select('fb_page_id, access_token_enc').eq('id', pageRowId).single()
  const token = decryptToken(page!.access_token_enc)
  const res = await fetch(`https://graph.facebook.com/${V}/${page!.fb_page_id}/posts?fields=id,message,permalink_url&access_token=${token}`)
  const data = await res.json()
  for (const p of data.data ?? []) {
    await sb.from('posts').upsert({ page_id: pageRowId, fb_post_id: p.id, message: p.message ?? null, permalink: p.permalink_url ?? null }, { onConflict: 'fb_post_id' })
  }
}

export async function saveRule(input: { postId: string; keyword: string; matchType: 'exact' | 'contains'; templateId: string; replyOnce: boolean }) {
  const sb = serviceClient()
  await sb.from('keyword_rules').insert({ post_id: input.postId, keyword: input.keyword, match_type: input.matchType, template_id: input.templateId, reply_once: input.replyOnce })
}
