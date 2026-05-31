import { StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { DiffResult } from "./diff-engine";

export const setDiffEffect = StateEffect.define<DiffResult | null>();

class DeletedLineWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "brain-diff-removed-line";
    el.textContent = this.text;
    return el;
  }

  eq(other: DeletedLineWidget): boolean {
    return this.text === other.text;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(state: EditorState, diff: DiffResult): DecorationSet {
  const ranges: Range<Decoration>[] = [];

  for (const hunk of diff.hunks) {
    let pendingRemoved: string[] = [];

    for (const line of hunk.lines) {
      if (line.type === "removed") {
        pendingRemoved.push(line.text);
        continue;
      }

      // Flush pending removed widgets before this added/unchanged line
      if (pendingRemoved.length > 0 && line.newLineNo != null) {
        const targetLineNo = line.newLineNo;
        if (targetLineNo >= 1 && targetLineNo <= state.doc.lines) {
          const pos = state.doc.line(targetLineNo).from;
          for (const text of pendingRemoved) {
            ranges.push(
              Decoration.widget({
                widget: new DeletedLineWidget(text),
                block: true,
                side: -1,
              }).range(pos)
            );
          }
        }
        pendingRemoved = [];
      }

      // Mark added lines green
      if (line.type === "added" && line.newLineNo != null) {
        const n = line.newLineNo;
        if (n >= 1 && n <= state.doc.lines) {
          ranges.push(
            Decoration.line({ class: "brain-diff-added" }).range(
              state.doc.line(n).from
            )
          );
        }
      }
    }

    // Trailing removed lines (pure-deletion hunk) — attach at hunk start or end of doc
    if (pendingRemoved.length > 0) {
      const targetLineNo = hunk.newStart;
      if (targetLineNo >= 1 && targetLineNo <= state.doc.lines) {
        const pos = state.doc.line(targetLineNo).from;
        for (const text of pendingRemoved) {
          ranges.push(
            Decoration.widget({
              widget: new DeletedLineWidget(text),
              block: true,
              side: -1,
            }).range(pos)
          );
        }
      } else {
        for (const text of pendingRemoved) {
          ranges.push(
            Decoration.widget({
              widget: new DeletedLineWidget(text),
              block: true,
              side: 1,
            }).range(state.doc.length)
          );
        }
      }
    }
  }

  ranges.sort((a, b) => a.from !== b.from ? a.from - b.from : a.startSide - b.startSide);
  return Decoration.set(ranges, true);
}

export const diffStateField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },

  update(decorations, tr) {
    // Map existing decorations through document changes first
    decorations = decorations.map(tr.changes);

    for (const effect of tr.effects) {
      if (effect.is(setDiffEffect)) {
        decorations = effect.value == null
          ? Decoration.none
          : buildDecorations(tr.state, effect.value);
      }
    }

    return decorations;
  },

  provide(field) {
    return EditorView.decorations.from(field);
  },
});

export const diffExtension = [diffStateField];
