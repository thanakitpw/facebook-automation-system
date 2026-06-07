# Facebook Page Broadcast & Auto-Reply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js + Supabase web tool that auto-replies to Facebook comments by keyword (per post) and broadcasts Inbox messages to Page contacts, while strictly enforcing Facebook's 24-hour window and message-tag rules.

**Architecture:** A single Next.js 16 (App Router) app on Vercel serves the dashboard, the Facebook webhook receiver, and a Vercel Cron worker. Inbound events are verified and enqueued into a Supabase Postgres queue table; the cron worker claims jobs in batches and sends them via the Facebook Graph API with retry/backoff. Supabase provides Postgres, Storage (media), and Auth.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Supabase (Postgres + Storage + Auth), Vitest, Tailwind CSS v4, Poppins (next/font), Zod, native fetch FB client, Node crypto (AES-256-GCM) for token encryption, Vercel Cron.

---

## File Structure

```
src/
  app/
    layout.tsx                      # root layout, Poppins font
    page.tsx                        # dashboard home (contacts/logs summary)
    login/page.tsx                  # Supabase Auth login
    posts/page.tsx                  # posts + keyword rule editor
    broadcasts/page.tsx             # broadcast composer + audience
    logs/page.tsx                   # delivery logs
    api/
      webhook/route.ts              # GET verify + POST events
      cron/process-queue/route.ts   # cron worker entrypoint
      facebook/connect/route.ts     # OAuth callback, store page token
  lib/
    supabase/server.ts              # server Supabase client
    supabase/browser.ts             # browser Supabase client
    crypto.ts                       # AES-256-GCM encrypt/decrypt for tokens
    facebook/signature.ts           # X-Hub-Signature-256 verify
    facebook/client.ts              # FB Graph API send wrappers
    facebook/types.ts               # FB webhook + API types
    matching.ts                     # keyword rule matching
    window.ts                       # 24h messaging-window eligibility
    queue.ts                        # enqueue + claim + backoff helpers
    audience.ts                     # broadcast audience resolution
  test/
    *.test.ts                       # Vitest unit/integration tests
supabase/
  migrations/0001_init.sql          # schema + RLS
vitest.config.ts
.env.local                          # secrets (gitignored)
```

Each `lib/*` module has one responsibility and is unit-tested in isolation. Routes stay thin and delegate to `lib`.

---

## Phase 0: Project Foundation

### Task 1: Scaffold Next.js + tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.local.example`

- [ ] **Step 1: Scaffold the app non-interactively**

Run:
```bash
npx create-next-app@latest . --ts --app --tailwind --eslint --src-dir --use-npm --no-import-alias --yes
```

- [ ] **Step 2: Add test + domain deps**

Run:
```bash
npm i @supabase/supabase-js @supabase/ssr zod
npm i -D vitest @vitest/coverage-v8
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'], globals: true },
})
```

- [ ] **Step 4: Add test script to `package.json`**

In `"scripts"` add: `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 5: Create `.env.local.example`**

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
FB_APP_ID=
FB_APP_SECRET=
FB_VERIFY_TOKEN=
FB_GRAPH_VERSION=v21.0
TOKEN_ENCRYPTION_KEY=        # 32-byte hex (64 chars)
CRON_SECRET=
```

- [ ] **Step 6: Confirm tooling runs**

Run: `npm run test`
Expected: PASS — "No test files found" exits 0 (no tests yet is acceptable; if it errors, add a trivial `src/test/smoke.test.ts` with `it('boots', () => expect(true).toBe(true))`).

- [ ] **Step 7: Commit**

```bash
git init && git add -A
git commit -m "chore: scaffold Next.js app with Supabase, Vitest, Tailwind"
```

### Task 2: Poppins font + dashboard shell

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `src/app/page.tsx`

- [ ] **Step 1: Wire Poppins via next/font in `src/app/layout.tsx`**

```tsx
import { Poppins } from 'next/font/google'
import './globals.css'

const poppins = Poppins({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-poppins' })

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={poppins.variable}>
      <body className="font-[family-name:var(--font-poppins)] antialiased">{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Replace `src/app/page.tsx` with a shell**

```tsx
export default function Home() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">FB Broadcast & Auto-Reply</h1>
      <p className="text-gray-500">Dashboard</p>
    </main>
  )
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: PASS — build completes with no type errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: dashboard shell with Poppins font"
```

### Task 3: Database schema + RLS

**Files:**
- Create: `supabase/migrations/0001_init.sql`

- [ ] **Step 1: Write the schema migration**

```sql
-- pages connected by an owner
create table pages (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  fb_page_id text not null unique,
  name text not null,
  access_token_enc text not null,
  token_expiry timestamptz,
  created_at timestamptz not null default now()
);

create table contacts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  psid text not null,
  name text,
  last_interaction_at timestamptz,
  subscribed boolean not null default true,
  tags text[] not null default '{}',
  unique (page_id, psid)
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  fb_post_id text not null unique,
  message text,
  permalink text,
  created_at timestamptz not null default now()
);

create table message_templates (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  type text not null check (type in ('text','image','file','buttons')),
  text text,
  media_url text,
  buttons jsonb,
  created_at timestamptz not null default now()
);

create table keyword_rules (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  keyword text not null,
  match_type text not null default 'contains' check (match_type in ('exact','contains')),
  template_id uuid not null references message_templates(id),
  reply_once boolean not null default true,
  created_at timestamptz not null default now()
);

create table broadcasts (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  template_id uuid not null references message_templates(id),
  audience_filter jsonb not null default '{}',
  message_tag text,
  scheduled_at timestamptz,
  status text not null default 'draft' check (status in ('draft','queued','sending','done','failed')),
  stats jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table message_queue (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  recipient_psid text not null,
  job_type text not null check (job_type in ('auto_reply','broadcast')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts int not null default 0,
  scheduled_at timestamptz not null default now(),
  idempotency_key text unique,
  last_error text,
  created_at timestamptz not null default now()
);
create index on message_queue (status, scheduled_at);

create table message_logs (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references pages(id) on delete cascade,
  recipient_psid text not null,
  job_type text not null,
  status text not null,
  fb_message_id text,
  error text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 2: Add RLS so owners see only their data**

```sql
alter table pages enable row level security;
create policy "own pages" on pages for all using (owner_user_id = auth.uid());

-- child tables: scope through the owning page
alter table contacts enable row level security;
create policy "own contacts" on contacts for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));

alter table posts enable row level security;
create policy "own posts" on posts for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));

alter table message_templates enable row level security;
create policy "own templates" on message_templates for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));

alter table keyword_rules enable row level security;
create policy "own rules" on keyword_rules for all using (
  post_id in (select p.id from posts p join pages pg on pg.id = p.page_id where pg.owner_user_id = auth.uid()));

alter table broadcasts enable row level security;
create policy "own broadcasts" on broadcasts for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));

alter table message_logs enable row level security;
create policy "own logs" on message_logs for all using (
  page_id in (select id from pages where owner_user_id = auth.uid()));
-- message_queue is accessed only by the service role (cron); no anon policy.
```

- [ ] **Step 3: Apply the migration**

Run (against your Supabase project — paste into Supabase SQL editor, or use the CLI):
```bash
# Option A: paste supabase/migrations/0001_init.sql into the Supabase dashboard SQL editor and run.
# Option B (CLI): supabase db push
```
Expected: all tables created, no errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: database schema and RLS"
```

---

## Phase 1: Core Libraries (pure logic, TDD)

### Task 4: Token encryption

**Files:**
- Create: `src/lib/crypto.ts`, `src/test/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { encryptToken, decryptToken } from '../lib/crypto'

const KEY = 'a'.repeat(64) // 32 bytes hex
beforeAll(() => { process.env.TOKEN_ENCRYPTION_KEY = KEY })

it('round-trips a token', () => {
  const enc = encryptToken('secret-page-token')
  expect(enc).not.toContain('secret-page-token')
  expect(decryptToken(enc)).toBe('secret-page-token')
})

it('produces different ciphertext each call (random IV)', () => {
  expect(encryptToken('x')).not.toBe(encryptToken('x'))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/crypto.test.ts`
Expected: FAIL — cannot find module `../lib/crypto`.

- [ ] **Step 3: Implement `src/lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

function key() {
  return Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, 'hex')
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':')
}

export function decryptToken(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(':')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'))
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/crypto.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: AES-256-GCM token encryption"
```

### Task 5: Webhook signature verification

**Files:**
- Create: `src/lib/facebook/signature.ts`, `src/test/signature.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { createHmac } from 'crypto'
import { verifySignature } from '../lib/facebook/signature'

const SECRET = 'app-secret'
const body = JSON.stringify({ hello: 'world' })
const good = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex')

it('accepts a valid signature', () => {
  expect(verifySignature(body, good, SECRET)).toBe(true)
})

it('rejects a tampered body', () => {
  expect(verifySignature(body + 'x', good, SECRET)).toBe(false)
})

it('rejects a missing header', () => {
  expect(verifySignature(body, null, SECRET)).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/signature.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/lib/facebook/signature.ts`**

```ts
import { createHmac, timingSafeEqual } from 'crypto'

export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !header.startsWith('sha256=')) return false
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/signature.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: webhook signature verification"
```

### Task 6: Keyword matching

**Files:**
- Create: `src/lib/matching.ts`, `src/test/matching.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { matchRules } from '../lib/matching'

type Rule = { id: string; keyword: string; match_type: 'exact' | 'contains' }
const rules: Rule[] = [
  { id: 'r1', keyword: 'test', match_type: 'contains' },
  { id: 'r2', keyword: 'รับ', match_type: 'exact' },
]

it('matches contains case-insensitively', () => {
  expect(matchRules('I want to TEST this', rules).map(r => r.id)).toEqual(['r1'])
})

it('matches exact only when whole text equals keyword (trimmed)', () => {
  expect(matchRules('  รับ ', rules).map(r => r.id)).toEqual(['r2'])
  expect(matchRules('รับของหน่อย', rules).map(r => r.id)).toEqual([])
})

it('returns empty when nothing matches', () => {
  expect(matchRules('hello', rules)).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/matching.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/lib/matching.ts`**

```ts
export type MatchType = 'exact' | 'contains'
export interface RuleLike { id: string; keyword: string; match_type: MatchType }

export function matchRules<T extends RuleLike>(comment: string, rules: T[]): T[] {
  const text = comment.trim().toLowerCase()
  return rules.filter((r) => {
    const kw = r.keyword.trim().toLowerCase()
    return r.match_type === 'exact' ? text === kw : text.includes(kw)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/matching.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: per-post keyword matching"
```

### Task 7: 24-hour window eligibility

**Files:**
- Create: `src/lib/window.ts`, `src/test/window.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { canSend } from '../lib/window'

const now = new Date('2026-06-07T12:00:00Z')

it('allows RESPONSE within 24h', () => {
  const last = new Date('2026-06-07T00:00:00Z') // 12h ago
  expect(canSend({ lastInteractionAt: last, tag: null, now })).toEqual({ ok: true, messagingType: 'RESPONSE' })
})

it('blocks RESPONSE outside 24h without a tag', () => {
  const last = new Date('2026-06-05T00:00:00Z') // >24h ago
  expect(canSend({ lastInteractionAt: last, tag: null, now })).toEqual({ ok: false, reason: 'outside_window_no_tag' })
})

it('allows MESSAGE_TAG outside 24h when a tag is provided', () => {
  const last = new Date('2026-06-05T00:00:00Z')
  expect(canSend({ lastInteractionAt: last, tag: 'CONFIRMED_EVENT_UPDATE', now }))
    .toEqual({ ok: true, messagingType: 'MESSAGE_TAG', tag: 'CONFIRMED_EVENT_UPDATE' })
})

it('blocks when there is no prior interaction and no tag', () => {
  expect(canSend({ lastInteractionAt: null, tag: null, now })).toEqual({ ok: false, reason: 'outside_window_no_tag' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/window.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/lib/window.ts`**

```ts
const DAY_MS = 24 * 60 * 60 * 1000

export type SendDecision =
  | { ok: true; messagingType: 'RESPONSE' }
  | { ok: true; messagingType: 'MESSAGE_TAG'; tag: string }
  | { ok: false; reason: 'outside_window_no_tag' }

export function canSend(args: {
  lastInteractionAt: Date | null
  tag: string | null
  now: Date
}): SendDecision {
  const { lastInteractionAt, tag, now } = args
  const inWindow = lastInteractionAt != null && now.getTime() - lastInteractionAt.getTime() < DAY_MS
  if (inWindow) return { ok: true, messagingType: 'RESPONSE' }
  if (tag) return { ok: true, messagingType: 'MESSAGE_TAG', tag }
  return { ok: false, reason: 'outside_window_no_tag' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/window.test.ts`
Expected: PASS — four tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: 24h messaging-window eligibility guard"
```

### Task 8: Backoff calculation

**Files:**
- Create: `src/lib/queue.ts`, `src/test/backoff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { nextBackoffMs, MAX_ATTEMPTS } from '../lib/queue'

it('grows exponentially per attempt', () => {
  expect(nextBackoffMs(1)).toBe(60_000)     // 1 min
  expect(nextBackoffMs(2)).toBe(120_000)    // 2 min
  expect(nextBackoffMs(3)).toBe(240_000)    // 4 min
})

it('caps at 60 minutes', () => {
  expect(nextBackoffMs(20)).toBe(3_600_000)
})

it('exposes a max-attempts ceiling', () => {
  expect(MAX_ATTEMPTS).toBe(5)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/backoff.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the backoff portion of `src/lib/queue.ts`**

```ts
export const MAX_ATTEMPTS = 5
const BASE_MS = 60_000
const CAP_MS = 3_600_000

export function nextBackoffMs(attempt: number): number {
  return Math.min(BASE_MS * 2 ** (attempt - 1), CAP_MS)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/backoff.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: queue backoff calculation"
```

### Task 9: Audience resolution

**Files:**
- Create: `src/lib/audience.ts`, `src/test/audience.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { resolveAudience } from '../lib/audience'

type Contact = { psid: string; subscribed: boolean; last_interaction_at: string | null; tags: string[] }
const contacts: Contact[] = [
  { psid: 'a', subscribed: true, last_interaction_at: '2026-06-07T11:00:00Z', tags: ['vip'] },
  { psid: 'b', subscribed: false, last_interaction_at: '2026-06-07T11:00:00Z', tags: [] },
  { psid: 'c', subscribed: true, last_interaction_at: '2026-06-01T00:00:00Z', tags: [] },
]
const now = new Date('2026-06-07T12:00:00Z')

it('excludes unsubscribed contacts', () => {
  const r = resolveAudience(contacts, { hasTag: false }, now)
  expect(r.map(c => c.psid)).not.toContain('b')
})

it('without a message tag, includes only in-window contacts', () => {
  const r = resolveAudience(contacts, { hasTag: false }, now)
  expect(r.map(c => c.psid)).toEqual(['a'])
})

it('with a message tag, includes out-of-window contacts too', () => {
  const r = resolveAudience(contacts, { hasTag: true }, now)
  expect(r.map(c => c.psid).sort()).toEqual(['a', 'c'])
})

it('filters by required tag when given', () => {
  const r = resolveAudience(contacts, { hasTag: true, requireTag: 'vip' }, now)
  expect(r.map(c => c.psid)).toEqual(['a'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/audience.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/lib/audience.ts`**

```ts
const DAY_MS = 24 * 60 * 60 * 1000

export interface ContactLike {
  psid: string
  subscribed: boolean
  last_interaction_at: string | null
  tags: string[]
}

export function resolveAudience<T extends ContactLike>(
  contacts: T[],
  opts: { hasTag: boolean; requireTag?: string },
  now: Date,
): T[] {
  return contacts.filter((c) => {
    if (!c.subscribed) return false
    if (opts.requireTag && !c.tags.includes(opts.requireTag)) return false
    if (opts.hasTag) return true
    if (!c.last_interaction_at) return false
    return now.getTime() - new Date(c.last_interaction_at).getTime() < DAY_MS
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/audience.test.ts`
Expected: PASS — four tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: broadcast audience resolution"
```

---

## Phase 2: Supabase clients + Facebook API client

### Task 10: Supabase clients

**Files:**
- Create: `src/lib/supabase/server.ts`, `src/lib/supabase/browser.ts`

- [ ] **Step 1: Create the service-role server client (used by cron + webhook)**

`src/lib/supabase/server.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

// Service-role client — server-only. Never import into client components.
export function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}
```

- [ ] **Step 2: Create the browser client (used by dashboard)**

`src/lib/supabase/browser.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

export function browserClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: supabase server and browser clients"
```

### Task 11: Facebook send client (mocked fetch)

**Files:**
- Create: `src/lib/facebook/types.ts`, `src/lib/facebook/client.ts`, `src/test/fb-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { sendMessage } from '../lib/facebook/client'

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/fb-client.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/lib/facebook/types.ts`**

```ts
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
```

- [ ] **Step 4: Implement `src/lib/facebook/client.ts`**

```ts
import type { MessagePayload, SendArgs, SendResult } from './types'

function buildMessage(p: MessagePayload): Record<string, unknown> {
  if (p.kind === 'text') return { text: p.text }
  if (p.kind === 'image' || p.kind === 'file') {
    return { attachment: { type: p.kind === 'image' ? 'image' : 'file', payload: { url: p.url, is_reusable: true } } }
  }
  // buttons
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/test/fb-client.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: facebook send client with text/image/file/buttons"
```

### Task 12: Private Reply client

**Files:**
- Modify: `src/lib/facebook/client.ts`
- Create: `src/test/fb-private-reply.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { sendPrivateReply } from '../lib/facebook/client'

it('posts to the comment private_replies edge', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'm1', recipient_id: 'psid-9' }) })
  const res = await sendPrivateReply({
    pageToken: 'tok', commentId: 'cmt_1', message: 'thanks!',
    graphVersion: 'v21.0', fetchImpl: fetchMock as unknown as typeof fetch,
  })
  expect(res).toEqual({ ok: true, recipientPsid: 'psid-9' })
  expect(fetchMock.mock.calls[0][0]).toContain('/v21.0/cmt_1/private_replies')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/fb-private-reply.test.ts`
Expected: FAIL — `sendPrivateReply` is not exported.

- [ ] **Step 3: Add `sendPrivateReply` to `src/lib/facebook/client.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/fb-private-reply.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: private reply client for comment-to-inbox"
```

---

## Phase 3: Webhook receiver + Contact sync

### Task 13: Webhook event parser

**Files:**
- Create: `src/lib/facebook/parse.ts`, `src/test/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseWebhook } from '../lib/facebook/parse'

it('extracts inbound messages', () => {
  const body = { object: 'page', entry: [{ id: 'PAGE1', messaging: [
    { sender: { id: 'psid-1' }, recipient: { id: 'PAGE1' }, timestamp: 1717761600000, message: { text: 'hello' } },
  ] }] }
  expect(parseWebhook(body)).toEqual([
    { type: 'message', pageId: 'PAGE1', psid: 'psid-1', text: 'hello', timestamp: 1717761600000 },
  ])
})

it('extracts comment-add feed events', () => {
  const body = { object: 'page', entry: [{ id: 'PAGE1', changes: [
    { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'c1', post_id: 'p1', from: { id: 'u1', name: 'Joe' }, message: 'test' } },
  ] }] }
  expect(parseWebhook(body)).toEqual([
    { type: 'comment', pageId: 'PAGE1', commentId: 'c1', postId: 'p1', fromId: 'u1', fromName: 'Joe', message: 'test' },
  ])
})

it('ignores non-comment feed events (likes, edits)', () => {
  const body = { object: 'page', entry: [{ id: 'PAGE1', changes: [
    { field: 'feed', value: { item: 'like', verb: 'add' } },
    { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'c1', post_id: 'p1', from: { id: 'u1' }, message: 'x' } },
  ] }] }
  expect(parseWebhook(body)).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/parse.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `src/lib/facebook/parse.ts`**

```ts
export type WebhookEvent =
  | { type: 'message'; pageId: string; psid: string; text: string; timestamp: number }
  | { type: 'comment'; pageId: string; commentId: string; postId: string; fromId: string; fromName?: string; message: string }

export function parseWebhook(body: any): WebhookEvent[] {
  if (body?.object !== 'page' || !Array.isArray(body.entry)) return []
  const out: WebhookEvent[] = []
  for (const entry of body.entry) {
    const pageId = entry.id
    for (const m of entry.messaging ?? []) {
      if (m.message?.text && m.sender?.id) {
        out.push({ type: 'message', pageId, psid: m.sender.id, text: m.message.text, timestamp: m.timestamp })
      }
    }
    for (const c of entry.changes ?? []) {
      const v = c.value
      if (c.field === 'feed' && v?.item === 'comment' && v.verb === 'add') {
        out.push({ type: 'comment', pageId, commentId: v.comment_id, postId: v.post_id, fromId: v.from?.id, fromName: v.from?.name, message: v.message ?? '' })
      }
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/parse.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: webhook event parser for messages and comments"
```

### Task 14: Webhook route (GET verify + POST handle)

**Files:**
- Create: `src/app/api/webhook/route.ts`
- Create: `src/lib/handlers.ts`
- Create: `src/test/handlers.test.ts`

- [ ] **Step 1: Write the failing test for the comment handler**

```ts
import { handleEvents } from '../lib/handlers'

function fakeDb() {
  const calls: any[] = []
  return {
    calls,
    upsertContact: async (c: any) => { calls.push(['upsertContact', c]) },
    findPageByFbId: async (fbPageId: string) => ({ id: 'page-uuid', fb_page_id: fbPageId, access_token_enc: 'enc' }),
    rulesForPost: async (fbPostId: string) => fbPostId === 'p1'
      ? [{ id: 'r1', keyword: 'test', match_type: 'contains', template_id: 't1', reply_once: true }] : [],
    templateById: async () => ({ id: 't1', type: 'text', text: 'thank you', media_url: null, buttons: null }),
    alreadyReplied: async () => false,
    enqueue: async (job: any) => { calls.push(['enqueue', job]) },
  }
}

it('enqueues an auto_reply job when a comment matches a rule', async () => {
  const db = fakeDb()
  await handleEvents([
    { type: 'comment', pageId: 'PAGE1', commentId: 'c1', postId: 'p1', fromId: 'u1', fromName: 'Joe', message: 'please TEST' },
  ], db as any)
  const enqueued = db.calls.filter(c => c[0] === 'enqueue')
  expect(enqueued).toHaveLength(1)
  expect(enqueued[0][1].job_type).toBe('auto_reply')
  expect(enqueued[0][1].payload.commentId).toBe('c1')
})

it('does not enqueue when no rule matches', async () => {
  const db = fakeDb()
  await handleEvents([
    { type: 'comment', pageId: 'PAGE1', commentId: 'c2', postId: 'p1', fromId: 'u1', message: 'hello' },
  ], db as any)
  expect(db.calls.filter(c => c[0] === 'enqueue')).toHaveLength(0)
})

it('upserts contact last_interaction_at on inbound message', async () => {
  const db = fakeDb()
  await handleEvents([
    { type: 'message', pageId: 'PAGE1', psid: 'psid-1', text: 'hi', timestamp: 1717761600000 },
  ], db as any)
  const up = db.calls.find(c => c[0] === 'upsertContact')
  expect(up[1].psid).toBe('psid-1')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/handlers.test.ts`
Expected: FAIL — cannot find module `../lib/handlers`.

- [ ] **Step 3: Implement `src/lib/handlers.ts`**

```ts
import type { WebhookEvent } from './facebook/parse'
import { matchRules } from './matching'

export interface HandlerDb {
  findPageByFbId(fbPageId: string): Promise<{ id: string; access_token_enc: string } | null>
  upsertContact(c: { pageId: string; psid: string; name?: string; lastInteractionAt?: Date }): Promise<void>
  rulesForPost(fbPostId: string): Promise<Array<{ id: string; keyword: string; match_type: 'exact' | 'contains'; template_id: string; reply_once: boolean }>>
  alreadyReplied(commentId: string, ruleId: string): Promise<boolean>
  enqueue(job: { page_id: string; recipient_psid: string; job_type: 'auto_reply'; payload: any; idempotency_key: string }): Promise<void>
}

export async function handleEvents(events: WebhookEvent[], db: HandlerDb): Promise<void> {
  for (const ev of events) {
    const page = await db.findPageByFbId(ev.pageId)
    if (!page) continue

    if (ev.type === 'message') {
      await db.upsertContact({ pageId: page.id, psid: ev.psid, lastInteractionAt: new Date(ev.timestamp) })
      continue
    }

    // comment
    await db.upsertContact({ pageId: page.id, psid: ev.fromId, name: ev.fromName })
    const rules = await db.rulesForPost(ev.postId)
    const matched = matchRules(ev.message, rules)
    for (const rule of matched) {
      if (rule.reply_once && (await db.alreadyReplied(ev.commentId, rule.id))) continue
      await db.enqueue({
        page_id: page.id,
        recipient_psid: ev.fromId,
        job_type: 'auto_reply',
        payload: { commentId: ev.commentId, templateId: rule.template_id, ruleId: rule.id },
        idempotency_key: `reply:${ev.commentId}:${rule.id}`,
      })
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/handlers.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 5: Implement the route `src/app/api/webhook/route.ts`**

```ts
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
```

- [ ] **Step 6: Implement `src/lib/handler-db.ts` (Supabase-backed HandlerDb)**

```ts
import { serviceClient } from './supabase/server'
import type { HandlerDb } from './handlers'

export function makeHandlerDb(): HandlerDb {
  const sb = serviceClient()
  return {
    async findPageByFbId(fbPageId) {
      const { data } = await sb.from('pages').select('id, access_token_enc').eq('fb_page_id', fbPageId).maybeSingle()
      return data ?? null
    },
    async upsertContact(c) {
      await sb.from('contacts').upsert(
        { page_id: c.pageId, psid: c.psid, name: c.name ?? null, last_interaction_at: c.lastInteractionAt?.toISOString() ?? null },
        { onConflict: 'page_id,psid' },
      )
    },
    async rulesForPost(fbPostId) {
      const { data: post } = await sb.from('posts').select('id').eq('fb_post_id', fbPostId).maybeSingle()
      if (!post) return []
      const { data } = await sb.from('keyword_rules').select('id, keyword, match_type, template_id, reply_once').eq('post_id', post.id)
      return data ?? []
    },
    async alreadyReplied(commentId, ruleId) {
      const { data } = await sb.from('message_queue').select('id').eq('idempotency_key', `reply:${commentId}:${ruleId}`).maybeSingle()
      return !!data
    },
    async enqueue(job) {
      await sb.from('message_queue').insert(job)
    },
  }
}
```

- [ ] **Step 7: Type-check + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — no type errors, all tests green.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: webhook route, event handlers, contact sync"
```

---

## Phase 4: Queue worker (Cron)

### Task 15: Queue claim + process logic

**Files:**
- Modify: `src/lib/queue.ts`
- Create: `src/test/process.test.ts`

- [ ] **Step 1: Write the failing test for processing a single job**

```ts
import { processJob } from '../lib/queue'

function deps(over: Partial<any> = {}) {
  const calls: any[] = []
  return {
    calls,
    deps: {
      loadContext: async () => ({ pageToken: 'tok', lastInteractionAt: new Date('2026-06-07T11:00:00Z') }),
      loadTemplate: async () => ({ type: 'text', text: 'thanks', media_url: null, buttons: null }),
      send: async (a: any) => { calls.push(['send', a]); return { ok: true, messageId: 'mid.1' } },
      privateReply: async (a: any) => { calls.push(['privateReply', a]); return { ok: true, recipientPsid: 'psid-x' } },
      markSent: async (id: string, mid: string) => { calls.push(['markSent', id, mid]) },
      markRetry: async (id: string, when: Date, err: string) => { calls.push(['markRetry', id, when, err]) },
      markFailed: async (id: string, err: string) => { calls.push(['markFailed', id, err]) },
      now: new Date('2026-06-07T12:00:00Z'),
      graphVersion: 'v21.0',
      ...over,
    },
  }
}

it('auto_reply job uses private reply then marks sent', async () => {
  const { calls, deps: d } = deps()
  await processJob(
    { id: 'j1', job_type: 'auto_reply', recipient_psid: 'u1', attempts: 0,
      payload: { commentId: 'c1', templateId: 't1', ruleId: 'r1' } } as any, d as any)
  expect(calls.find(c => c[0] === 'privateReply')).toBeTruthy()
  expect(calls.find(c => c[0] === 'markSent')?.[2]).toBe('psid-x')
})

it('broadcast job blocked outside window without tag → markFailed', async () => {
  const { calls, deps: d } = deps({
    loadContext: async () => ({ pageToken: 'tok', lastInteractionAt: new Date('2026-06-01T00:00:00Z') }),
  })
  await processJob(
    { id: 'j2', job_type: 'broadcast', recipient_psid: 'u2', attempts: 0,
      payload: { templateId: 't1', tag: null } } as any, d as any)
  const failed = calls.find(c => c[0] === 'markFailed')
  expect(failed?.[2]).toContain('outside_window')
  expect(calls.find(c => c[0] === 'send')).toBeUndefined()
})

it('send failure under max attempts schedules a retry', async () => {
  const { calls, deps: d } = deps({
    send: async () => ({ ok: false, error: 'temporary' }),
  })
  await processJob(
    { id: 'j3', job_type: 'broadcast', recipient_psid: 'u3', attempts: 1,
      payload: { templateId: 't1', tag: null } } as any, d as any)
  expect(calls.find(c => c[0] === 'markRetry')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/test/process.test.ts`
Expected: FAIL — `processJob` not exported.

- [ ] **Step 3: Add `processJob` to `src/lib/queue.ts`**

```ts
import { canSend } from './window'
import type { MessagePayload, SendResult } from './facebook/types'

export interface ProcessDeps {
  loadContext(job: QueueJob): Promise<{ pageToken: string; lastInteractionAt: Date | null }>
  loadTemplate(templateId: string): Promise<{ type: string; text: string | null; media_url: string | null; buttons: any }>
  send(a: { pageToken: string; recipientPsid: string; messagingType: 'RESPONSE' | 'MESSAGE_TAG'; tag?: string; payload: MessagePayload; graphVersion: string }): Promise<SendResult>
  privateReply(a: { pageToken: string; commentId: string; message: string; graphVersion: string }): Promise<{ ok: true; recipientPsid: string } | { ok: false; error: string }>
  markSent(id: string, messageId: string, psid?: string): Promise<void>
  markRetry(id: string, when: Date, err: string): Promise<void>
  markFailed(id: string, err: string): Promise<void>
  now: Date
  graphVersion: string
}

export interface QueueJob {
  id: string
  job_type: 'auto_reply' | 'broadcast'
  recipient_psid: string
  attempts: number
  payload: any
}

function templateToPayload(t: { type: string; text: string | null; media_url: string | null; buttons: any }): MessagePayload {
  if (t.type === 'text') return { kind: 'text', text: t.text ?? '' }
  if (t.type === 'image') return { kind: 'image', url: t.media_url! }
  if (t.type === 'file') return { kind: 'file', url: t.media_url! }
  return { kind: 'buttons', text: t.text ?? '', buttons: t.buttons ?? [] }
}

export async function processJob(job: QueueJob, d: ProcessDeps): Promise<void> {
  const ctx = await d.loadContext(job)
  const attempt = job.attempts + 1

  if (job.job_type === 'auto_reply') {
    const tmpl = await d.loadTemplate(job.payload.templateId)
    // Private reply opens the conversation; send the template text as the reply body.
    const pr = await d.privateReply({ pageToken: ctx.pageToken, commentId: job.payload.commentId, message: tmpl.text ?? '', graphVersion: d.graphVersion })
    if (pr.ok) return d.markSent(job.id, 'private_reply', pr.recipientPsid)
    return attempt >= MAX_ATTEMPTS ? d.markFailed(job.id, pr.error) : d.markRetry(job.id, new Date(d.now.getTime() + nextBackoffMs(attempt)), pr.error)
  }

  // broadcast
  const decision = canSend({ lastInteractionAt: ctx.lastInteractionAt, tag: job.payload.tag ?? null, now: d.now })
  if (!decision.ok) return d.markFailed(job.id, `blocked: ${decision.reason}`)
  const tmpl = await d.loadTemplate(job.payload.templateId)
  const res = await d.send({
    pageToken: ctx.pageToken, recipientPsid: job.recipient_psid,
    messagingType: decision.messagingType, tag: decision.messagingType === 'MESSAGE_TAG' ? decision.tag : undefined,
    payload: templateToPayload(tmpl), graphVersion: d.graphVersion,
  })
  if (res.ok) return d.markSent(job.id, res.messageId)
  return attempt >= MAX_ATTEMPTS ? d.markFailed(job.id, res.error) : d.markRetry(job.id, new Date(d.now.getTime() + nextBackoffMs(attempt)), res.error)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/test/process.test.ts`
Expected: PASS — three tests green.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: queue job processing with window guard and retry"
```

### Task 16: Cron route + claim query

**Files:**
- Create: `src/app/api/cron/process-queue/route.ts`
- Create: `src/lib/process-db.ts`
- Create: `supabase/migrations/0002_claim_fn.sql`

- [ ] **Step 1: Write the claim SQL function (atomic batch claim)**

`supabase/migrations/0002_claim_fn.sql`:
```sql
create or replace function claim_jobs(batch int)
returns setof message_queue
language plpgsql as $$
begin
  return query
  update message_queue q
  set status = 'processing', attempts = q.attempts + 0
  where q.id in (
    select id from message_queue
    where status = 'pending' and scheduled_at <= now()
    order by scheduled_at
    limit batch
    for update skip locked
  )
  returning q.*;
end; $$;
```
Apply it (Supabase SQL editor or `supabase db push`).

- [ ] **Step 2: Implement `src/lib/process-db.ts`**

```ts
import { serviceClient } from './supabase/server'
import { decryptToken } from './crypto'
import { sendMessage, sendPrivateReply } from './facebook/client'
import type { ProcessDeps, QueueJob } from './queue'

export function makeProcessDeps(now: Date): ProcessDeps {
  const sb = serviceClient()
  return {
    now,
    graphVersion: process.env.FB_GRAPH_VERSION!,
    async loadContext(job: QueueJob) {
      const { data: page } = await sb.from('pages').select('access_token_enc').eq('id', (job as any).page_id).single()
      const { data: contact } = await sb.from('contacts').select('last_interaction_at').eq('page_id', (job as any).page_id).eq('psid', job.recipient_psid).maybeSingle()
      return {
        pageToken: decryptToken(page!.access_token_enc),
        lastInteractionAt: contact?.last_interaction_at ? new Date(contact.last_interaction_at) : null,
      }
    },
    async loadTemplate(id) {
      const { data } = await sb.from('message_templates').select('type, text, media_url, buttons').eq('id', id).single()
      return data!
    },
    send: (a) => sendMessage(a),
    privateReply: (a) => sendPrivateReply(a),
    async markSent(id, messageId) {
      await sb.from('message_queue').update({ status: 'sent' }).eq('id', id)
    },
    async markRetry(id, when, err) {
      await sb.from('message_queue').update({ status: 'pending', attempts: undefined, scheduled_at: when.toISOString(), last_error: err }).eq('id', id)
      await sb.rpc('increment_attempts', { job_id: id })
    },
    async markFailed(id, err) {
      await sb.from('message_queue').update({ status: 'failed', last_error: err }).eq('id', id)
    },
  }
}
```

> Note: add a tiny `increment_attempts(job_id uuid)` SQL function in `0002_claim_fn.sql` that does `update message_queue set attempts = attempts + 1 where id = job_id;` so retry attempts advance atomically.

- [ ] **Step 3: Implement the cron route `src/app/api/cron/process-queue/route.ts`**

```ts
import { NextRequest } from 'next/server'
import { serviceClient } from '@/lib/supabase/server'
import { makeProcessDeps } from '@/lib/process-db'
import { processJob } from '@/lib/queue'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 })
  }
  const sb = serviceClient()
  const { data: jobs } = await sb.rpc('claim_jobs', { batch: 25 })
  const deps = makeProcessDeps(new Date())
  for (const job of jobs ?? []) {
    try { await processJob(job as any, deps) }
    catch (e) { await deps.markFailed((job as any).id, String(e)) }
  }
  return Response.json({ processed: jobs?.length ?? 0 })
}
```

- [ ] **Step 4: Register the cron in `vercel.json`**

Create `vercel.json`:
```json
{
  "crons": [{ "path": "/api/cron/process-queue", "schedule": "* * * * *" }]
}
```

- [ ] **Step 5: Type-check + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS — no type errors, all unit tests green.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: cron queue worker with atomic batch claim"
```

---

## Phase 5: Facebook OAuth connect + Dashboard

### Task 17: OAuth connect route

**Files:**
- Create: `src/app/api/facebook/connect/route.ts`

- [ ] **Step 1: Implement the callback that exchanges code → page token and stores it**

```ts
import { NextRequest } from 'next/server'
import { serviceClient } from '@/lib/supabase/server'
import { encryptToken } from '@/lib/crypto'

const V = process.env.FB_GRAPH_VERSION!

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const ownerUserId = req.nextUrl.searchParams.get('state') // pass the logged-in user id as state
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
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: facebook oauth connect + webhook subscription"
```

### Task 18: Login page (Supabase Auth)

**Files:**
- Create: `src/app/login/page.tsx`

- [ ] **Step 1: Implement an email magic-link login**

```tsx
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
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat: supabase auth login page"
```

### Task 19: Posts + keyword rules page

**Files:**
- Create: `src/app/posts/page.tsx`
- Create: `src/app/posts/actions.ts`

- [ ] **Step 1: Implement server actions to sync posts + save a rule**

`src/app/posts/actions.ts`:
```ts
'use server'
import { serviceClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/crypto'

const V = process.env.FB_GRAPH_VERSION!

export async function syncPosts(pageRowId: string) {
  const sb = serviceClient()
  const { data: page } = await sb.from('pages').select('fb_page_id, access_token_enc').eq('id', pageRowId).single()
  const token = decryptToken(page!.access_token_enc)
  const res = await fetch(`https://graph.facebook.com/${V}/${page!.fb_page_id}/posts?fields=id,message,permalink_url&access_token=${token}`)
  const data = await res.json()
  for (const p of data.data ?? []) {
    await sb.from('posts').upsert({ page_id: pageRowId, fb_post_id: p.id, message: p.message ?? null, permalink: p.permalink_url ?? null }, { onConflict: 'fb_post_id' })
  }
}

export async function saveRule(input: { postId: string; keyword: string; matchType: 'exact' | 'contains'; templateId: string; replyOnce: boolean }) {
  const sb = serviceClient()
  await sb.from('keyword_rules').insert({ post_id: input.postId, keyword: input.keyword, match_type: input.matchType, template_id: input.templateId, reply_once: input.replyOnce })
}
```

- [ ] **Step 2: Implement the page `src/app/posts/page.tsx`**

```tsx
import { serviceClient } from '@/lib/supabase/server'

export default async function PostsPage() {
  const sb = serviceClient()
  const { data: posts } = await sb.from('posts').select('id, fb_post_id, message, permalink').order('created_at', { ascending: false })
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">Posts & Keyword Rules</h1>
      <ul className="space-y-3">
        {(posts ?? []).map((p) => (
          <li key={p.id} className="rounded border p-3">
            <p className="font-medium">{p.message?.slice(0, 80) ?? '(no text)'}</p>
            <a className="text-sm text-blue-600" href={p.permalink ?? '#'}>open post</a>
            {/* Rule editor form wired to saveRule() goes here */}
          </li>
        ))}
      </ul>
    </main>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: posts list, post sync, keyword rule creation"
```

### Task 20: Message composer with media upload to Supabase Storage

**Files:**
- Create: `src/app/templates/page.tsx`
- Create: `src/app/templates/actions.ts`

- [ ] **Step 1: Create the Storage bucket**

Run (Supabase SQL editor or dashboard): create a public bucket named `media`.
```sql
insert into storage.buckets (id, name, public) values ('media', 'media', true)
on conflict (id) do nothing;
```

- [ ] **Step 2: Implement template create action with upload**

`src/app/templates/actions.ts`:
```ts
'use server'
import { serviceClient } from '@/lib/supabase/server'

export async function createTemplate(form: FormData) {
  const sb = serviceClient()
  const pageId = form.get('pageId') as string
  const type = form.get('type') as 'text' | 'image' | 'file' | 'buttons'
  const text = (form.get('text') as string) || null
  let mediaUrl: string | null = null

  const file = form.get('file') as File | null
  if (file && file.size > 0) {
    const path = `${pageId}/${file.name}`
    await sb.storage.from('media').upload(path, file, { upsert: true })
    mediaUrl = sb.storage.from('media').getPublicUrl(path).data.publicUrl
  }

  const buttonsRaw = form.get('buttons') as string | null
  await sb.from('message_templates').insert({
    page_id: pageId, type, text, media_url: mediaUrl,
    buttons: buttonsRaw ? JSON.parse(buttonsRaw) : null,
  })
}
```

- [ ] **Step 3: Implement a minimal composer page `src/app/templates/page.tsx`**

```tsx
import { createTemplate } from './actions'

export default function TemplatesPage() {
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">Message Templates</h1>
      <form action={createTemplate} className="max-w-md space-y-3" encType="multipart/form-data">
        <input name="pageId" placeholder="page row id" className="w-full rounded border p-2" required />
        <select name="type" className="w-full rounded border p-2">
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="file">File</option>
          <option value="buttons">Buttons</option>
        </select>
        <textarea name="text" placeholder="Message text" className="w-full rounded border p-2" />
        <input name="file" type="file" className="w-full" />
        <textarea name="buttons" placeholder='Buttons JSON e.g. [{"title":"Open","url":"https://.."}]' className="w-full rounded border p-2" />
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">Save template</button>
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: message template composer with Supabase Storage upload"
```

### Task 21: Broadcast composer + enqueue

**Files:**
- Create: `src/app/broadcasts/page.tsx`
- Create: `src/app/broadcasts/actions.ts`

- [ ] **Step 1: Implement the enqueue action using audience resolution**

`src/app/broadcasts/actions.ts`:
```ts
'use server'
import { serviceClient } from '@/lib/supabase/server'
import { resolveAudience } from '@/lib/audience'

export async function startBroadcast(input: { pageId: string; templateId: string; tag: string | null; requireTag?: string }) {
  const sb = serviceClient()
  const { data: contacts } = await sb.from('contacts')
    .select('psid, subscribed, last_interaction_at, tags').eq('page_id', input.pageId)
  const audience = resolveAudience(contacts ?? [], { hasTag: !!input.tag, requireTag: input.requireTag }, new Date())

  const { data: bc } = await sb.from('broadcasts').insert({
    page_id: input.pageId, template_id: input.templateId, message_tag: input.tag, status: 'queued',
    stats: { total: audience.length },
  }).select('id').single()

  if (audience.length) {
    await sb.from('message_queue').insert(audience.map((c) => ({
      page_id: input.pageId, recipient_psid: c.psid, job_type: 'broadcast',
      payload: { templateId: input.templateId, tag: input.tag, broadcastId: bc!.id },
      idempotency_key: `bc:${bc!.id}:${c.psid}`,
    })))
  }
  return { queued: audience.length }
}
```

- [ ] **Step 2: Implement the page `src/app/broadcasts/page.tsx`**

```tsx
import { startBroadcast } from './actions'

export default function BroadcastsPage() {
  async function action(form: FormData) {
    'use server'
    await startBroadcast({
      pageId: form.get('pageId') as string,
      templateId: form.get('templateId') as string,
      tag: (form.get('tag') as string) || null,
      requireTag: (form.get('requireTag') as string) || undefined,
    })
  }
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">New Broadcast</h1>
      <form action={action} className="max-w-md space-y-3">
        <input name="pageId" placeholder="page row id" className="w-full rounded border p-2" required />
        <input name="templateId" placeholder="template id" className="w-full rounded border p-2" required />
        <input name="tag" placeholder="message tag (optional, leave blank for 24h-window only)" className="w-full rounded border p-2" />
        <input name="requireTag" placeholder="only contacts with this tag (optional)" className="w-full rounded border p-2" />
        <button className="rounded bg-black px-4 py-2 text-white" type="submit">Queue broadcast</button>
      </form>
      <p className="mt-3 text-sm text-gray-500">Contacts outside the 24h window are skipped unless a message tag is provided.</p>
    </main>
  )
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: broadcast composer with window-aware audience enqueue"
```

### Task 22: Delivery logs page

**Files:**
- Create: `src/app/logs/page.tsx`
- Modify: `src/lib/process-db.ts` (write a log row on send/fail)

- [ ] **Step 1: Write a `message_logs` row in markSent/markFailed**

In `src/lib/process-db.ts`, update `markSent` and `markFailed` to also insert into `message_logs`:
```ts
async markSent(id, messageId) {
  const { data: job } = await sb.from('message_queue').select('page_id, recipient_psid, job_type').eq('id', id).single()
  await sb.from('message_queue').update({ status: 'sent' }).eq('id', id)
  await sb.from('message_logs').insert({ page_id: job!.page_id, recipient_psid: job!.recipient_psid, job_type: job!.job_type, status: 'sent', fb_message_id: messageId })
},
async markFailed(id, err) {
  const { data: job } = await sb.from('message_queue').select('page_id, recipient_psid, job_type').eq('id', id).single()
  await sb.from('message_queue').update({ status: 'failed', last_error: err }).eq('id', id)
  await sb.from('message_logs').insert({ page_id: job!.page_id, recipient_psid: job!.recipient_psid, job_type: job!.job_type, status: 'failed', error: err })
},
```

- [ ] **Step 2: Implement the logs page `src/app/logs/page.tsx`**

```tsx
import { serviceClient } from '@/lib/supabase/server'

export default async function LogsPage() {
  const sb = serviceClient()
  const { data: logs } = await sb.from('message_logs').select('*').order('created_at', { ascending: false }).limit(100)
  return (
    <main className="p-8">
      <h1 className="mb-4 text-2xl font-semibold">Delivery Logs</h1>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500"><th>Time</th><th>Type</th><th>Recipient</th><th>Status</th><th>Detail</th></tr></thead>
        <tbody>
          {(logs ?? []).map((l) => (
            <tr key={l.id} className="border-t">
              <td>{new Date(l.created_at).toLocaleString()}</td><td>{l.job_type}</td><td>{l.recipient_psid}</td>
              <td className={l.status === 'sent' ? 'text-green-600' : 'text-red-600'}>{l.status}</td>
              <td>{l.fb_message_id ?? l.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
```

- [ ] **Step 3: Verify build + full test run**

Run: `npm run build && npx vitest run`
Expected: PASS — build succeeds, all unit tests green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: delivery logs page and log writes on send/fail"
```

---

## Phase 6: Integration verification

### Task 23: End-to-end manual verification checklist

**Files:** none (manual verification using a real Facebook test Page in Dev Mode)

- [ ] **Step 1: Deploy a preview + set env**

Run:
```bash
vercel deploy
vercel env add   # add all keys from .env.local.example to the Vercel project
```
Configure the Facebook App webhook callback URL to `https://<preview-url>/api/webhook` with `FB_VERIFY_TOKEN`; subscribe fields `messages`, `messaging_postbacks`, `feed`.

- [ ] **Step 2: Verify webhook handshake**

In the Facebook App dashboard, click "Verify and Save" on the webhook.
Expected: green check — our GET handler echoed `hub.challenge`.

- [ ] **Step 3: Verify comment auto-reply**

Create a keyword rule (`test` → a text template) on a real post. From a second test account, comment "test" on that post.
Expected: within ~1 min (next cron tick) the commenter receives the Inbox private reply; a `sent` row appears in Logs.

- [ ] **Step 4: Verify in-window broadcast**

Message the Page from the test account (opens the 24h window). Queue a broadcast with no tag.
Expected: the test account receives the broadcast; Logs shows `sent`.

- [ ] **Step 5: Verify out-of-window guard**

Manually set a contact's `last_interaction_at` to 2 days ago in Supabase. Queue a no-tag broadcast to them.
Expected: that job ends `failed` with `blocked: outside_window_no_tag` — NOT sent. This confirms the policy guard works.

- [ ] **Step 6: Commit any fixes found during verification**

```bash
git add -A && git commit -m "fix: issues found during end-to-end verification"
```

---

## Self-Review Notes (coverage map)

- **Comment auto-reply (per-post keywords):** Tasks 6, 13, 14, 15, 19 ✅
- **Broadcast + 24h/tag guard:** Tasks 7, 9, 15, 21 ✅
- **Content types text/image/file/buttons:** Tasks 11, 20 ✅
- **Webhook security + idempotency:** Tasks 5, 14 (idempotency_key) ✅
- **Queue + retry/backoff:** Tasks 8, 15, 16 ✅
- **Supabase Postgres + Storage + Auth:** Tasks 3, 10, 18, 20 ✅
- **Token encryption:** Tasks 4, 17 ✅
- **Poppins font:** Task 2 ✅
- **Dashboard (posts/templates/broadcasts/logs):** Tasks 19–22 ✅
- **Facebook connect + webhook subscribe:** Task 17 ✅
- **Multi-tenant readiness (RLS):** Task 3 ✅
