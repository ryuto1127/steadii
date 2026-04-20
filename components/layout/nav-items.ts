// Plain-module constants shared between the server Sidebar shell and the
// client SidebarNav. Keeping them out of the "use client" module avoids the
// Next.js client-reference proxy, which wraps non-function exports in a way
// that makes them non-iterable from a server component.

export const NAV_ITEM_KEYS = [
  "chat",
  "calendar",
  "mistakes",
  "syllabus",
  "assignments",
  "resources",
  "settings",
] as const;

export type NavItemKey = (typeof NAV_ITEM_KEYS)[number];

// Lucide icons share viewBox="0 0 24 24" but the painted content has
// inconsistent left margins: Calendar/BookOpen/CheckSquare draw their body
// at x=3, FileText/MessageCircle at x=4, while FolderOpen and Settings draw
// their body flush at x=2. At size=16 that puts the latter two ~1 px
// further left than the rest. Wrapper CSS can't fix this (the SVG bbox IS
// centered — it's the paint within that's shifted). We nudge the two
// outliers right by 1 px so the strokes visually align.
export const ICON_OFFSET_PX: Record<string, number> = {
  resources: 1, // FolderOpen body at x=2
  settings: 1,  // Settings gear's leftmost spoke at x=2
};
