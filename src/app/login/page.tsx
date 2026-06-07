'use client'
import { useState } from 'react'
import { browserClient } from '@/lib/supabase/browser'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    await browserClient().auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/` } })
    setSent(true)
  }
  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      {sent ? <p>Check your email for the magic link.</p> : (
        <form onSubmit={submit} className="space-y-3">
          <input className="w-full rounded border p-2" type="email" placeholder="you@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button className="w-full rounded bg-black p-2 text-white" type="submit">Send magic link</button>
        </form>
      )}
    </main>
  )
}
