import { NextRequest } from 'next/server'
import { verifySignature } from '@/lib/facebook/signature'
import { parseWebhook } from '@/lib/facebook/parse'
import { handleEvents } from '@/lib/handlers'
import { makeHandlerDb } from '@/lib/handler-db'

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === process.env.FB_VERIFY_TOKEN) {
    return new Response(p.get('hub.challenge') ?? '', { status: 200 })
  }
  return new Response('forbidden', { status: 403 })
}

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (!verifySignature(raw, req.headers.get('x-hub-signature-256'), process.env.FB_APP_SECRET!)) {
    return new Response('bad signature', { status: 401 })
  }
  const events = parseWebhook(JSON.parse(raw))
  // Await the enqueue before responding. On serverless, work left running after
  // the response returns can be killed before it finishes — so a fire-and-forget
  // here silently drops events. Enqueuing is fast (a few DB inserts); the slow
  // send work happens later in the cron worker, so we still return well within
  // Facebook's webhook timeout. Errors are logged, not surfaced (idempotency keys
  // make any Facebook redelivery safe).
  try {
    await handleEvents(events, makeHandlerDb())
  } catch (e) {
    console.error('handleEvents', e)
  }
  return new Response('ok', { status: 200 })
}
