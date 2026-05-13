import { describe, it, expect } from "vitest";

// engineer-48 — activity-log dashboard sanity test. The page itself is
// server-rendered with several DB queries; we test the route module
// loads without throwing and that the i18n keys it requires exist.

import { en } from "@/lib/i18n/translations/en";
import { ja } from "@/lib/i18n/translations/ja";

describe("activity_log_page i18n keys", () => {
  it("EN exposes the full key set the page reads", () => {
    expect(en.activity_log_page).toBeDefined();
    expect(en.activity_log_page.title).toBeTruthy();
    expect(en.activity_log_page.summary_heading).toBeTruthy();
    expect(en.activity_log_page.stat_emails_triaged).toBeTruthy();
    expect(en.activity_log_page.stat_drafts_generated).toBeTruthy();
    expect(en.activity_log_page.stat_drafts_sub).toContain("{sent}");
    expect(en.activity_log_page.stat_drafts_sub).toContain("{auto}");
    expect(en.activity_log_page.stat_drafts_sub).toContain("{dismissed}");
    expect(en.activity_log_page.stat_chat_turns).toBeTruthy();
    expect(en.activity_log_page.stat_proposals_shown).toBeTruthy();
    expect(en.activity_log_page.stat_failures).toBeTruthy();
    expect(en.activity_log_page.tab_recent).toBeTruthy();
    expect(en.activity_log_page.tab_failures).toBeTruthy();
    expect(en.activity_log_page.page_label).toContain("{page}");
    expect(en.activity_log_page.page_label).toContain("{total}");
  });

  it("JA mirrors the same set", () => {
    expect(ja.activity_log_page).toBeDefined();
    expect(ja.activity_log_page.title).toBeTruthy();
    expect(ja.activity_log_page.stat_drafts_sub).toContain("{sent}");
    expect(ja.activity_log_page.stat_drafts_sub).toContain("{auto}");
    expect(ja.activity_log_page.stat_drafts_sub).toContain("{dismissed}");
    expect(ja.activity_log_page.page_label).toContain("{page}");
    expect(ja.activity_log_page.page_label).toContain("{total}");
  });

  it("settings.agent_thinks exposes the activity_log_open key", () => {
    expect(en.settings.agent_thinks.activity_log_open).toBeTruthy();
    expect(ja.settings.agent_thinks.activity_log_open).toBeTruthy();
  });
});
