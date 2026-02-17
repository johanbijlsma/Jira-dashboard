import { describe, expect, it } from "vitest";
import { parseNlDateToIso } from "./date";

describe("parseNlDateToIso", () => {
  it("converts dd/mm/yyyy", () => {
    expect(parseNlDateToIso("17/02/2026")).toBe("2026-02-17");
  });

  it("accepts dd-mm-yyyy", () => {
    expect(parseNlDateToIso("17-02-2026")).toBe("2026-02-17");
  });

  it("rejects invalid dates", () => {
    expect(parseNlDateToIso("31/02/2026")).toBe("");
    expect(parseNlDateToIso("abc")).toBe("");
  });
});
