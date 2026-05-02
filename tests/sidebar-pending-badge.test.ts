import { describe, expect, it, vi } from "vitest";

// Next.js client hooks need shimming in vitest's node env. SidebarNav
// only reads usePathname() to compute active state — return /app so
// every nav item is inactive (we're testing the badge, not active
// styling). useRouter is unused on render. next/link → plain <a>.
vi.mock("next/navigation", () => ({
  usePathname: () => "/app",
  useRouter: () => ({ push: () => {} }),
}));

vi.mock("next/link", () => {
  // The mocked Link forwards href + children + data-attrs as a plain
  // anchor so renderToStaticMarkup emits `data-pending-count` etc.
  const React = require("react") as typeof import("react");
  return {
    default: ({
      children,
      href,
      ...rest
    }: {
      children?: unknown;
      href: string;
    } & Record<string, unknown>) =>
      React.createElement("a", { href, ...rest }, children as never),
  };
});

import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { en } from "@/lib/i18n/translations/en";

const LABELS = {
  inbox: "Inbox",
  home: "Home",
  chats: "Chats",
  classes: "Classes",
  calendar: "Calendar",
  tasks: "Tasks",
};

// Wrap SidebarNav in NextIntlClientProvider so the useTranslations call
// in primary_nav.aria_label resolves. Tests don't care which locale —
// pass `en` and force locale=en.
function renderSidebar(props: Parameters<typeof SidebarNav>[0]): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: "en",
      messages: en as unknown as Record<string, unknown>,
      children: createElement(SidebarNav, props),
    })
  );
}

describe("SidebarNav — pending Inbox badge", () => {
  it("renders no badge when the inbox count is zero", () => {
    const html = renderSidebar({ labels: LABELS, badges: { inbox: 0 } });
    expect(html).not.toContain("data-nav-badge-count");
    expect(html).not.toContain("data-nav-badge-dot");
    expect(html).not.toContain("data-pending-count");
  });

  it("renders the count pill and the collapsed-state dot when count > 0", () => {
    const html = renderSidebar({ labels: LABELS, badges: { inbox: 3 } });
    expect(html).toContain("data-nav-badge-count");
    expect(html).toContain("data-nav-badge-dot");
    expect(html).toContain('data-pending-count="3"');
    expect(html).toContain('aria-label="3 pending"');
    // Title attribute should announce the pending state for screen
    // readers + tooltip users.
    expect(html).toContain("(3 pending)");
  });

  it("clamps the badge label at 99+ to keep the pill from blowing up", () => {
    const html = renderSidebar({ labels: LABELS, badges: { inbox: 137 } });
    expect(html).toContain("99+");
    expect(html).not.toContain(">137<");
  });

  it("only attaches the badge to the inbox item, not other nav items", () => {
    const html = renderSidebar({ labels: LABELS, badges: { inbox: 2 } });
    // Exactly one badge dot + one count pill — both anchored to Inbox.
    const dotMatches = html.match(/data-nav-badge-dot/g) ?? [];
    const countMatches = html.match(/data-nav-badge-count/g) ?? [];
    expect(dotMatches).toHaveLength(1);
    expect(countMatches).toHaveLength(1);
  });

  it("treats an undefined badges prop the same as zero", () => {
    const html = renderSidebar({ labels: LABELS });
    expect(html).not.toContain("data-nav-badge-count");
  });
});
