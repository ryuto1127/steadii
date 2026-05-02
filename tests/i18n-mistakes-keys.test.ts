import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/translations/en";
import { ja } from "@/lib/i18n/translations/ja";

const REQUIRED_KEYS = [
  "add_from_photo",
  "photo_upload_modal_title",
  "photo_upload_modal_subtitle",
  "photo_choose_file",
  "photo_supported_formats",
  "photo_extracting",
  "photo_preview_label",
  "photo_title_placeholder",
  "photo_save_button",
  "photo_cancel",
  "photo_extract_failed",
  "photo_save_failed",
] as const;

describe("mistakes i18n namespace", () => {
  it("exposes every photo-upload key in English", () => {
    for (const key of REQUIRED_KEYS) {
      const value = en.mistakes[key];
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it("exposes the same key set in Japanese", () => {
    for (const key of REQUIRED_KEYS) {
      const value = ja.mistakes[key];
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  // Per-brief (Wave 1 secretary-pivot 2026-05-01): rebrand mistake-notes
  // UI as "Steadii's notes about you / weak-area context for drafts" —
  // explicitly NOT a study aid. The button + modal title strings below
  // are the canonical user-facing framing; if you need to change them,
  // update both this lock and docs/handoffs/wave-1-secretary-pivot-foundation.md.
  it("matches the exact JA + EN strings the Wave 1 brief locked in", () => {
    expect(en.mistakes.add_from_photo).toBe("📷 Add from photo");
    expect(ja.mistakes.add_from_photo).toBe("📷 写真から追加");
    expect(en.mistakes.photo_upload_modal_title).toBe("Add to Steadii's notes");
    expect(ja.mistakes.photo_upload_modal_title).toBe("Steadii のメモに追加");
    expect(en.mistakes.photo_supported_formats).toBe("PDF, PNG, JPEG, GIF, WebP");
    expect(ja.mistakes.photo_supported_formats).toBe(
      "PDF・PNG・JPEG・GIF・WebP に対応"
    );
  });
});
