Demo assets for the landing hero.

Files expected here (Ryuto-supplied, see docs/handoffs/landing-redesign.md):

- hero.mp4 — H.264 fallback, ~3-5MB, 1280x800 or 1280x720, autoplay+muted+loop
- hero.webm — VP9 primary, ~3-5MB, same dimensions
- hero-poster.png — first-frame poster shown before video loads or when video
  is missing

Until those land, the <video> on / shows the browser default empty state. With
poster present, that becomes the static frame and visitors see no broken-asset
flash.
