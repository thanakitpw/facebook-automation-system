import type { MessagePayload, SendArgs, SendResult } from './types'

function buildMessage(p: MessagePayload): Record<string, unknown> {
  switch (p.kind) {
    case 'text':
      return { text: p.text }
    case 'image':
    case 'file':
      return { attachment: { type: p.kind === 'image' ? 'image' : 'file', payload: { url: p.url, is_reusable: true } } }
    case 'buttons':
      return {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: p.text,
            buttons: p.buttons.map((b) =>
              b.url ? { type: 'web_url', title: b.title, url: b.url }
                    : { type: 'postback', title: b.title, payload: b.payload ?? b.title }),
          },
        },
      }
  }
}

export async function sendMessage(args: SendArgs): Promise<SendResult> {
  const f = args.fetchImpl ?? fetch
  const url = `https://graph.facebook.com/${args.graphVersion}/me/messages?access_token=${encodeURIComponent(args.pageToken)}`
  const body: Record<string, unknown> = {
    messaging_type: args.messagingType,
    recipient: { id: args.recipientPsid },
    message: buildMessage(args.payload),
  }
  if (args.messagingType === 'MESSAGE_TAG' && args.tag) body.tag = args.tag

  const resp = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await resp.json()
  if (!resp.ok) return { ok: false, error: data?.error?.message ?? `HTTP ${resp.status}` }
  return { ok: true, messageId: data.message_id }
}

export async function sendPrivateReply(args: {
  pageToken: string; commentId: string; message: string; graphVersion: string; fetchImpl?: typeof fetch
}): Promise<{ ok: true; recipientPsid: string } | { ok: false; error: string }> {
  const f = args.fetchImpl ?? fetch
  const url = `https://graph.facebook.com/${args.graphVersion}/${args.commentId}/private_replies?access_token=${encodeURIComponent(args.pageToken)}`
  const resp = await f(url, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: args.message }),
  })
  const data = await resp.json()
  if (!resp.ok) return { ok: false, error: data?.error?.message ?? `HTTP ${resp.status}` }
  return { ok: true, recipientPsid: data.recipient_id }
}
