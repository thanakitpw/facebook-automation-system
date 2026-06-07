'use server'
import { serviceClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/supabase/auth-server'
import { assertPageOwner } from '@/lib/ownership'
import { resolveAudience } from '@/lib/audience'

export async function startBroadcast(input: { pageId: string; templateId: string; tag: string | null; requireTag?: string }) {
  const { user } = await requireUser()
  await assertPageOwner(input.pageId, user.id)
  const sb = serviceClient()
  const { data: contacts } = await sb.from('contacts')
    .select('psid, subscribed, last_interaction_at, tags').eq('page_id', input.pageId)
  const audience = resolveAudience(contacts ?? [], { hasTag: !!input.tag, requireTag: input.requireTag }, new Date())

  const { data: bc } = await sb.from('broadcasts').insert({
    page_id: input.pageId, template_id: input.templateId, message_tag: input.tag, status: 'queued',
    stats: { total: audience.length },
  }).select('id').single()

  if (audience.length) {
    await sb.from('message_queue').insert(audience.map((c) => ({
      page_id: input.pageId, recipient_psid: c.psid, job_type: 'broadcast',
      payload: { templateId: input.templateId, tag: input.tag, broadcastId: bc!.id },
      idempotency_key: `bc:${bc!.id}:${c.psid}`,
    })))
  }
  return { queued: audience.length }
}
