export type MessagePayload =
  | { kind: 'text'; text: string }
  | { kind: 'image' | 'file'; url: string }
  | { kind: 'buttons'; text: string; buttons: Array<{ title: string; payload?: string; url?: string }> }

export interface SendArgs {
  pageToken: string
  recipientPsid: string
  messagingType: 'RESPONSE' | 'MESSAGE_TAG'
  tag?: string
  payload: MessagePayload
  graphVersion: string
  fetchImpl?: typeof fetch
}

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string }
