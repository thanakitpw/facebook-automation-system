import { sendMessage } from '@/lib/facebook/client'

it('posts a RESPONSE text message to the send API', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({ message_id: 'mid.123' }),
  })
  const res = await sendMessage({
    pageToken: 'tok', recipientPsid: 'psid-1',
    messagingType: 'RESPONSE',
    payload: { kind: 'text', text: 'hi' },
    graphVersion: 'v21.0', fetchImpl: fetchMock as unknown as typeof fetch,
  })
  expect(res).toEqual({ ok: true, messageId: 'mid.123' })
  const [url, init] = fetchMock.mock.calls[0]
  expect(url).toContain('/v21.0/me/messages')
  const body = JSON.parse((init as RequestInit).body as string)
  expect(body.messaging_type).toBe('RESPONSE')
  expect(body.recipient.id).toBe('psid-1')
  expect(body.message.text).toBe('hi')
})

it('includes tag when messagingType is MESSAGE_TAG', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ message_id: 'm' }) })
  await sendMessage({
    pageToken: 'tok', recipientPsid: 'p', messagingType: 'MESSAGE_TAG', tag: 'ACCOUNT_UPDATE',
    payload: { kind: 'text', text: 'x' }, graphVersion: 'v21.0', fetchImpl: fetchMock as unknown as typeof fetch,
  })
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.tag).toBe('ACCOUNT_UPDATE')
})

it('returns a structured error on FB failure', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: false, status: 400, json: async () => ({ error: { message: 'bad', code: 100 } }),
  })
  const res = await sendMessage({
    pageToken: 'tok', recipientPsid: 'p', messagingType: 'RESPONSE',
    payload: { kind: 'text', text: 'x' }, graphVersion: 'v21.0', fetchImpl: fetchMock as unknown as typeof fetch,
  })
  expect(res.ok).toBe(false)
  if (!res.ok) expect(res.error).toContain('bad')
})
