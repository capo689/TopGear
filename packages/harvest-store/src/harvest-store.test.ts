import { describe, it, expect } from "vitest";
import { InMemoryHarvestStore } from "./index.js";

describe("InMemoryHarvestStore", () => {
  it("dedupes by url + content hash", () => {
    const store = new InMemoryHarvestStore();
    expect(store.add({ url: "https://x/1", text: "hello world", harvestedAt: 1 }).added).toBe(true);
    expect(store.add({ url: "https://x/1", text: "hello world", harvestedAt: 2 }).deduped).toBe(true);
    // Same url, different content → not a dedupe.
    expect(store.add({ url: "https://x/1", text: "different", harvestedAt: 3 }).added).toBe(true);
    expect(store.count()).toBe(2);
  });

  it("ranks full-text search by term frequency", () => {
    const store = new InMemoryHarvestStore();
    store.add({ url: "https://x/a", text: "widget widget widget and gears", harvestedAt: 1, title: "A" });
    store.add({ url: "https://x/b", text: "one widget here", harvestedAt: 2, title: "B" });
    store.add({ url: "https://x/c", text: "no match", harvestedAt: 3, title: "C" });
    const results = store.search("widget");
    expect(results[0]?.record.url).toBe("https://x/a");
    expect(results).toHaveLength(2); // c does not match
  });

  it("exports the corpus in bounded chunks", () => {
    const store = new InMemoryHarvestStore();
    for (let i = 0; i < 50; i++) store.add({ url: `https://x/${i}`, text: `page ${i}`, harvestedAt: i });
    const chunks = store.exportChunks(20);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(20);
    expect(chunks[2]).toHaveLength(10);
  });
});
