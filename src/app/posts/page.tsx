import { serviceClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/supabase/auth-server'

export const dynamic = 'force-dynamic'

export default async function PostsPage() {
  const { user } = await requireUser()
  const sb = serviceClient()
  const { data: pages } = await sb.from('pages').select('id').eq('owner_user_id', user.id)
  const ids = (pages ?? []).map((p) => p.id)
  const { data: posts } = ids.length
    ? await sb.from('posts').select('id, fb_post_id, message, permalink').in('page_id', ids).order('created_at', { ascending: false })
    : { data: [] as { id: string; fb_post_id: string; message: string | null; permalink: string | null }[] }
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">Posts &amp; Keyword Rules</h1>
      <ul className="space-y-3">
        {(posts ?? []).map((p) => (
          <li key={p.id} className="rounded border p-3">
            <p className="font-medium">{p.message?.slice(0, 80) ?? '(no text)'}</p>
            <a className="text-sm text-blue-600" href={p.permalink ?? '#'}>open post</a>
          </li>
        ))}
      </ul>
    </main>
  )
}
