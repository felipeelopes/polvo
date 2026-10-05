import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileChange } from "../src/git/api";
import type { FileDiff } from "../src/git/diff";

vi.mock("../src/core/ipc", () => ({ ipc: { fileRead: vi.fn() } }));
vi.mock("../src/core/store", () => ({ store: {}, normPath: (path: string) => path.toLowerCase() }));
vi.mock("../src/i18n", () => ({ t: (key: string) => key, tn: (key: string) => key }));
vi.mock("../src/ui/dom", () => ({ h: vi.fn(), esc: (s: string) => s, ago: vi.fn() }));
vi.mock("../src/ui/feedback", () => ({ toast: vi.fn(), popover: vi.fn(), closePopover: vi.fn() }));
vi.mock("../src/git/api", () => ({ git: { diff: vi.fn() } }));

import { ChangesPane } from "../src/git/changes";
import { git } from "../src/git/api";
import { ipc } from "../src/core/ipc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

const diff = (text: string) => `diff --git a/shared.txt b/shared.txt\n--- a/shared.txt\n+++ b/shared.txt\n@@ -1 +1 @@\n-old\n+${text}\n`;
const file: FileChange = { path: "shared.txt", orig: null, x: ".", y: "M", untracked: false, conflict: false };

function harness() {
  // Exercise the actual async diff logic with only its rendering boundary replaced.
  const view = () => ({ selection: new Set<string>(), set: vi.fn(), el: { classList: { add: vi.fn(), remove: vi.fn() } } });
  const fields = {
    ctx: { repo: "repo-a", status: { files: [file] } },
    selected: file.path as string | null,
    stashSel: null,
    diffRequest: 0,
    context: 3,
    ws: false,
    raw: { u: "", s: "" },
    files: { u: null as FileDiff | null, s: null as FileDiff | null },
    known: new Set<string>(),
    marked: new Set<string>(),
    anchor: null,
    dScroll: { innerHTML: "", append: vi.fn(), querySelector: vi.fn() },
    dHead: { innerHTML: "" },
    selBar: { hidden: true },
    uView: view(), sView: view(),
    renderDiffHead: vi.fn(), onSelection: vi.fn(), loadDraft: vi.fn(), renderNext: vi.fn(),
  };
  return Object.assign(Object.create(ChangesPane.prototype) as {
    loadDiff(force: boolean): Promise<void>; reset(): void;
  }, fields);
}

describe("async Git diffs", () => {
  beforeEach(() => vi.resetAllMocks());

  it("keeps the new repository's diff when both repositories have the same filename", async () => {
    const pane = harness();
    const old = deferred<string>();
    vi.mocked(git.diff).mockReturnValueOnce(old.promise).mockResolvedValueOnce(diff("repo-b"));
    const first = pane.loadDiff(true);
    pane.ctx.repo = "repo-b";
    pane.reset();
    pane.selected = file.path;
    await pane.loadDiff(true);
    old.resolve(diff("repo-a"));
    await first;

    expect(pane.raw.u).toBe(diff("repo-b"));
    expect(pane.uView.set).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest content when requests for the same file complete out of order", async () => {
    const pane = harness();
    const old = deferred<string>();
    vi.mocked(git.diff).mockReturnValueOnce(old.promise).mockResolvedValueOnce(diff("newest"));
    const first = pane.loadDiff(true);
    await pane.loadDiff(true);
    old.resolve(diff("oldest"));
    await first;

    expect(pane.raw.u).toBe(diff("newest"));
    expect(pane.uView.set).toHaveBeenCalledTimes(1);
  });

  it("ignores an error from a request replaced by a successful request", async () => {
    const pane = harness();
    const old = deferred<string>();
    vi.mocked(git.diff).mockReturnValueOnce(old.promise).mockResolvedValueOnce(diff("newest"));
    const first = pane.loadDiff(true);
    await pane.loadDiff(true);
    old.reject(new Error("old repo disappeared"));
    await first;

    expect(pane.dScroll.innerHTML).not.toContain("old repo disappeared");
    expect(pane.raw.u).toBe(diff("newest"));
  });

  it("clears patches and selections when resetting for another repository", async () => {
    const pane = harness();
    vi.mocked(git.diff).mockResolvedValue(diff("old"));
    await pane.loadDiff(true);
    pane.uView.selection.add("0:1");
    pane.selBar.hidden = false;
    pane.reset();

    expect(pane.files).toEqual({ u: null, s: null });
    expect(pane.uView.selection.size).toBe(0);
    expect(pane.selBar.hidden).toBe(true);
  });

  it("ignores conflict content loaded from the previous repository", async () => {
    const pane = harness();
    const old = deferred<{ path: string; content: string; mtime: number }>();
    pane.ctx.status.files = [{ ...file, conflict: true }];
    vi.mocked(ipc.fileRead).mockReturnValueOnce(old.promise);
    const first = pane.loadDiff(true);
    pane.ctx.repo = "repo-b";
    pane.ctx.status.files = [file];
    pane.reset();
    pane.selected = file.path;
    vi.mocked(git.diff).mockResolvedValueOnce(diff("repo-b"));
    await pane.loadDiff(true);
    old.resolve({ path: "repo-a/shared.txt", content: "<<<<<<< old repository", mtime: 1 });
    await first;

    expect(pane.dScroll.innerHTML).not.toContain("old repository");
    expect(pane.raw.u).toBe(diff("repo-b"));
  });
});
