import { sendPrivateReply } from '@/lib/facebook/client'

it('posts to the comment private_replies edge', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'm1', recipient_id: 'psid-9' }) })
  const res = await sendPrivateReply({
    pageToken: 'tok', commentId: 'cmt_1', message: 'thanks!',
    graphVersion: 'v21.0', fetchImpl: fetchMock as unknown as typeof fetch,
  })
  expect(res).toEqual({ ok: true, recipientPsid: 'psid-9' })
  expect(fetchMock.mock.calls[0][0]).toContain('/v21.0/cmt_1/private_replies')
})
