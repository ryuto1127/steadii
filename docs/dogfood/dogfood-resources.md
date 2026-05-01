# Dogfood — resources + result tracking

Companion to the Section A-N handbook. Open this in a tab while running dogfood; fill in the table as you go.

---

## Materials inventory

| material | location | notes |
|---|---|---|
| Test syllabus PDF | `/tmp/MAT223_TestSyllabus_Spring2026.pdf` | Synthetic but realistic. Contains MAT 223 — Linear Algebra I, 7 schedule rows with ISO dates (2026-01-13 → 2026-04-14). Use for Section C.3-5. |
| Test iCal feed URL | `https://www.officeholidays.com/ics-clean/japan` | JP holidays. Use for Section G. |
| Admin Google account | `admin@example.com` | Already signed in (admin flag set in DB). |
| Test waitlist account | Any other Google account (e.g. `admin-alt@example.com` from earlier dogfood) | Use for Section J — submit waitlist request from incognito. |
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
DELETE FROM waitlist_requests WHERE email = 'admin-alt@example.com';

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
