# CLAUDE.md

Guidance for working in this repository.

## What this project is

A web tool to manage Facebook Page messaging, with two core features:

1. **Comment Auto-Reply** — detect keywords in comments on the Page's posts and
   automatically send a private Inbox message (text / image / file / buttons) to
   the commenter. Keyword rules are configured **per post**.
2. **Broadcast** — send messages to people who have chatted with the Page,
   strictly within Facebook's 24-hour messaging window or via approved message
   tags.

Starts on the owner's own Page; designed to grow into a multi-tenant SaaS.

Full design: `docs/superpowers/specs/2026-06-07-facebook-broadcast-autoreply-design.md`

## ⚠️ Facebook policy — non-negotiable

Violating these can get the Page **banned**. Treat them as hard invariants:

- **24-hour window:** the Page may message a user freely only within 24h of that
  user's last message. Outside the window, sending requires a valid **message
  tag** — promotional broadcast to old contacts is NOT allowed.
- **Always check the window before a non-tagged send.** This guard must not be
  bypassable from the UI or API.
- **Private Replies** open a conversation from a comment — allowed **once per
  comment**, within ~7 days.
- **Verify `X-Hub-Signature-256`** on every webhook POST.
- **Idempotency:** Facebook resends webhook events; dedup so we never send twice.

When unsure whether something is allowed, check the Messenger Platform policy
rather than guessing — getting this wrong is the most expensive failure here.

## Stack

- **Next.js 16 (App Router) + TypeScript** on **Vercel**
- **Supabase** — Postgres (data + queue), Storage (media to send), Auth (dashboard)
- **Vercel Cron** — drives the queue worker (`/api/cron/process-queue`, every 1 min)
- **Facebook Graph API / Messenger Platform**

## Architecture (Approach A: Serverless + Cron Queue)

Single Next.js app does Dashboard + API + Webhook + Cron worker.

```
Facebook ──webhook──▶ /api/webhook ──▶ enqueue job in Supabase
Vercel Cron (1 min) ─▶ /api/cron/process-queue ─▶ send batch ─▶ FB Send API
Dashboard ◀──read/write──▶ Supabase (Postgres + Storage + Auth)
```

The webhook must **enqueue and return 200 fast** — never send inline. All sending
happens in the cron worker, which claims jobs with `FOR UPDATE SKIP LOCKED`,
sends, and retries with exponential backoff.

## Key tables

`pages`, `contacts`, `posts`, `keyword_rules`, `message_templates`,
`broadcasts`, `message_queue`, `message_logs`. See the design spec for columns.
Use **Supabase Row Level Security** scoped per owner so the data model is
multi-tenant-ready.

## UI conventions

- **Font: Poppins** across the dashboard.
- Keep the dashboard simple and task-focused: connect page → set rules →
  compose → send → view logs.

## Conventions & workflow

- **TDD:** write tests first (Vitest). Cover keyword matching, audience
  filtering, the 24h-window check, and queue claim/backoff logic.
- Keep modules small and single-purpose: webhook parsing, FB API client,
  queue worker, and matching logic are separate, independently testable units.
- Never log or commit access tokens. Page tokens are encrypted at rest.
- Secrets via environment variables (`vercel env` / `.env.local`); never hardcode.

## Out of scope (v1)

Read/open analytics, AI auto-conversation, Instagram/WhatsApp, billing. Don't
add these without an explicit decision.
