# Migration — `mysteadii.xyz` → `mysteadii.com`

Ryuto acquired `mysteadii.com` to escape `.xyz` TLD reputation issues at school-network filters (TLS MITM was blocking access on Loblaw / school WiFi). **TLD-only swap** — brand identifier "Steadii" and domain prefix "mysteadii" both unchanged. Only `.xyz` → `.com`.

74 hardcoded `mysteadii.xyz` references across the repo (`grep -rn "mysteadii\.xyz" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" --include="*.css"`). Single sweep PR.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `migrate-domain-mysteadii-com`. Don't push without Ryuto's explicit authorization.

## Prerequisite (Ryuto-side, may be in parallel)

- Namecheap registers `mysteadii.com`
- Vercel: add `mysteadii.com` as a Production domain on the project; set as primary
- DNS at Namecheap: copy the A record IP + CNAME target shown in the Vercel domains panel (Vercel now issues project-specific values like `216.198.79.x` + `<hash>.vercel-dns-017.com` rather than the legacy generic `76.76.21.21` / `cname.vercel-dns.com`). Default Namecheap parking records (CNAME `www` → `parkingpage.namecheap.com`, URL Redirect `@`) MUST be deleted first to avoid CNAME / A conflicts.
- Vercel auto-issues Let's Encrypt cert (~minutes after DNS propagates)
- Vercel env: `APP_URL=https://mysteadii.com` in Production + Preview → triggers redeploy
- OAuth: add `https://mysteadii.com/api/auth/callback/{google,microsoft-entra-id,notion}` to each provider's redirect URI list (KEEP existing mysteadii.xyz callbacks until traffic confirms migration)
- Stripe webhook: target `https://mysteadii.com/api/stripe/webhook` (set up during Phase 2 ops)
- Resend: add `mysteadii.com` as a sending domain, configure DKIM / SPF / DMARC at Namecheap DNS, verify
- Vercel: add `mysteadii.xyz` as an aliased domain → permanent 308 redirect to `mysteadii.com` (preserves old links + protects from squatting; mysteadii.xyz registration stays renewed for the foreseeable future)

The code-side work below proceeds independently of these ops; both can run in parallel and converge at deploy.

## Code-side sweep — TLD-only

This is a mechanical find-and-replace `mysteadii.xyz` → `mysteadii.com`. The brand identifier, the domain prefix, and the entire "my" framing all stay. Only the TLD changes.

### Fix 1 — env defaults

`lib/env.ts`:

- `RESEND_FROM_EMAIL`: default `"agent@mysteadii.xyz"` → `"agent@mysteadii.com"`
- `ADMIN_EMAIL`: default `"hello@mysteadii.xyz"` → `"hello@mysteadii.com"`
- Comment line 62: update `"hello@mysteadii.xyz"` → `"hello@mysteadii.com"`

If `APP_URL` has any default in `lib/env.ts`, also update it. (It typically reads from Vercel env without a default — verify.)

### Fix 2 — Resend templates / clients

`lib/integrations/resend/templates/access-approved.ts`:

- `from: "Steadii <hello@mysteadii.xyz>"` → `"Steadii <hello@mysteadii.com>"`
- `replyTo: "hello@mysteadii.xyz"` → `"hello@mysteadii.com"`

`lib/integrations/resend/client.ts`:

- `return e.RESEND_FROM_EMAIL || "agent@mysteadii.xyz"` → `"agent@mysteadii.com"`
- Comment line 29: update example to `"Steadii Agent <agent@mysteadii.com>"`

Sweep the whole `lib/integrations/resend/` directory for any remaining hardcoded address.

### Fix 3 — Public surfaces

`app/sitemap.ts:4`: `const base = "https://mysteadii.xyz"` → `"https://mysteadii.com"`.

`app/opengraph-image.tsx:68`: footer text `mysteadii.xyz` → `mysteadii.com`.

`app/(marketing)/page.tsx:243`: `mailto:hello@mysteadii.xyz` → `mailto:hello@mysteadii.com`.

Check `app/robots.txt` (if exists) for sitemap URL pointing at the old domain.

### Fix 4 — Test fixtures

Tests reference `mysteadii.xyz` to avoid hitting the real env. Update so test snapshots stay realistic but use the new domain:

- `tests/digest-renderer.test.ts`: lines 17, 88, 96, 99 — `mysteadii.xyz` → `mysteadii.com`
- `tests/proxy-csrf.test.ts:9`: `const HOST = "mysteadii.xyz"` → `"mysteadii.com"`
- Re-run `pnpm test` after sweep to catch any snapshot changes that need accepting

### Fix 5 — Docs

- `README.md` — sweep `mysteadii.xyz` references
- `DEPLOY.md` — sweep all sections (env vars, OAuth callback URIs, webhook URLs, manual smoke steps)
- `AGENTS.md` § 1 (Project context) — `mysteadii.xyz` → `mysteadii.com`
- `.env.example` — sweep
- `docs/handoffs/*.md` — leave historical handoffs alone (they reference what was true at the time); only update if a doc has a forward-looking action that uses the wrong URL

### Fix 6 — i18n copy

Sweep `lib/i18n/translations/{en,ja}.ts` for any user-visible string mentioning the domain. Most copy refers to "Steadii" (brand) only; domain mentions are rare. Likely candidates: privacy policy section, terms section, contact address in support copy.

### Fix 7 — verify zero stragglers

After all fixes:

```
grep -rn "mysteadii\.xyz" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.json" --include="*.css" \
  | grep -v "node_modules\|.next\|.vercel"
```

Should return zero matches outside `docs/handoffs/` historical entries (those are intentionally frozen). Anything else: investigate before declaring done.

## Tests

- `pnpm typecheck` — clean
- `pnpm test` — green (snapshot updates expected on tests that included the domain in their fixtures; review each diff to ensure only the TLD changed, no behavior shift)
- Manual verify post-deploy:
  - `https://mysteadii.com` loads
  - `https://mysteadii.xyz` 308 redirects to `https://mysteadii.com`
  - Sign-in via Google + Microsoft works on the new domain (callbacks resolve correctly)
  - Outgoing email from agent / waitlist approval shows `agent@mysteadii.com` / `hello@mysteadii.com` sender (not the old `mysteadii.xyz`)

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Do NOT delete `mysteadii.xyz` references in **historical handoff docs** under `docs/handoffs/` — those are point-in-time records
- The brand identifier "Steadii" + the "mysteadii" domain prefix both stay unchanged — this is a TLD-only migration

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_steadii.md` line 9: `mysteadii.xyz` → `mysteadii.com`
- `project_decisions.md` — sweep for `mysteadii.xyz` (multiple references in α access control flow + invite URLs); update all
- `project_pre_launch_redesign.md` — sweep
- `project_steadii.md` add a new line under W-Integrations or as a separate bullet: "Domain migration shipped 2026-04-29 — `mysteadii.xyz` → `mysteadii.com`. Reason: `.xyz` TLD reputation at school-network filters (TLS MITM observed on Loblaw + likely on JP uni filters). `mysteadii.xyz` kept registered + 308 redirected indefinitely."

Plus standard report bits.

The next work units are: (a) finish Phase 1-5 ops checklist, (b) MS bidirectional sync (parallel engineer 6), (c) α invite send.
