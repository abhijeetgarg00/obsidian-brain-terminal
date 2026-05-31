import { describe, it, expect } from "vitest";
import { parseOpenSignal } from "../parse-open-signal";

const VAULT = "/home/user/vault";

describe("parseOpenSignal", () => {
  it("plain path", () => {
    expect(parseOpenSignal("notes/foo.md", VAULT)).toEqual({ path: "notes/foo.md" });
  });

  it("path with line", () => {
    expect(parseOpenSignal("notes/foo.md:42", VAULT)).toEqual({ path: "notes/foo.md", line: 42 });
  });

  it("path with line and col", () => {
    expect(parseOpenSignal("notes/foo.md:42:5", VAULT)).toEqual({ path: "notes/foo.md", line: 42, col: 5 });
  });

  it("strips vault-root prefix", () => {
    expect(parseOpenSignal("/home/user/vault/notes/foo.md", VAULT)).toEqual({ path: "notes/foo.md" });
  });

  it("strips Windows drive letter", () => {
    expect(parseOpenSignal("C:/Users/x/vault/notes/foo.md", "C:/Users/x/vault")).toEqual({ path: "notes/foo.md" });
  });

  it("backslashes normalized", () => {
    expect(parseOpenSignal("notes\\foo.md", VAULT)).toEqual({ path: "notes/foo.md" });
  });

  it("path with backslash line col", () => {
    expect(parseOpenSignal("notes\\foo.md:10:3", VAULT)).toEqual({ path: "notes/foo.md", line: 10, col: 3 });
  });

  it("invalid line number ignored", () => {
    expect(parseOpenSignal("notes/foo.md:0", VAULT)).toEqual({ path: "notes/foo.md" });
  });

  it("empty string returns null", () => {
    expect(parseOpenSignal("", VAULT)).toBeNull();
  });

  it("colons in filename treated as path-only when no valid number", () => {
    const r = parseOpenSignal("notes/my:note.md", VAULT);
    expect(r).not.toBeNull();
  });
});
