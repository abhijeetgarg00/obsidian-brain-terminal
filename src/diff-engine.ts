export type DiffLine = {
  type: "added" | "removed" | "unchanged";
  oldLineNo: number | null;
  newLineNo: number | null;
  text: string;
};

export type DiffHunk = {
  oldStart: number;
  newStart: number;
  oldCount: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffResult = {
  hunks: DiffHunk[];
  addedCount: number;
  removedCount: number;
};

const MERGE_GAP = 3;
const OOM_GUARD = 25_000_000; // 5000×5000 = 200 MB

export function computeDiff(oldLines: string[], newLines: string[]): DiffResult {
  if (oldLines.length === 0 && newLines.length === 0) {
    return { hunks: [], addedCount: 0, removedCount: 0 };
  }

  // OOM guard — fall back to pure add/remove
  if ((oldLines.length + 1) * (newLines.length + 1) > OOM_GUARD) {
    const hunks = groupIntoHunks([
      ...oldLines.map((text, i): DiffLine => ({ type: "removed", oldLineNo: i + 1, newLineNo: null, text })),
      ...newLines.map((text, i): DiffLine => ({ type: "added", oldLineNo: null, newLineNo: i + 1, text })),
    ]);
    return { hunks, addedCount: newLines.length, removedCount: oldLines.length };
  }

  if (oldLines.length === 0) {
    const lines: DiffLine[] = newLines.map((text, i) => ({ type: "added", oldLineNo: null, newLineNo: i + 1, text }));
    return { hunks: groupIntoHunks(lines), addedCount: newLines.length, removedCount: 0 };
  }

  if (newLines.length === 0) {
    const lines: DiffLine[] = oldLines.map((text, i) => ({ type: "removed", oldLineNo: i + 1, newLineNo: null, text }));
    return { hunks: groupIntoHunks(lines), addedCount: 0, removedCount: oldLines.length };
  }

  // LCS DP table
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = oldLines[i - 1] === newLines[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack
  const allLines: DiffLine[] = [];
  let i = m, j = n;
  let oldNo = m, newNo = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      allLines.unshift({ type: "unchanged", oldLineNo: i, newLineNo: j, text: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      allLines.unshift({ type: "added", oldLineNo: null, newLineNo: j, text: newLines[j - 1] });
      j--;
    } else {
      allLines.unshift({ type: "removed", oldLineNo: i, newLineNo: null, text: oldLines[i - 1] });
      i--;
    }
  }

  let addedCount = 0, removedCount = 0;
  for (const l of allLines) {
    if (l.type === "added") addedCount++;
    else if (l.type === "removed") removedCount++;
  }

  return { hunks: groupIntoHunks(allLines), addedCount, removedCount };
}

export function groupIntoHunks(lines: DiffLine[]): DiffHunk[] {
  // Find changed line indices
  const changedIdx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].type !== "unchanged") changedIdx.push(i);
  }
  if (changedIdx.length === 0) return [];

  // Merge nearby changed regions
  const regions: Array<{ start: number; end: number }> = [];
  let start = changedIdx[0], end = changedIdx[0];

  for (let k = 1; k < changedIdx.length; k++) {
    if (changedIdx[k] - end <= MERGE_GAP) {
      end = changedIdx[k];
    } else {
      regions.push({ start, end });
      start = changedIdx[k];
      end = changedIdx[k];
    }
  }
  regions.push({ start, end });

  return regions.map(({ start, end }) => {
    const hunkLines = lines.slice(start, end + 1);
    const oldLines = hunkLines.filter(l => l.type !== "added");
    const newLines = hunkLines.filter(l => l.type !== "removed");
    const oldStart = oldLines.find(l => l.oldLineNo != null)?.oldLineNo ?? 1;
    const newStart = newLines.find(l => l.newLineNo != null)?.newLineNo ?? 1;
    return {
      oldStart,
      newStart,
      oldCount: oldLines.length,
      newCount: newLines.length,
      lines: hunkLines,
    };
  });
}
