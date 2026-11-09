import { describe, expect, it } from "vitest";
import { DEFAULT_DATA } from "./types";
import { validateData } from "./storage";

describe("validateData", () => {
  it("reports which data source contains invalid session data", () => {
    expect(() => validateData(null)).toThrow("The backup file has no session data (stored value: null).");
    expect(() => validateData(null, "saved browser session"))
      .toThrow("The saved browser session has no session data (stored value: null).");
    expect(() => validateData(null, "shared event"))
      .toThrow("The shared event has no session data (stored value: null).");
  });

  it("accepts valid session data from any source", () => {
    expect(validateData(structuredClone(DEFAULT_DATA), "shared event")).toEqual(DEFAULT_DATA);
  });

  it("accepts JSON-encoded session data from a shared event", () => {
    expect(validateData(JSON.stringify(DEFAULT_DATA), "shared event")).toEqual(DEFAULT_DATA);
  });

  it("reports malformed JSON session data by source", () => {
    expect(() => validateData("{", "shared event"))
      .toThrow("The shared event contains malformed JSON session data.");
  });
});
