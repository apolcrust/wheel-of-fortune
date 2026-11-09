import { describe, expect, it } from "vitest";
import { DEFAULT_DATA } from "./types";
import { validateData } from "./storage";

describe("validateData", () => {
  it("reports which data source contains invalid session data", () => {
    expect(() => validateData(null)).toThrow("The backup file does not contain valid session data.");
    expect(() => validateData(null, "saved browser session"))
      .toThrow("The saved browser session does not contain valid session data.");
    expect(() => validateData(null, "shared event"))
      .toThrow("The shared event does not contain valid session data.");
  });

  it("accepts valid session data from any source", () => {
    expect(validateData(structuredClone(DEFAULT_DATA), "shared event")).toEqual(DEFAULT_DATA);
  });
});
