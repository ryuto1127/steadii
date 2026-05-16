import { describe, expect, it } from "vitest";
import { isAcademicEmail } from "@/lib/billing/academic-email";

describe("isAcademicEmail", () => {
  it("accepts .edu domains (US)", () => {
    expect(isAcademicEmail("student@stanford.edu")).toBe(true);
    expect(isAcademicEmail("a@mit.edu")).toBe(true);
    expect(isAcademicEmail("student@cs.stanford.edu")).toBe(true);
  });

  it("accepts .ac.<tld> patterns (UK, JP, etc.)", () => {
    expect(isAcademicEmail("student@cam.ac.uk")).toBe(true);
    expect(isAcademicEmail("student@u-tokyo.ac.jp")).toBe(true);
    expect(isAcademicEmail("student@auckland.ac.nz")).toBe(true);
  });

  it("accepts Canadian university domains from the allow-list", () => {
    expect(isAcademicEmail("r@utoronto.ca")).toBe(true);
    expect(isAcademicEmail("r@mail.utoronto.ca")).toBe(true);
    expect(isAcademicEmail("r@student.ubc.ca")).toBe(true);
    expect(isAcademicEmail("r@mcgill.ca")).toBe(true);
    expect(isAcademicEmail("r@sfu.ca")).toBe(true);
    expect(isAcademicEmail("r@uwaterloo.ca")).toBe(true);
  });

  it("rejects non-academic domains", () => {
    expect(isAcademicEmail("alex@example.com")).toBe(false);
    expect(isAcademicEmail("me@outlook.com")).toBe(false);
    expect(isAcademicEmail("random@business.ca")).toBe(false);
    expect(isAcademicEmail("bogus@edu.fake")).toBe(false);
  });

  it("rejects malformed and empty inputs", () => {
    expect(isAcademicEmail("")).toBe(false);
    expect(isAcademicEmail(null)).toBe(false);
    expect(isAcademicEmail(undefined)).toBe(false);
    expect(isAcademicEmail("nodomain")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isAcademicEmail("STUDENT@STANFORD.EDU")).toBe(true);
    expect(isAcademicEmail("R@UTORONTO.CA")).toBe(true);
  });
});
