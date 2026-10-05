import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayoutNode, Snapshot } from "../src/core/types";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/core/ipc", () => ({ ipc: { layoutSave: vi.fn(), snapshot: vi.fn() } }));

import { ipc } from "../src/core/ipc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const layout = (id: string): LayoutNode => ({ type: "leaf", id });
const snapshot = (id: string) => ({ layout: layout(id) }) as Snapshot;

describe("project switching", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  });

  it("keeps the most recently requested project when saves resolve out of order", async () => {
    const { store } = await import("../src/core/store");
    const saveA = deferred<void>();
    const saveB = deferred<void>();
    vi.mocked(ipc.layoutSave).mockReturnValueOnce(saveA.promise).mockReturnValueOnce(saveB.promise);
    vi.mocked(ipc.snapshot).mockImplementation(async (key) => snapshot(key));

    const a = store.setProject("a");
    const b = store.setProject("b");
    saveB.resolve();
    await b;
    saveA.resolve();
    await a;

    expect(store.project).toBe("b");
    expect(store.tree).toEqual(layout("main::b"));
  });

  it("does not save the old project's tree over a project that is still loading", async () => {
    const { store } = await import("../src/core/store");
    const pendingA = deferred<Snapshot>();
    store.tree = layout("original");
    vi.mocked(ipc.layoutSave).mockResolvedValue(undefined);
    vi.mocked(ipc.snapshot).mockReturnValueOnce(pendingA.promise).mockResolvedValueOnce(snapshot("b"));

    const a = store.setProject("a");
    await vi.waitFor(() => expect(ipc.snapshot).toHaveBeenCalledTimes(1));
    const b = store.setProject("b");
    await b;
    pendingA.resolve(snapshot("a"));
    await a;

    expect(ipc.layoutSave).toHaveBeenNthCalledWith(2, "main", layout("original"), "tiles");
    expect(store.project).toBe("b");
    expect(store.tree).toEqual(layout("b"));
  });

  it("cancels a pending switch when the user returns to the current project", async () => {
    const { store } = await import("../src/core/store");
    const pending = deferred<void>();
    store.tree = layout("original");
    vi.mocked(ipc.layoutSave).mockReturnValueOnce(pending.promise);
    vi.mocked(ipc.snapshot).mockResolvedValue(snapshot("a"));

    const switching = store.setProject("a");
    await store.setProject(null);
    pending.resolve();
    await switching;

    expect(store.project).toBeNull();
    expect(store.tree).toEqual(layout("original"));
    expect(ipc.snapshot).not.toHaveBeenCalled();
  });
});
