import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { startFixtureFarm, type FixtureFarm, FIXTURES } from "@browser-bridge/fixture-farm";
import { pageExtractor } from "./extractor.js";
import type { ExtractOptions, RawView } from "./types.js";

/**
 * Regression coverage for the content-extraction defect: `extractor.ts` built content
 * blocks from a hardcoded tag allowlist that never mentioned `table`, so ALL table
 * content was dropped silently — success returned, answer missing. Live-confirmed on
 * Wikipedia (a 50-row data table and five infoboxes, 0% captured).
 *
 * Two of the three bugs covered here were found ONLY by running against the real
 * Wikipedia markup after the first fix; the original fixtures had no spanned cells and
 * no multi-value cells, so they passed while the live page was still wrong. That is why
 * the fixture now carries both shapes.
 */

let farm: FixtureFarm;
let browser: Browser;

const opts = (scope: ExtractOptions["scope"], refPrefix = "c-"): ExtractOptions => ({ scope, refPrefix });

async function extract(page: Page, o: ExtractOptions): Promise<RawView> {
  return page.evaluate(pageExtractor, o);
}

async function tableBlocks(page: Page): Promise<string[]> {
  const raw = await extract(page, opts({ kind: "full" }));
  return (raw.content ?? []).filter((b) => b.kind === "table").map((b) => b.text);
}

beforeAll(async () => {
  farm = await startFixtureFarm();
  browser = await chromium.launch();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await farm?.close();
});

describe("content blocks — tables", () => {
  it("emits one self-describing block per row, labelled by column header", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const blocks = await tableBlocks(page);

    expect(blocks).toContain("Caption: Population by state (sample)");
    expect(blocks).toContain("Columns: State | Capital | Population");
    expect(blocks).toContain("State: Oregon | Capital: Salem | Population: 4,237,256");
    expect(blocks).toContain("State: Washington | Capital: Olympia | Population: 7,738,692");
    await page.close();
  }, 30_000);

  it("serializes a header-less two-column table as key/value (infobox shape)", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const blocks = await tableBlocks(page);

    expect(blocks).toContain("Caption: Seattle");
    expect(blocks).toContain("Founded: 1851");
    expect(blocks).toContain("Population: 737,015");
    expect(blocks).toContain("Elevation: 175 ft");
    await page.close();
  }, 30_000);

  it("repeats a rowspan'd value into the rows it covers, keeping every label aligned", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const blocks = await tableBlocks(page);

    expect(blocks).toContain("Rank: 1 | Name: Amazon | Region: United States | Ref: [5]");
    // The bug: this row previously read "Region: [6]" with Ref dropped entirely, because
    // the spanned row has 3 <td>s against 4 headers and zipping by row-index shifts.
    expect(blocks).toContain("Rank: 2 | Name: Walmart | Region: United States | Ref: [6]");
    expect(blocks).toContain("Rank: 3 | Name: State Grid | Region: China | Ref: [7]");
    await page.close();
  }, 30_000);

  it("emits a colspan'd cell once, labelled by the first column it covers", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const blocks = await tableBlocks(page);

    expect(blocks).toContain("Rank: Subtotal | Region: Mixed | Ref: [8]");
    await page.close();
  }, 30_000);

  it("separates list items and <br> runs inside a single cell", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const blocks = await tableBlocks(page);

    // Was "Steve JobsSteve WozniakRonald Wayne" — three names fused into one string.
    expect(blocks).toContain("Founders: Steve Jobs, Steve Wozniak, Ronald Wayne");
    expect(blocks).toContain("Offices: Cupertino, Austin, Cork");
    await page.close();
  }, 30_000);

  it("emits cell text exactly once when a cell wraps its content in a block element", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const raw = await extract(page, opts({ kind: "full" }));
    const all = (raw.content ?? []).map((b) => b.text);
    const hits = all.filter((t) => t.includes("Wrapped paragraph inside cell"));

    // The <td><p> must produce the table block only — never also a paragraph block.
    expect(hits).toEqual(["Note: Wrapped paragraph inside cell"]);
    await page.close();
  }, 30_000);
});

describe("content blocks — other previously-dropped shapes", () => {
  it("pairs definition-list terms with their definitions", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const raw = await extract(page, opts({ kind: "full" }));
    const lists = (raw.content ?? []).filter((b) => b.kind === "list").map((b) => b.text);

    expect(lists).toContain("Grant: A scoped authorization bound to a session.");
    // Two <dt> sharing one <dd> are joined rather than emitted context-free.
    expect(lists).toContain("Capability, Confirmation: A single-use daemon-authored approval.");
    await page.close();
  }, 30_000);

  it("surfaces figcaption, which the allowlist dropped for the same reason as tables", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const raw = await extract(page, opts({ kind: "full" }));
    const texts = (raw.content ?? []).map((b) => b.text);

    expect(texts.some((t) => t.startsWith("Figure 1."))).toBe(true);
    await page.close();
  }, 30_000);

  it("still extracts ordinary prose either side of the table", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const raw = await extract(page, opts({ kind: "full" }));
    const paras = (raw.content ?? []).filter((b) => b.kind === "paragraph").map((b) => b.text);

    expect(paras).toContain("Prose before the table. This paragraph must still be extracted.");
    expect(paras).toContain("Prose after the table, also required.");
    await page.close();
  }, 30_000);

  it("reports table content under `content` scope too, not only `full`", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists);
    const raw = await extract(page, opts({ kind: "content" }));
    const blocks = (raw.content ?? []).filter((b) => b.kind === "table").map((b) => b.text);

    // bridge_run_pattern harvests via `content` scope, so this is the path that made
    // the defect show up in bulk harvesting as well as single-page reads.
    expect(blocks).toContain("Founded: 1851");
    await page.close();
  }, 30_000);
});

describe("content blocks — landmark scoping", () => {
  /**
   * The protocol has advertised `region: {kind:"main"}` and `{kind:"article"}` since M1
   * and NOTHING implemented them: the region was dropped on the way to the extractor and
   * the caller got the whole <body> back, with a success status and no signal that the
   * narrowing they asked for had been ignored. Measured on a live Wikipedia article, an
   * unscoped read returns ~4x the bytes of the content actually requested.
   */
  it("roots a main-scoped read at <main>, excluding nav, header and footer", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.landmarks);
    const raw = await extract(page, opts({ kind: "content", landmark: "main" }));
    const texts = (raw.content ?? []).map((b) => b.text);

    expect(texts).toContain("Body paragraph that belongs to the main content.");
    expect(texts.some((t) => t.includes("Nav link one"))).toBe(false);
    expect(texts.some((t) => t.includes("Footer boilerplate"))).toBe(false);
    expect(texts.some((t) => t.includes("Site header boilerplate"))).toBe(false);
    await page.close();
  }, 30_000);

  it("still reads structured content inside the landmark", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.landmarks);
    const raw = await extract(page, opts({ kind: "content", landmark: "main" }));
    const tables = (raw.content ?? []).filter((b) => b.kind === "table").map((b) => b.text);

    expect(tables).toContain("Item: Alpha | Value: 1");
    await page.close();
  }, 30_000);

  it("roots an article-scoped read at <article>", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.landmarks);
    const raw = await extract(page, opts({ kind: "content", landmark: "article" }));
    const texts = (raw.content ?? []).map((b) => b.text);

    expect(texts).toContain("Article-scoped paragraph.");
    expect(texts.some((t) => t.includes("Body paragraph"))).toBe(false);
    await page.close();
  }, 30_000);

  it("falls back to the whole body when the page has no such landmark", async () => {
    const page = await browser.newPage();
    await page.goto(farm.url + FIXTURES.tablesAndLists); // no <main>
    const raw = await extract(page, opts({ kind: "content", landmark: "main" }));

    // Returning nothing because a landmark is absent would be the same silent-omission
    // failure in a new costume.
    expect((raw.content ?? []).length).toBeGreaterThan(0);
    await page.close();
  }, 30_000);
});
