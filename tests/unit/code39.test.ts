import { describe, expect, it } from "vitest";

import {
  CODE39_ALPHABET,
  CODE39_PATTERNS,
  canEncodeCode39,
  code39Refusal,
  code39Svg,
  encodeCode39,
} from "@/lib/services/code39";

/**
 * The pattern table is transcribed, so it is pinned by the properties the
 * real Code 39 table has rather than trusted. A transcription slip breaks at
 * least one of them, and the distinctness check breaks on almost any of them.
 */
describe("the pattern table", () => {
  it("gives every character nine elements", () => {
    for (const [character, pattern] of Object.entries(CODE39_PATTERNS)) {
      expect(pattern.length, `${character} is not nine elements`).toBe(9);
    }
  });

  it("makes exactly three of the nine wide, which is the symbology's rule", () => {
    for (const [character, pattern] of Object.entries(CODE39_PATTERNS)) {
      const wide = [...pattern].filter((element) => element === "w").length;
      expect(wide, `${character} has ${wide} wide elements`).toBe(3);
    }
  });

  it("uses only narrow and wide", () => {
    for (const pattern of Object.values(CODE39_PATTERNS)) {
      expect(/^[nw]{9}$/.test(pattern)).toBe(true);
    }
  });

  it("keeps all forty-four distinct, so no two characters scan alike", () => {
    const patterns = Object.values(CODE39_PATTERNS);
    expect(new Set(patterns).size).toBe(patterns.length);
    expect(patterns).toHaveLength(44);
  });

  it("covers the alphabet a station barcode can hold", () => {
    for (const character of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-.") {
      expect(CODE39_ALPHABET, `${character} is missing`).toContain(character);
    }
  });
});

describe("encoding a station barcode", () => {
  it("frames the value with the start and stop character", () => {
    const elements = encodeCode39("TRAP-01");
    // 9 characters (start + 7 + stop) of 9 elements, with 8 gaps between.
    expect(elements).toHaveLength(9 * 9 + 8);
  });

  it("alternates bar and space within each character, starting on a bar", () => {
    const elements = encodeCode39("A1") ?? [];
    // Characters occupy 10-element strides: 9 elements then one gap.
    for (let index = 0; index < elements.length; index += 1) {
      const withinCharacter = index % 10;
      if (withinCharacter === 9) {
        expect(elements[index]).toEqual({ wide: false, bar: false });
      } else {
        expect(elements[index].bar).toBe(withinCharacter % 2 === 0);
      }
    }
  });

  it("draws only the bars, and leaves a quiet zone at both ends", () => {
    const symbol = code39Svg("TRAP-01", { narrow: 2, height: 40 });

    expect(symbol).not.toBeNull();
    expect(symbol?.height).toBe(40);
    // Every drawn run is a bar; the first starts after the quiet zone.
    expect(symbol?.path.startsWith("M20 0h")).toBe(true);
    expect((symbol?.path.match(/M/g) ?? []).length).toBeGreaterThan(10);
  });
});

describe("what it refuses to print, and why", () => {
  it("will not uppercase a barcode to make it fit", () => {
    // crm_devices_org_barcode_key is case-sensitive: trap-01 and TRAP-01 are
    // two different stations, so an uppercased symbol would scan as the
    // wrong one — on a regulated site, into a compliance record.
    expect(canEncodeCode39("trap-01")).toBe(false);
    expect(encodeCode39("trap-01")).toBeNull();
    expect(code39Svg("trap-01")).toBeNull();
    expect(code39Refusal("trap-01")).toMatch(/case-sensitive/);
    expect(code39Refusal("trap-01")).toMatch(/scan as a different station/);
  });

  it("names the character it cannot encode when it is not a case problem", () => {
    expect(canEncodeCode39("TRAP_01")).toBe(false);
    expect(code39Refusal("TRAP_01")).toMatch(/cannot encode "_"/);
  });

  it("refuses the delimiter itself, which would end the symbol early", () => {
    expect(canEncodeCode39("TR*AP")).toBe(false);
  });

  it("says so plainly when there is no barcode at all", () => {
    expect(code39Refusal("")).toMatch(/no barcode/);
  });

  it("accepts the shapes a station barcode actually takes", () => {
    for (const barcode of ["TRAP-01", "ST.12", "BAIT0042", "A-1.B-2"]) {
      expect(canEncodeCode39(barcode), barcode).toBe(true);
      expect(code39Svg(barcode)).not.toBeNull();
    }
  });
});
