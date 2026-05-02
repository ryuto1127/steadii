import { describe, expect, it } from "vitest";
import { auditSource } from "@/scripts/i18n-audit";

// Pass a unique fake repo root so the relative-file rendering is stable
// regardless of where the test is invoked from.
const FAKE_ROOT = "/repo";
const audit = (source: string, file = "components/Foo.tsx") =>
  auditSource(source, `${FAKE_ROOT}/${file}`, FAKE_ROOT);

describe("i18n-audit", () => {
  describe("detection", () => {
    it("flags raw JSX text", () => {
      const findings = audit(`export const A = () => <div>Hello world</div>;`);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe("jsx-text");
      expect(findings[0]?.text).toBe("Hello world");
    });

    it("flags string literal as JSX child", () => {
      const findings = audit(
        `export const A = () => <div>{"Hello literal"}</div>;`
      );
      expect(findings).toHaveLength(1);
      expect(findings[0]?.kind).toBe("string-literal");
      expect(findings[0]?.text).toBe("Hello literal");
    });

    it("flags string literal in user-visible attributes", () => {
      const findings = audit(
        `export const A = () => <button aria-label="Send draft">x</button>;`
      );
      const aria = findings.find((f) => f.kind === "title-attribute");
      expect(aria?.text).toBe("Send draft");
    });

    it("flags placeholder, alt, title equally", () => {
      const findings = audit(
        `export const A = () => (<>
          <input placeholder="Type here" />
          <img alt="Profile picture" />
          <button title="Submit form">x</button>
        </>);`
      );
      const kinds = findings
        .filter((f) => f.kind === "title-attribute")
        .map((f) => f.text)
        .sort();
      expect(kinds).toEqual(["Profile picture", "Submit form", "Type here"]);
    });

    it("does NOT flag t() call output as a finding", () => {
      const findings = audit(
        `export const A = () => <div>{t("greeting")}</div>;`
      );
      expect(findings).toHaveLength(0);
    });

    it("does NOT flag aria-label={t(...)} call output", () => {
      const findings = audit(
        `export const A = () => <button aria-label={t("send")}>x</button>;`
      );
      // 'x' is a single-letter (lowercase), filtered as identifier-shaped
      expect(findings).toHaveLength(0);
    });

    it("captures line and column 1-indexed", () => {
      const findings = audit(`\nexport const A = () => <div>Hi</div>;`);
      expect(findings[0]?.line).toBe(2);
      expect(findings[0]?.column).toBeGreaterThan(0);
    });
  });

  describe("whitelist", () => {
    it("skips the brand name 'Steadii'", () => {
      const findings = audit(`export const A = () => <h1>Steadii</h1>;`);
      expect(findings).toHaveLength(0);
    });

    it("skips pure punctuation/symbols", () => {
      const findings = audit(
        `export const A = () => (<>
          <span>·</span>
          <span>—</span>
          <span>⌘</span>
          <span>:</span>
          <span>/</span>
        </>);`
      );
      expect(findings).toHaveLength(0);
    });

    it("skips JSX text reduced to entities only", () => {
      const findings = audit(
        `export const A = () => <span>&ldquo;{name}&rdquo;</span>;`
      );
      expect(findings).toHaveLength(0);
    });

    it("skips short identifier-shaped strings", () => {
      // "save", "submit", "click_here" all match lowercase identifier shape
      const findings = audit(
        `export const A = () => (<>
          <span>save</span>
          <span>submit</span>
          <span>click_here</span>
        </>);`
      );
      expect(findings).toHaveLength(0);
    });

    it("skips non-visible attributes (className, id, key, href, etc.)", () => {
      const findings = audit(
        `export const A = () => (<>
          <div className="flex flex-col gap-4" />
          <div id="my-element" />
          <a href="/path/to/page" />
          <input name="email" type="email" />
        </>);`
      );
      expect(findings).toHaveLength(0);
    });

    it("does NOT skip user-visible attribute with descriptive copy", () => {
      const findings = audit(
        `export const A = () => <button aria-label="Send draft">x</button>;`
      );
      expect(findings.map((f) => f.text)).toContain("Send draft");
    });

    it("skips identifier-shaped attribute values", () => {
      const findings = audit(
        `export const A = () => <button aria-label="logo">x</button>;`
      );
      expect(findings).toHaveLength(0);
    });
  });

  describe("output", () => {
    it("returns empty array when no findings", () => {
      const findings = audit(
        `export const A = () => <div className="x">{t("ok")}</div>;`
      );
      expect(findings).toEqual([]);
    });

    it("returns serializable JSON shape", () => {
      const findings = audit(`export const A = () => <p>Hello</p>;`);
      const json = JSON.parse(JSON.stringify(findings));
      expect(json[0]).toMatchObject({
        file: "components/Foo.tsx",
        line: expect.any(Number),
        column: expect.any(Number),
        kind: "jsx-text",
        text: "Hello",
        context: expect.any(String),
      });
    });
  });
});
