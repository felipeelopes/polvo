import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionTerminal } from "../src/terminal/session-terminal";

vi.mock("../src/core/ipc", () => ({ ipc: { ptyAttach: vi.fn(), ptyResize: vi.fn() } }));
vi.mock("../src/ui/theme", () => ({ cssVar: () => "", isLightTerminal: () => false, onThemeChange: vi.fn() }));
vi.mock("../src/terminal/file-links", () => ({ installCtrlClick: vi.fn(), mdLinkProvider: vi.fn() }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({ WebglAddon: class {} }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    unicode = { activeVersion: "" };
    loadAddon = vi.fn();
    onData = vi.fn();
    attachCustomKeyEventHandler = vi.fn();
    open = vi.fn();
    reset = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
  },
}));

import { ipc } from "../src/core/ipc";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function element() {
  const el = { className: "", parentElement: null as object | null, addEventListener: vi.fn(), remove: vi.fn(), appendChild: vi.fn() };
  el.appendChild.mockImplementation((child: ReturnType<typeof element>) => { child.parentElement = el; });
  return el;
}

describe("terminal connection lifecycle", () => {
  let TerminalClass: typeof SessionTerminal;
  let terminal: SessionTerminal;

  beforeAll(async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { createElement: element, body: { appendChild: vi.fn() } });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); disconnect = vi.fn(); });
    TerminalClass = (await import("../src/terminal/session-terminal")).SessionTerminal;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    terminal = new TerminalClass("session", "codex", () => false);
  });

  afterEach(() => { terminal.dispose(); vi.clearAllTimers(); });
  afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("ignores history from an older attachment after restarting", async () => {
    const old = deferred<Uint8Array>();
    const current = deferred<Uint8Array>();
    vi.mocked(ipc.ptyAttach).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = terminal.connect(1);
    const second = terminal.connect(2);
    const bytes = Uint8Array.of(2);
    current.resolve(bytes);
    await second;
    old.resolve(Uint8Array.of(1));
    await first;

    expect(terminal.term.reset).toHaveBeenCalledTimes(1);
    expect(terminal.term.write).toHaveBeenCalledExactlyOnceWith(bytes);
    expect(terminal.connectedTo).toBe(2);
    expect(terminal.connected).toBe(true);
  });

  it("does not disconnect the new attachment when an older one fails", async () => {
    const old = deferred<Uint8Array>();
    vi.mocked(ipc.ptyAttach).mockReturnValueOnce(old.promise).mockResolvedValueOnce(Uint8Array.of(2));
    const first = terminal.connect(1);
    await terminal.connect(2);
    old.reject(new Error("old process exited"));
    await first;

    expect(terminal.connected).toBe(true);
    expect(terminal.connectedTo).toBe(2);
  });

  it("queues only current output behind current history", async () => {
    const old = deferred<Uint8Array>();
    const current = deferred<Uint8Array>();
    vi.mocked(ipc.ptyAttach).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const first = terminal.connect(1);
    const second = terminal.connect(2);
    vi.mocked(ipc.ptyAttach).mock.calls[0][1](Uint8Array.of(9));
    vi.mocked(ipc.ptyAttach).mock.calls[1][1](Uint8Array.of(3));
    old.resolve(Uint8Array.of(1));
    await first;
    expect(terminal.term.write).not.toHaveBeenCalled();
    current.resolve(Uint8Array.of(2));
    await second;

    expect(vi.mocked(terminal.term.write).mock.calls.map(([data]) => Array.from(data as Uint8Array))).toEqual([[2], [3]]);
  });

  it("does not write to a terminal disposed while attachment is pending", async () => {
    const pending = deferred<Uint8Array>();
    vi.mocked(ipc.ptyAttach).mockReturnValueOnce(pending.promise);
    const connecting = terminal.connect(1);
    terminal.dispose();
    pending.resolve(Uint8Array.of(1));
    await connecting;
    vi.mocked(ipc.ptyAttach).mock.calls[0][1](Uint8Array.of(2));

    expect(terminal.term.reset).not.toHaveBeenCalled();
    expect(terminal.term.write).not.toHaveBeenCalled();
    expect(terminal.connected).toBe(false);
  });

  it("attaches only once for the same process start", async () => {
    vi.mocked(ipc.ptyAttach).mockResolvedValue(Uint8Array.of(1));
    await terminal.connect(1);
    await terminal.connect(1);
    expect(ipc.ptyAttach).toHaveBeenCalledTimes(1);
  });
});
