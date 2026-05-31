export type OpenSignal = {
  path: string;
  line?: number;
  col?: number;
};

export function parseOpenSignal(raw: string, vaultRoot: string): OpenSignal | null {
  // Normalize slashes
  let s = raw.trim().replace(/\\/g, "/");

  // Strip vault-root prefix
  const root = vaultRoot.replace(/\\/g, "/").replace(/\/?$/, "/");
  if (s.startsWith(root)) s = s.slice(root.length);

  // Strip Windows drive letter (e.g. C:/)
  s = s.replace(/^[A-Za-z]:\//, "");

  if (!s) return null;

  // Two separate regexes — single greedy regex mis-parses path:42:5 as path:42 + 5
  const withLineCol = /^(.+):(\d+):(\d+)$/.exec(s);
  if (withLineCol) {
    const line = parseInt(withLineCol[2], 10);
    const col  = parseInt(withLineCol[3], 10);
    if (line > 0 && col > 0) {
      return { path: withLineCol[1], line, col };
    }
  }

  const withLine = /^(.+):(\d+)$/.exec(s);
  if (withLine) {
    const line = parseInt(withLine[2], 10);
    return line > 0
      ? { path: withLine[1], line }
      : { path: withLine[1] };
  }

  return { path: s };
}
