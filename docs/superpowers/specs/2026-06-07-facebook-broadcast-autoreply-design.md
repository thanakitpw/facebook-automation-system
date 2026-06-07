# Facebook Page Broadcast & Auto-Reply — Design Spec

**Date:** 2026-06-07
**Status:** Approved
**Owner:** agency.bestsolutions@gmail.com

## 1. Purpose

A web tool to manage Facebook Page messaging, with two core features:

1. **Comment Auto-Reply** — detect keywords in comments on a Page's posts and automatically send a private Inbox message to the commenter (text, image, file, or buttons). Per-post keyword rules.
2. **Broadcast** — send messages to people who have chatted with the Page, respecting Facebook's 24-hour messaging window and message tags.

**Initial scope:** the owner's own Page. **Future:** multi-tenant SaaS sold to other Page owners.

## 2. Hard Constraints (Facebook Policy)

These shape the entire design — violating them risks Page bans:

- **24-hour standard messaging window:** the Page may message a user freely only within 24h of that user's last message. Outside the window, only an approved **message tag** (e.g. `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, `ACCOUNT_UPDATE`) is allowed — promotional broadcast to old contacts is NOT permitted.
- **Private Replies** (`POST /{comment-id}/private_replies`) legitimately open a conversation from a comment. Allowed **once per comment**, within ~7 days of the comment.
- The system MUST enforce the window/tag rules automatically before any send. No "send to everyone" escape hatch.
- **App Review:** the owner's own Page runs in Dev Mode without review. Public/SaaS use requires Facebook App Review for `pages_messaging` etc.

## 3. Architecture (Approach A: Serverless + Cron Queue)

Single Next.js (App Router) app on Vercel handling Dashboard + API + Webhook + Cron worker. Backed by Supabase.

```
Facebook ──webhook──▶ /api/webhook ──▶ enqueue job in Supabase
                                              │
Vercel Cron (every 1 min) ──▶ /api/cron/process-queue ──▶ send batch ──▶ FB Send API
                                              │
Dashboard (Next.js) ◀──read/write──▶ Supabase (Postgres + Storage + Auth)
```

**Why A:** cheapest, single codebase, fast to ship, and the data model migrates cleanly to Vercel Queues (B) or a dedicated worker (C) when scale demands it — without rework.

### Stack
- **Frontend/Backend:** Next.js 16 (App Router) + TypeScript on Vercel
- **Database:** Supabase Postgres
- **Media storage:** Supabase Storage (images/files to send)
- **Auth:** Supabase Auth (dashboard login; foundation for multi-tenant)
- **Background work:** Vercel Cron → queue table in Postgres
- **External API:** Facebook Graph API / Messenger Platform
- **Font:** Poppins (dashboard UI)

## 4. Components

| Component | Responsibility |
|-----------|----------------|
| **Webhook Receiver** (`/api/webhook`) | GET = verify challenge. POST = verify `X-Hub-Signature-256`, parse `feed` (comments) + `messages` events, enqueue work, return 200 fast. |
| **Comment Auto-Reply Engine** | On comment event: look up the post's keyword rules → match → enqueue a Private Reply job. Dedup per (comment/commenter, rule). |
| **Broadcast Engine** | Compose from template → resolve audience (eligible contacts) → split into batches → enqueue jobs. |
| **Queue Worker** (`/api/cron/process-queue`) | Claim a batch (`FOR UPDATE SKIP LOCKED`), send via FB API, update status, retry with backoff, honor rate limits. |
| **Contact Sync** | Upsert every commenter/messager: PSID, `last_interaction_at` (for 24h window), source, tags. |
| **Dashboard** | Connect Page (OAuth), per-post keyword rule editor, message composer (text/image/file/buttons) with Storage upload, broadcast creator + audience selector + schedule, contacts list, delivery logs. |

## 5. Data Model (Supabase Postgres)

- `pages` — page_id, name, access_token (encrypted), token_expiry, owner_user_id
- `contacts` — id, page_id, psid, name, last_interaction_at, subscribed, tags[]
- `posts` — post_id, page_id, message, permalink, created_at
- `keyword_rules` — id, post_id, keyword, match_type (exact/contains), template_id, reply_once (bool)
- `message_templates` — id, type (text/image/file/buttons), text, media_url, buttons (jsonb)
- `broadcasts` — id, template_id, audience_filter (jsonb), message_tag (nullable), scheduled_at, status, stats (jsonb)
- `message_queue` — id, page_id, recipient_psid, payload (jsonb), job_type (auto_reply/broadcast), status (pending/processing/sent/failed), attempts, scheduled_at, last_error, idempotency_key
- `message_logs` — id, page_id, recipient_psid, job_type, status, fb_message_id, error, created_at
- `app_users` — managed via Supabase Auth (dashboard users)

Row Level Security on Supabase scopes data per owner — ready for multi-tenant.

## 6. Facebook Integration Detail

- **Permissions:** `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`
- **Webhook fields:** `messages`, `messaging_postbacks`, `feed`
- **Private Reply:** `POST /{comment_id}/private_replies` with the message payload
- **Send API:** `POST /me/messages` with `messaging_type` = `RESPONSE` (in-window) or `MESSAGE_TAG` + `tag` (out-of-window)
- **Window check:** before any non-tagged send, verify `now - contact.last_interaction_at < 24h`; otherwise require a valid tag or skip + log reason.
- **Attachments:** upload media to Supabase Storage, then pass the public URL to FB's attachment API (or reuse `attachment_id`).

## 7. Error Handling & Security

- Verify `X-Hub-Signature-256` on every webhook POST; reject mismatches.
- Idempotency key per webhook event (FB may resend) to avoid duplicate sends.
- Queue retry: exponential backoff, capped attempts → mark `failed` + surface in dashboard.
- Rate limit (HTTP 429 / FB error subcodes) → backoff and requeue.
- Encrypt Page access tokens at rest; warn before token expiry in the dashboard.
- Enforce 24h-window / message-tag rules as a non-bypassable guard in the send path.

## 8. Testing (TDD)

- **Unit:** keyword matching (exact/contains, case/Thai handling), audience filtering, 24h-window check, queue claim logic, backoff calculation.
- **Integration:** webhook signature verification, FB API client (mocked), Private Reply flow, queue processing.
- **E2E:** dashboard flows — connect page, create rule, compose + send broadcast, view logs.

## 9. Out of Scope (v1 / YAGNI)

- Open-rate / read analytics beyond delivery status
- AI/LLM auto-conversation
- Multi-channel (Instagram/WhatsApp) — Messenger only for now
- Billing/subscription (added in SaaS phase)

## 10. Milestones

1. **Foundation** — Next.js + Supabase + Auth + schema + Poppins UI shell
2. **Facebook connect** — OAuth, store page token, subscribe webhook
3. **Webhook + Contact Sync** — receive events, upsert contacts
4. **Queue Worker** — cron, claim/send/retry, FB Send client
5. **Comment Auto-Reply** — post sync, keyword rules UI, private reply jobs
6. **Broadcast** — composer, audience selector, window/tag guard, schedule
7. **Logs & polish** — delivery logs, token-expiry warnings, hardening
