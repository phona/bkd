---
id: CHAT-011
title: Chat message rendering robustness — async Shiki/diff fault tolerance
status: completed
priority: P2
owner: claude
created: 2026-06-06
updated: 2026-06-06
plan: PLAN-034
---

# CHAT-011 — Chat message rendering robustness

Make async Shiki / diff loads fault-tolerant so a network hiccup never leaves a
permanently-broken renderer. Full design in PLAN-034.

## Root cause + fixes

- `lib/shiki.ts` memoizes `shikiPromise`; if `import('shiki')` rejects once, the
  rejected promise is cached and **every** future highlight fails for the rest of
  the session. → Clear the cache on failure so the next call retries. (keystone)
- The two `ShikiCodeBlock` components call `codeToHtml(...).then()` with no
  `.catch()` (unhandled rejection) and never retry → add catch + bounded retry;
  raw `<pre>` fallback already exists.
- `ShikiUnifiedDiff` renders `@pierre/diffs` via `lazy` + `Suspense`, which does
  not catch import errors → wrap in an ErrorBoundary that falls back to raw.
- `ShikiPatchDiff` import lacks `.catch()` (already degrades to a raw code block).

## Verification

lint + tsc + frontend test suite + vite build.
