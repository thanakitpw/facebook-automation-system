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
  // Fire-and-forget so we return 200 fast; errors are logged, not surfaced to FB.
  handleEvents(events, makeHandlerDb()).catch((e) => console.error('handleEvents', e))
  return new Response('ok', { status: 200 })
}
