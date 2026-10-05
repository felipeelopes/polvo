// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GhPr } from "../src/work/api";
import type { Raw } from "../src/work/model";
import type { Session } from "../src/core/types";

vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ label: "main" }) }));
vi.mock("../src/work/api", () => ({ work: { config: vi.fn(), detect: vi.fn(), local: vi.fn(), github: vi.fn() } }));

import { store } from "../src/core/store";
import { setLocale, t } from "../src/i18n";
import { work } from "../src/work/api";
import { WorkView, type WorkHost } from "../src/work/view";

const now = new Date(2026, 9, 5, 12).getTime();
const repo = "C:\\demo";
const pr = (number: number): GhPr => ({
  number, title: `PR ${number}`, url: `https://github.com/demo/repo/pull/${number}`,
  isDraft: false, state: "OPEN", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), mergedAt: null,
  additions: 10, deletions: 2, headRefName: "fix", baseRefName: "main", reviewDecision: "REVIEW_REQUIRED",
  repository: { nameWithOwner: "demo/repo" }, author: { login: "demo" }, comments: { totalCount: 0 }, commits: { nodes: [] },
});

let raw: Raw;
let view: WorkView;
let host: WorkHost;
const cards = () => Array.from(view.el.querySelectorAll<HTMLElement>(".wk-kpi"));

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.resetAllMocks();
  localStorage.clear();
  setLocale("pt");
  store.view = "work";
  store.project = null;
  store.git = {};
  store.usage = [];
  store.tools.codex = true;
  store.sessions = [{
    id: "agent", tool: "codex", cwd: repo, title: "Demo", sessionId: null, window: "main", minimized: false,
    createdAt: now, titleLocked: false, color: null,
    runtime: { status: "working", since: now, exitCode: null, error: null, preview: [], version: null },
  } satisfies Session];
  raw = {
    local: {
      commits: [{ repo, sha: "a".repeat(40), date: now, subject: "Fix demo", add: 10, del: 2 }],
      repos: [{ path: repo, remote: { kind: "github", slug: "demo/repo", org: null, project: null }, user: "Demo", email: "demo@example.com" }],
    },
    gh: { viewer: { login: "demo", name: "Demo", avatarUrl: "" }, assigned: { nodes: [] }, closed: { nodes: [] }, mine: { nodes: [pr(1)] }, review: { nodes: [] }, merged: { nodes: [] } },
    ado: [],
  };
  localStorage.setItem("polvo.work.cache", JSON.stringify({ raw, at: now }));
  vi.mocked(work.config).mockResolvedValue({ onboarded: true, github: true, adoOrgs: [], bugsFirst: true, agent: "auto", refreshMinutes: 5 });
  vi.mocked(work.detect).mockResolvedValue({
    githubLogin: "demo", githubSource: "polvo", githubName: "Demo", githubAvatar: null, ghInstalled: false,
    githubNative: true, entraNative: false, entraConnected: false, azInstalled: false, azUser: null,
  });
  vi.mocked(work.local).mockImplementation(async () => raw.local!);
  vi.mocked(work.github).mockImplementation(async () => raw.gh!);
  host = { repos: () => [repo], askAgent: vi.fn(), openSession: vi.fn(), openBoard: vi.fn(), newSession: vi.fn(), openTerminal: vi.fn() };
  view = new WorkView(host);
  document.body.append(view.el);
  await view.show();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  view.el.remove();
  store.view = "tiles";
  localStorage.clear();
});

describe("Meu trabalho live updates", () => {
  it("keeps KPI cards and their contents mounted during repeated terminal updates", () => {
    const original = cards();
    const values = original.map((card) => card.querySelector(".v"));
    const spark = original[0].querySelector("svg");
    const board = view.el.querySelector<HTMLButtonElement>(".wk-agents [data-board]")!;
    board.focus();
    expect(original).toHaveLength(6);

    for (let i = 0; i < 30; i++) {
      store.sessions[0].runtime.preview = [`Output ${i}`];
      view.sessionsChanged();
    }

    cards().forEach((card, i) => {
      expect(card).toBe(original[i]);
      expect(card.querySelector(".v")).toBe(values[i]);
    });
    expect(cards()[0].querySelector("svg")).toBe(spark);
    expect(view.el.querySelector(".wk-agents [data-board]")).toBe(board);
    expect(document.activeElement).toBe(board);
  });

  it("updates changing agent counts without replacing cards or unrelated content", () => {
    const original = cards();
    const values = original.map((card) => card.querySelector(".v"));
    store.sessions[0].runtime.status = "waiting";
    view.sessionsChanged();
    expect(original[5].querySelector(".s")?.textContent).toBe(t("work.kpi.agentsSub", { working: 0, waiting: 1 }));
    expect(view.el.querySelectorAll(".wk-ags .v")[1].textContent).toBe("1");
    store.sessions[0].runtime.status = "idle";
    view.sessionsChanged();

    cards().forEach((card, i) => {
      expect(card).toBe(original[i]);
      if (i < 5) expect(card.querySelector(".v")).toBe(values[i]);
    });
    expect(original[5].querySelector(".v")?.textContent).toBe("0");
    expect(original[5].querySelector(".s")?.textContent).toBe(t("work.kpi.agentsSub", { working: 0, waiting: 0 }));
  });

  it("refreshes commit and PR values, project filters and card shortcuts in place", async () => {
    const original = cards();
    raw.local!.commits.push({ ...raw.local!.commits[0], sha: "b".repeat(40) });
    raw.gh!.mine.nodes.push(pr(2));
    await view.refresh();
    expect(cards()[0].querySelector(".v")?.textContent).toBe("2");
    expect(cards()[1].querySelector(".v")?.textContent).toBe("2");

    store.project = "c:\\other";
    view.rerender();
    expect(cards()[0].querySelector(".v")?.textContent).toBe("0");
    expect(cards()[1].querySelector(".v")?.textContent).toBe("0");
    store.project = null;
    await view.show();
    cards().forEach((card, i) => expect(card).toBe(original[i]));
    expect(cards()[0].querySelector(".v")?.textContent).toBe("2");
    expect(cards()[1].querySelector(".v")?.textContent).toBe("2");

    cards()[2].click();
    expect(view.el.querySelector(".wk-prs button[data-prtab='review']")?.classList.contains("on")).toBe(true);
    cards()[5].click();
    expect(host.openBoard).toHaveBeenCalledOnce();
  });
});
