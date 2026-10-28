import { describe, it, expect } from "vitest";
import { parseCsv, csvEscape, gridToImportRows, jsonToImportRows, CSV_TEMPLATE_HEADERS } from "../../src/core/services/importExport.js";

describe("parseCsv (RFC4180)", () => {
  it("parses simple rows", () => {
    expect(parseCsv("a,b,c\nd,e,f")).toEqual([["a", "b", "c"], ["d", "e", "f"]]);
  });

  it("keeps commas inside quotes", () => {
    expect(parseCsv('a,"b,x",c')).toEqual([["a", "b,x", "c"]]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsv('"say ""hi""",b')).toEqual([['say "hi"', "b"]]);
  });

  it("supports embedded newlines in quoted fields", () => {
    expect(parseCsv('"line1\nline2",b')).toEqual([["line1\nline2", "b"]]);
  });

  it("strips a UTF-8 BOM and CRLF endings", () => {
    expect(parseCsv("﻿a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("drops fully empty rows", () => {
    expect(parseCsv("a,b\n\n\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
  });
});

describe("csvEscape", () => {
  it("leaves plain values alone", () => {
    expect(csvEscape("vethra")).toBe("vethra");
  });
  it("quotes values containing commas, quotes or newlines", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape("a\nb")).toBe('"a\nb"');
  });
});

describe("gridToImportRows", () => {
  it("maps template headers directly", () => {
    const header = CSV_TEMPLATE_HEADERS.join(",");
    const { rows, headerErrors } = gridToImportRows(parseCsv(`${header}\nvethra,চুক্তি,agreement,,,noun,,,`));
    expect(headerErrors).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ word: "vethra", bengaliMeaning: "চুক্তি", englishMeaning: "agreement", partOfSpeech: "noun" });
  });

  it("accepts common header aliases including Bengali", () => {
    const { rows, headerErrors } = gridToImportRows(parseCsv("word,বাংলা,english,pos\nsolven,গোপনীয়,confidential,adjective"));
    expect(headerErrors).toEqual([]);
    expect(rows[0]).toMatchObject({ word: "solven", bengaliMeaning: "গোপনীয়", englishMeaning: "confidential", partOfSpeech: "adjective" });
  });

  it("rejects files without a word column", () => {
    const { rows, headerErrors } = gridToImportRows(parseCsv("bn,en\nচুক্তি,agreement"));
    expect(rows).toEqual([]);
    expect(headerErrors.join(" ")).toMatch(/word/i);
  });

  it("skips rows that fail validation (bad part of speech)", () => {
    const { rows } = gridToImportRows(parseCsv("word,partOfSpeech\nkairum,verb\nbadword,modal_verb"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.word).toBe("kairum");
  });
});

describe("jsonToImportRows", () => {
  it("accepts an array of word objects", () => {
    const { rows, headerErrors } = jsonToImportRows(JSON.stringify([{ word: "vethra", englishMeaning: "contract" }]));
    expect(headerErrors).toEqual([]);
    expect(rows[0]).toMatchObject({ word: "vethra", englishMeaning: "contract" });
  });

  it("accepts an {entries: [...]} wrapper", () => {
    const { rows } = jsonToImportRows(JSON.stringify({ entries: [{ word: "solven" }] }));
    expect(rows[0]?.word).toBe("solven");
  });

  it("rejects invalid JSON and wrong shapes", () => {
    expect(jsonToImportRows("{nope").headerErrors.join(" ")).toMatch(/JSON/i);
    expect(jsonToImportRows(JSON.stringify({ a: 1 })).headerErrors.join(" ")).toMatch(/array/i);
  });
});
