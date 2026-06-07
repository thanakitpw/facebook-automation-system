import { serviceClient } from './supabase/server'
import { decryptToken } from './crypto'
import { sendMessage, sendPrivateReply } from './facebook/client'
import type { ProcessDeps, QueueJob } from './queue'

export function makeProcessDeps(now: Date): ProcessDeps {
  const sb = serviceClient()
  return {
    now,
    graphVersion: process.env.FB_GRAPH_VERSION!,
    async loadContext(job: QueueJob) {
      const pageId = (job as unknown as { page_id: string }).page_id
      const { data: page } = await sb.from('pages').select('access_token_enc').eq('id', pageId).single()
      const { data: contact } = await sb.from('contacts').select('last_interaction_at').eq('page_id', pageId).eq('psid', job.recipient_psid).maybeSingle()
      return {
        pageToken: decryptToken(page!.access_token_enc),
        lastInteractionAt: contact?.last_interaction_at ? new Date(contact.last_interaction_at) : null,
      }
    },
    async loadTemplate(id) {
      const { data } = await sb.from('message_templates').select('type, text, media_url, buttons').eq('id', id).single()
      return data!
    },
    send: (a) => sendMessage(a),
    privateReply: (a) => sendPrivateReply(a),
    async markSent(id, messageId) {
      const { data: job } = await sb.from('message_queue').select('page_id, recipient_psid, job_type').eq('id', id).single()
      await sb.from('message_queue').update({ status: 'sent' }).eq('id', id)
      if (job) await sb.from('message_logs').insert({ page_id: job.page_id, recipient_psid: job.recipient_psid, job_type: job.job_type, status: 'sent', fb_message_id: messageId })
    },
    async markRetry(id, when, err) {
      await sb.from('message_queue').update({ status: 'pending', scheduled_at: when.toISOString(), last_error: err }).eq('id', id)
      await sb.rpc('increment_attempts', { job_id: id })
    },
    async markFailed(id, err) {
      const { data: job } = await sb.from('message_queue').select('page_id, recipient_psid, job_type').eq('id', id).single()
      await sb.from('message_queue').update({ status: 'failed', last_error: err }).eq('id', id)
      if (job) await sb.from('message_logs').insert({ page_id: job.page_id, recipient_psid: job.recipient_psid, job_type: job.job_type, status: 'failed', error: err })
    },
  }
}
