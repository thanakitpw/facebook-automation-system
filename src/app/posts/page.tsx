import { serviceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function PostsPage() {
  const sb = serviceClient()
  const { data: posts } = await sb.from('posts').select('id, fb_post_id, message, permalink').order('created_at', { ascending: false })
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
