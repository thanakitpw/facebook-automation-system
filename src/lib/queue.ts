import { canSend } from './window'
import type { MessagePayload, SendResult } from './facebook/types'

export const MAX_ATTEMPTS = 5
const BASE_MS = 60_000
const CAP_MS = 3_600_000

export function nextBackoffMs(attempt: number): number {
  return Math.min(BASE_MS * 2 ** (attempt - 1), CAP_MS)
}

export interface ProcessDeps {
  loadContext(job: QueueJob): Promise<{ pageToken: string; lastInteractionAt: Date | null }>
  loadTemplate(templateId: string): Promise<{ type: string; text: string | null; media_url: string | null; buttons: any }>
  send(a: { pageToken: string; recipientPsid: string; messagingType: 'RESPONSE' | 'MESSAGE_TAG'; tag?: string; payload: MessagePayload; graphVersion: string }): Promise<SendResult>
  privateReply(a: { pageToken: string; commentId: string; message: string; graphVersion: string }): Promise<{ ok: true; recipientPsid: string } | { ok: false; error: string }>
  markSent(id: string, messageId: string, psid?: string): Promise<void>
  markRetry(id: string, when: Date, err: string): Promise<void>
  markFailed(id: string, err: string): Promise<void>
  now: Date
  graphVersion: string
}

export interface QueueJob {
  id: string
  job_type: 'auto_reply' | 'broadcast'
  recipient_psid: string
  attempts: number
  payload: any
}

function templateToPayload(t: { type: string; text: string | null; media_url: string | null; buttons: any }): MessagePayload {
  if (t.type === 'text') return { kind: 'text', text: t.text ?? '' }
  if (t.type === 'image') return { kind: 'image', url: t.media_url! }
  if (t.type === 'file') return { kind: 'file', url: t.media_url! }
  return { kind: 'buttons', text: t.text ?? '', buttons: t.buttons ?? [] }
}

export async function processJob(job: QueueJob, d: ProcessDeps): Promise<void> {
  const ctx = await d.loadContext(job)
  const attempt = job.attempts + 1

  if (job.job_type === 'auto_reply') {
    const tmpl = await d.loadTemplate(job.payload.templateId)
    // Private reply opens the conversation; send the template text as the reply body.
    const pr = await d.privateReply({ pageToken: ctx.pageToken, commentId: job.payload.commentId, message: tmpl.text ?? '', graphVersion: d.graphVersion })
    if (pr.ok) return d.markSent(job.id, 'private_reply', pr.recipientPsid)
    return attempt >= MAX_ATTEMPTS ? d.markFailed(job.id, pr.error) : d.markRetry(job.id, new Date(d.now.getTime() + nextBackoffMs(attempt)), pr.error)
  }

  // broadcast
  const decision = canSend({ lastInteractionAt: ctx.lastInteractionAt, tag: job.payload.tag ?? null, now: d.now })
  if (!decision.ok) return d.markFailed(job.id, `blocked: ${decision.reason}`)
  const tmpl = await d.loadTemplate(job.payload.templateId)
  const res = await d.send({
    pageToken: ctx.pageToken, recipientPsid: job.recipient_psid,
    messagingType: decision.messagingType, tag: decision.messagingType === 'MESSAGE_TAG' ? decision.tag : undefined,
    payload: templateToPayload(tmpl), graphVersion: d.graphVersion,
  })
  if (res.ok) return d.markSent(job.id, res.messageId)
  return attempt >= MAX_ATTEMPTS ? d.markFailed(job.id, res.error) : d.markRetry(job.id, new Date(d.now.getTime() + nextBackoffMs(attempt)), res.error)
}
