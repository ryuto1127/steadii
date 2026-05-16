# Dogfood — resources + result tracking

Companion to the Section A-N handbook. Open this in a tab while running dogfood; fill in the table as you go.

---

## Materials inventory

| material | location | notes |
|---|---|---|
| Test syllabus PDF | `/tmp/MAT223_TestSyllabus_Spring2026.pdf` | Synthetic but realistic. Contains MAT 223 — Linear Algebra I, 7 schedule rows with ISO dates (2026-01-13 → 2026-04-14). Use for Section C.3-5. |
| Test iCal feed URL | `https://www.officeholidays.com/ics-clean/japan` | JP holidays. Use for Section G. |
| Admin Google account | `admin@example.com` | Already signed in (admin flag set in DB). |
| Test waitlist account | Any other Google account (e.g. `sample@example.com` from earlier dogfood) | Use for Section J — submit waitlist request from incognito. |
| Reduced Motion toggle | macOS System Settings → Accessibility → Display → "Reduce motion" | Section H — toggle ON to verify static fallbacks. |

---

## Result tracking — fill in as you go

Use ✓ / ✗ / ⚠ (blocker) / — (skipped). Add 1-line note for any non-✓ row.

### Section A — Domain + Auth (5 min)
| step | status | notes |
|---|---|---|
| A.1 https://mysteadii.com → 200 | ✓ | curl confirms HTTP/2 200 |
| A.2 https://mysteadii.xyz → 308 → .com | ✓ | 308 → location: https://mysteadii.com/ |
| A.3 https://www.mysteadii.com → 308 → apex | ✓ | 308 → location: https://mysteadii.com/ |
| A.4 Sign-in → /app, sidebar 6 items | — | needs Ryuto (Google OAuth not testable from engineer; localhost /app correctly redirects to /login?from=%2Fapp) |

### Section B — Onboarding (5 min, SKIP if admin already onboarded)
| step | status | notes |
|---|---|---|
| B.1 Step 1 JA title "Google を接続" | — | needs Ryuto auth — also handbook says SKIP if admin already onboarded |
| B.2 Step 2 JA title "他のサービス（任意）" | — | needs Ryuto auth |
| B.3 Skip → /app no loop | — | needs Ryuto auth |
| B.4 Re-signin → no Step 2 re-show | — | needs Ryuto auth |

### Section C — Chat basic (10 min)
| step | status | notes |
|---|---|---|
| C.1 "5/16学校休む" → eager-read inline (no `[calendar_create_event]` raw text) | — | needs Ryuto auth + LLM live |
| C.1 Pill button(s) below for write actions only | — | needs Ryuto auth |
| C.2 Chat title generates within ~5s | — | needs Ryuto auth |
| C.3 Syllabus PDF drag → "取り込みました" + N items | — | needs Ryuto auth + OpenAI |
| C.3 File pill collapses after submit | — | needs Ryuto auth |
| C.4 /app/classes shows new "Math II" / MAT223 class row | — | needs Ryuto auth |
| C.5 /app/calendar shows N events, NO `[Steadii]` prefix | — | needs Ryuto auth |
| C.5 Event description has "Imported from Steadii syllabus" | — | needs Ryuto auth |
| C.5 Re-upload same syllabus → no duplicate | — | needs Ryuto auth |

### Section D — Inbox + sender picker (10 min)
| step | status | notes |
|---|---|---|
| D.1 /app/inbox shows triage list with risk badges | — | needs Ryuto auth + Gmail integration |
| D.2 Inline "New sender" section (NOT modal) | — | needs Ryuto auth |
| D.3 7 buttons: Professor/TA/Classmate/Admin/Career/Personal/Other | — | needs Ryuto auth |
| D.4 Click "Career" → collapse + persist (reload no re-show) | — | needs Ryuto auth |
| D.5 Click "Skip" on different sender → re-shows on reload | — | needs Ryuto auth |
| D.5 "+ Type new class name" → class created | — | needs Ryuto auth |
| Glass-box ThinkingBar pills + footnote citations | — | needs Ryuto auth |

### Section E — Notification UX (5 min)
| step | status | notes |
|---|---|---|
| E.1 Bell click → 2-section dropdown ("Needs review" + "Steadii noticed") | — | needs Ryuto auth |
| E.2 Syllabus auto-import in "Steadii noticed" (after C.3) | — | needs Ryuto auth |
| E.3 Click → proposal-detail page | — | needs Ryuto auth |
| E.4 Inbox triage list does NOT contain auto-action records | — | needs Ryuto auth |

### Section F — Settings → Connections (5 min)
| step | status | notes |
|---|---|---|
| F.1 /app/settings → Connections card click → /connections | — | needs Ryuto auth |
| F.2 5 sections: Google Cal/Gmail/MS 365/iCal/Notion | — | needs Ryuto auth |

### Section G — iCal subscribe (10 min)
| step | status | notes |
|---|---|---|
| G.1 Chat: "https://www.officeholidays.com/ics-clean/japan を Steadii に追加して" → ical_subscribe tool fires | — | needs Ryuto auth |
| G.2 /app/calendar shows JP holiday events | — | needs Ryuto auth |
| G.3 Settings → iCal section shows subscription, status active | — | needs Ryuto auth |
| G.4 Re-paste same URL → "Already subscribed" idempotent | — | needs Ryuto auth |

### Section H — Visual polish (5 min, SUBJECTIVE — Ryuto eye)
| step | status | notes |
|---|---|---|
| H.1 Sidebar logo = diamond shape (rotated 45°) | | |
| H.2 Logo hue cycles through pink/orange/yellow over ~14 sec | | |
| H.3 Reduce Motion ON → animation stops, static diamond | | |
| H.4 Sidebar nav active item = rounded square (1:1 aspect, soft corners) — NOT sharp square | | |
| H.5 Mobile breakpoint (DevTools 375x812) — sidebar shape preserved | | |
| H.6 Landing `/` hero animation: 13s loop runs smoothly | | |
| H.7 Landing top-left logo = diamond + hue (matches /app) | | |
| H.8 Landing file pill collapses on submit pulse | | |
| H.9 Landing sidebar mock = rounded 1:1 square | | |
| H.10 "And it watches your back" first window appears within ~0.4s of scroll-in | | |
| H.11 Reduce Motion ON → landing static fallback | | |

### Section I — Tasks + Calendar (5 min)
| step | status | notes |
|---|---|---|
| I.1 /app/tasks shows unified Steadii + Google + (MS) tasks, source badges, due-sorted | — | needs Ryuto auth |
| I.2 /app/calendar week view: Google + Steadii + iCal merge correctly, tz correct | — | needs Ryuto auth |

### Section J — Admin waitlist flow (5 min)
| step | status | notes |
|---|---|---|
| J.1 Incognito → /request-access submit → confirmation | ✓ (form renders) | /request-access loads + form fields visible (tested at localhost in JP locale, screenshot captured); actual submit pipeline needs Ryuto incognito to verify email roundtrip |
| J.2 Admin bell shows clipboard entry "Waitlist request from {email}" | — | needs Ryuto admin auth |
| J.3 Click → /app/admin/waitlist?tab=pending shows row | — | needs Ryuto admin auth |
| J.4 Approve → "Approved 1, 0 failed" (Stripe bug NOT regressed) | — | needs Ryuto admin auth |
| J.5 Bell entry auto-clears | — | needs Ryuto admin auth |
| J.6 Sync Card shows email under "Approved (not synced)", Copy works | — | needs Ryuto admin auth |
| J.7 Incognito inbox: approval email arrives within ~30s | — | needs Ryuto admin auth |

### Section K — Settings 全体 (5 min)
| step | status | notes |
|---|---|---|
| K.1 Connections link card visible (covered in F) | — | needs Ryuto auth |
| K.2 Notifications: undo slider 10-60s, digest 7am toggle | — | needs Ryuto auth |
| K.3 Agent rules → "Learned contacts" shows D-classified senders | — | needs Ryuto auth |
| K.4 "How your agent thinks" route loads, last drafts visible | — | needs Ryuto auth |
| K.5 Billing: plan badge, credits/storage bars | — | needs Ryuto auth |
| K.5 Currency lock caption visible (if active sub) | — | needs Ryuto auth |
| K.6 Danger zone visible (don't execute) | — | needs Ryuto auth |

### Section L — Sentry / Vercel logs (5 min)
| step | status | notes |
|---|---|---|
| L.1 Sentry Issues → zero unresolved after dogfood | — | needs Ryuto (no Sentry API token in env; only DSN ingest credential present) |
| L.2 Test error fires (e.g. /app/chat/invalid-uuid) → Sentry catches | — | needs Ryuto auth + Sentry dashboard |
| L.3 Vercel logs → no critical/5xx during dogfood | — | needs Ryuto Vercel dashboard |

### Section M — Lighthouse (5 min, RYUTO DevTools)
| step | status | score |
|---|---|---|
| M.1 `/` Performance ≥ 85 | — | Ryuto runs locally per handbook |
| M.1 `/` Accessibility ≥ 90 | — | Ryuto runs locally per handbook |
| M.2 `/app` Performance ≥ 85 | — | Ryuto runs locally per handbook |
| M.2 `/app` Accessibility ≥ 90 | — | Ryuto runs locally per handbook |

### Section N — DEPLOY.md §8 smoke (10 min)
| step | status | notes |
|---|---|---|
| N.x | — | needs Ryuto (production deploy verification + DEPLOY.md §8 cheatsheet items not yet covered) |

### Section W2 — Home rebuild (Wave 2 SHIPPED #118 / #120, polish-25 verifies)

Verifies the post-Wave-2 Home is rendering correctly: 5 queue archetypes (A-E), command palette docked + ⌘K, sidebar Wave 2 order, briefing card data correctness, empty state, recent-activity footer.

| step | status | notes |
|---|---|---|
| W2.1 `/app` shell loads with greeting + command palette + queue + briefing + recent activity | | |
| W2.2 Queue archetypes A-E render with correct visual treatment (border, spacing, confidence tiers) | | |
| W2.3 Type A (Decision) card shows decision option buttons + dismiss; only ONE dismiss control visible (no synthetic English "Dismiss" duplicate) | | |
| W2.4 Type B (Draft-ready) card shows embedded draft preview + Review / Send / Skip; ⌘K does not collide | | |
| W2.5 Type B variant (informational, no primary send) renders secondary actions only (open_detail / open_calendar / mark_reviewed) | | |
| W2.6 Type C (Soft notice) shows minimal card + single primary action + dismiss | | |
| W2.7 Type D (FYI / completed) renders chip-style at low contrast | | |
| W2.8 Type E (Clarifying) shows ❓ icon + radio choices + free-text fallback | | |
| W2.9 Command palette: docked at top of /app; placeholder rotates examples; Cmd+K focuses input | | |
| W2.10 Command palette: focused state shows Recent + Examples sections | | |
| W2.11 Sidebar order matches Wave 2 spec: Home → Inbox → Calendar → Tasks → Classes (5 primary). 履歴 is demoted to inline RECENT CHATS list. Settings is via account footer pill | | |
| W2.12 Briefing 3-column row (Calendar / Tasks / Deadlines) renders with localized labels in EN + JA | | |
| W2.13 Empty state: when queue=0, "queue is empty" CTA appears + focuses palette | | |
| W2.14 Recent activity footer renders below queue with Type D-style chips | | |
| W2.15 Wave 2 keyboard shortcuts: gh (home), gi (inbox), gc (calendar), gt (tasks), gk (classes), gj (chats demoted) | | |
| W2.16 Onboarding wait pattern: Step 3 onwards focuses palette ("Steadii に頼む…") rather than feature exploration | | |

### Section W3 — Wave 3: pre-brief / groups / office hours (SHIPPED #121, polish-25 verifies)

Verifies Wave 3 secretary-deepening features render correctly. Behavioral correctness (cron firing 15min before events, member silence detection accuracy) is observability/cron-fired and verified separately via heartbeat panel.

| step | status | notes |
|---|---|---|
| W3.1 Meeting pre-brief: detail page `/app/pre-briefs/[id]` renders with attendee context, last-interaction summary, pending topics, deadlines | | |
| W3.2 Meeting pre-brief: in queue, renders as Type B variant (informational, secondary actions only) — Open detail, Open in Calendar, Mark reviewed; NO primary "Send" button | | |
| W3.3 Group project: `/app/groups/[id]` route renders members list, tasks, source threads, deadline countdown | | |
| W3.4 Group project: silence detection surfaces as Type C card ("X silent N days"), click upgrades to Type B (drafted check-in) | | |
| W3.5 Group project: actions [全員に進捗確認 broadcast] [タスク追加] [メンバー追加] [Archive] visible on detail page | | |
| W3.6 Office hours scheduler: command palette can trigger flow ("Prof X と office hours") | | |
| W3.7 Office hours: Type A card shows 3 candidate slots + compiled questions + Pick slot / Edit / Cancel | | |
| W3.8 Office hours: confirming slot transitions to Type B for email review/send | | |
| W3.9 group_projects + group_project_members + group_project_tasks tables exist in schema (`pnpm db:studio`) | | |
| W3.10 class_office_hours table exists OR professors.office_hours JSON column populated for ingested syllabi | | |

### Section W5 — Wave 5: auto-archive + hardening + onboarding edges (SHIPPED #124, polish-25 verifies)

Verifies Wave 5 final-α-wave features. Note 2-week safety ramp window in progress until ~2026-05-16; auto-archive default OFF until then.

| step | status | notes |
|---|---|---|
| W5.1 Settings → Inbox: "Hide low-risk emails" toggle visible + persists across reload | | |
| W5.2 With toggle ON: Inbox filter chip "Hidden (N)" appears at top, click reveals hidden items inline | | |
| W5.3 Hidden item "Restore" button: moves item back into inbox triage list, removes from hidden | | |
| W5.4 Search includes hidden items by default (no surprise misses by sender / subject) | | |
| W5.5 Recent activity footer on Home lists hidden items as Type D chips (low contrast) | | |
| W5.6 Audit log: every auto-archive event recorded in `audit_log` table with `event_type='auto_action_log'` (verify via `pnpm db:studio`) | | |
| W5.7 Gmail revoked banner: when `gmail_token_revoked_at IS NOT NULL`, banner appears at top of /app with "Reconnect Gmail" CTA | | |
| W5.8 Re-consent flow: clicking Reconnect → Google OAuth → returns and clears `gmail_token_revoked_at` | | |
| W5.9 Onboarding skip recovery banner: if user skipped Step 2 (integrations), `/app` shows "Connect calendar to get more from Steadii" banner with [Connect now] [Dismiss] | | |
| W5.10 Skip recovery banner: dismissing persists (banner does NOT re-appear on reload) | | |
| W5.11 `/app/admin` heartbeat panel renders: cron last-run timestamps + green/yellow/red health pill per cron | | |
| W5.12 `/app/admin` Sentry alert config visible (test errors fire and show in Sentry Issues) | | |
| W5.13 Soak-test docs exist at `docs/launch/soak-results.md` OR equivalent | | |
| W5.14 Rollback procedure documented (Vercel "promote previous deployment" tested) | | |
| W5.15 Migration 0029 (gmail_token_revoked_at + auto_action_events) applied to prod (re: feedback_prod_migration_manual.md) | | |
| W5.16 Default value: `AUTO_ARCHIVE_DEFAULT_ENABLED=false` for new signups during 2-week ramp window (until ~2026-05-16) | | |

### Cross-cutting C1 — Dark mode parity (5 min)

Engineer toggles `prefers-color-scheme: dark` via DevTools / `preview_resize colorScheme: dark` and verifies every /app surface renders correctly.

| step | status | notes |
|---|---|---|
| C1.1 /app Home dark mode renders without contrast / overflow / unstyled-flash artifacts | | |
| C1.2 /app/inbox dark mode | | |
| C1.3 /app/chat/[id] dark mode | | |
| C1.4 /app/settings + sub-routes dark mode | | |
| C1.5 /app/calendar + /app/tasks dark mode | | |

### Cross-cutting C2 — EN + JA parity (5 min)

Engineer toggles `steadii-locale` cookie and reloads each surface; checks for `MISSING_MESSAGE` in console.

| step | status | notes |
|---|---|---|
| C2.1 No `MISSING_MESSAGE` in console for /app in EN | | |
| C2.2 No `MISSING_MESSAGE` in console for /app in JA | | |
| C2.3 No raw English leakage on JA queue cards (titles excepted — server-built, deferred to engineer-26+) | | |
| C2.4 No raw Japanese leakage on EN queue cards | | |
| C2.5 Command palette placeholder rotates correctly in both locales | | |

### Cross-cutting C3 — Mobile responsive (5 min)

Engineer drives `preview_resize preset: mobile` (375x812) and verifies main screens.

| step | status | notes |
|---|---|---|
| C3.1 /app Home renders mobile without horizontal scroll | | |
| C3.2 /app/inbox triage list renders mobile | | |
| C3.3 /app/chat/[id] mobile (message bubbles + composer) | | |
| C3.4 /app/settings mobile (panels stack) | | |
| C3.5 Sidebar collapses to mobile drawer pattern | | |

### Cross-cutting C4 — Lighthouse (5 min)

Engineer runs `lighthouse` against `/` and `/app` (when feasible against dev). Real production scores are Ryuto's responsibility from Chrome DevTools per handbook M.

| step | status | notes |
|---|---|---|
| C4.1 `/` Performance | | dev-mode score is unreliable; Ryuto runs M against prod |
| C4.1 `/` Accessibility | | |
| C4.2 `/app` Performance | | |
| C4.2 `/app` Accessibility | | |

---

## Cleanup SQL — run AFTER dogfood (Neon SQL Editor)

```sql
-- Get user id
SELECT id FROM users WHERE email = 'admin@example.com';
-- → use as <USER_ID> below

BEGIN;

-- 1. Remove test syllabus events from Google Calendar mirror
DELETE FROM events
WHERE user_id = '<USER_ID>'
  AND source_metadata->>'source' = 'syllabus_auto_import';

-- 2. Remove test syllabus + class from Steadii Postgres
DELETE FROM syllabi WHERE user_id = '<USER_ID>' AND title LIKE '%MAT 223%';
DELETE FROM classes WHERE user_id = '<USER_ID>' AND (code = 'MAT 223' OR name ILIKE '%Linear Algebra%');

-- 3. Remove test iCal subscription
DELETE FROM ical_subscriptions
WHERE user_id = '<USER_ID>'
  AND url ILIKE '%officeholidays%';

-- 4. Remove test iCal events
DELETE FROM events
WHERE user_id = '<USER_ID>'
  AND source_type = 'ical_subscription';

-- 5. Reset sender classifications from D.4 (optional — keep if you want
--    the Career classification to persist for real use)
-- UPDATE inbox_items SET sender_role = NULL WHERE user_id = '<USER_ID>' AND sender_role IS NOT NULL;

-- 6. Remove test waitlist request from J (if it was a one-off test)
DELETE FROM waitlist_requests WHERE email = 'sample@example.com';

-- 7. Remove the auto-generated Stripe Promotion Code (manual via Stripe Dashboard:
--    Coupons → STEADII_FRIEND_3MO → Promotion Codes → archive STEADII-SAMPLE)

COMMIT;
```

Inspect carefully before running — adjust WHERE clauses if any of your real data could be touched.

The Stripe-side code archive is manual via Dashboard since DB doesn't store it.

You can also leave test events in your Google Calendar — they're labeled with the syllabus class code so they're easy to spot and delete from Calendar UI.

---

## Issues found — fill as you go

| section.step | severity (CRITICAL/HIGH/MEDIUM/LOW) | description | screenshot? |
|---|---|---|---|
| (none surfaced by engineer 16) | — | Engineer 16's reachable surface (publicly testable URLs, dev-server localhost, curl checks) showed no defects. Sections needing Ryuto's account were marked `—` (skipped) — sparring should rerun those before α launch. | n/a |

---

## Output to share with sparring

After dogfood:
1. Screenshot of the result tracking table (or paste markdown)
2. Issues found list above
3. Any subjective notes on UX feel (animations, copy, polish)

Sparring will diagnose each FAIL/BLOCKER and write hotfix handoffs as needed.
