import { NextRequest } from 'next/server'
import { serviceClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/crypto'

const V = process.env.FB_GRAPH_VERSION!

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const ownerUserId = req.nextUrl.searchParams.get('state') // logged-in user id passed as state
  if (!code || !ownerUserId) return new Response('missing code/state', { status: 400 })

  const redirect = `${req.nextUrl.origin}/api/facebook/connect`
  const tokRes = await fetch(`https://graph.facebook.com/${V}/oauth/access_token?client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&redirect_uri=${encodeURIComponent(redirect)}&code=${code}`)
  const tok = await tokRes.json()
  if (!tok.access_token) return new Response('token exchange failed', { status: 400 })

  const pagesRes = await fetch(`https://graph.facebook.com/${V}/me/accounts?access_token=${tok.access_token}`)
  const pages = await pagesRes.json()
  const sb = serviceClient()
  for (const p of pages.data ?? []) {
    await sb.from('pages').upsert({
      owner_user_id: ownerUserId, fb_page_id: p.id, name: p.name, access_token_enc: encryptToken(p.access_token),
    }, { onConflict: 'fb_page_id' })
    // Subscribe the page to the app's webhook for messages + feed.
    await fetch(`https://graph.facebook.com/${V}/${p.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,feed&access_token=${p.access_token}`, { method: 'POST' })
  }
  return Response.redirect(`${req.nextUrl.origin}/posts`)
}
