import { describe, it, expect } from "vitest";
import { computeDiff } from "../diff-engine";

describe("computeDiff", () => {
  it("empty inputs", () => {
    const r = computeDiff([], []);
    expect(r.hunks).toHaveLength(0);
    expect(r.addedCount).toBe(0);
    expect(r.removedCount).toBe(0);
  });

  it("pure add", () => {
    const r = computeDiff([], ["a", "b"]);
    expect(r.addedCount).toBe(2);
    expect(r.removedCount).toBe(0);
    expect(r.hunks[0].lines.every(l => l.type === "added")).toBe(true);
  });

  it("pure remove", () => {
    const r = computeDiff(["a", "b"], []);
    expect(r.addedCount).toBe(0);
    expect(r.removedCount).toBe(2);
    expect(r.hunks[0].lines.every(l => l.type === "removed")).toBe(true);
  });

  it("identical content — no hunks", () => {
    const lines = ["hello", "world"];
    const r = computeDiff(lines, lines);
    expect(r.hunks).toHaveLength(0);
    expect(r.addedCount).toBe(0);
    expect(r.removedCount).toBe(0);
  });

  it("single line change", () => {
    const r = computeDiff(["hello", "world"], ["hello", "earth"]);
    expect(r.addedCount).toBe(1);
    expect(r.removedCount).toBe(1);
  });

  it("mixed add and remove", () => {
    const old = ["a", "b", "c"];
    const nw = ["a", "x", "c"];
    const r = computeDiff(old, nw);
    expect(r.addedCount).toBe(1);
    expect(r.removedCount).toBe(1);
  });

  it("hunk merging — nearby changes merge into one hunk", () => {
    const old = ["1", "2", "3", "4", "5"];
    const nw  = ["1", "X", "3", "X", "5"];
    const r = computeDiff(old, nw);
    expect(r.hunks).toHaveLength(1);
  });

  it("hunk merging — distant changes stay separate", () => {
    const old = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
    const nw  = ["1", "X", "3", "4", "5", "6", "7", "8", "X", "10"];
    const r = computeDiff(old, nw);
    expect(r.hunks).toHaveLength(2);
  });

  it("line numbers are correct", () => {
    const r = computeDiff(["a", "b"], ["a", "c"]);
    const removed = r.hunks[0].lines.find(l => l.type === "removed");
    const added   = r.hunks[0].lines.find(l => l.type === "added");
    expect(removed?.oldLineNo).toBe(2);
    expect(added?.newLineNo).toBe(2);
  });
});
