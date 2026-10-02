import { describe, expect, it } from "vitest";
import type { AdoSprint, GhIssue } from "../src/work/api";
import {
  branchName,
  bugKind,
  businessDaysBetween,
  fromAdoItem,
  fromGithubIssue,
  group,
  heat,
  htmlToText,
  isPending,
  mapState,
  perDay,
  reasons,
  score,
  sprintStats,
  type Item,
} from "../src/work/model";

const item = (p: Partial<Item>): Item => ({
  key: p.key ?? `k${Math.random()}`,
  src: "gh",
  ref: "#1",
  num: 1,
  title: "Algo",
  kind: "issue",
  state: "todo",
  rawState: "open",
  stateColor: null,
  typeName: null,
  priority: null,
  tags: [],
  project: "polvo",
  url: "https://github.com/a/b/issues/1",
  comments: 0,
  created: 0,
  updated: 0,
  closed: null,
  inSprint: false,
  assigned: true,
  ...p,
});

const issue = (p: Partial<GhIssue>): GhIssue => ({
  number: 7,
  title: "Tela nova",
  url: "https://github.com/a/b/issues/7",
  state: "OPEN",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-02T10:00:00Z",
  closedAt: null,
  repository: { nameWithOwner: "a/b" },
  labels: { nodes: [] },
  comments: { totalCount: 2 },
  ...p,
});

describe("estados", () => {
  it("normaliza nomes de estados de vários processos", () => {
    expect(mapState("New")).toBe("todo");
    expect(mapState("To Do")).toBe("todo");
    expect(mapState("Active")).toBe("doing");
    expect(mapState("In Progress")).toBe("doing");
    expect(mapState("Committed")).toBe("doing");
    expect(mapState("Resolved")).toBe("review");
    expect(mapState("Closed")).toBe("done");
    expect(mapState("Done")).toBe("done");
    expect(mapState("qualquer", true)).toBe("done");
  });

  it("pendente = a fazer, em andamento ou bloqueado", () => {
    expect(isPending(item({ state: "todo" }))).toBe(true);
    expect(isPending(item({ state: "blocked" }))).toBe(true);
    expect(isPending(item({ state: "review" }))).toBe(false);
    expect(isPending(item({ state: "done" }))).toBe(false);
  });
});

describe("bugs", () => {
  it("reconhece bugs marcados e prováveis pelo título", () => {
    expect(bugKind(item({ kind: "bug" }))).toBe("label");
    expect(bugKind(item({ tags: ["bug"] }))).toBe("label");
    expect(bugKind(item({ title: "Scroll travando no terminal" }))).toBe("travando");
    expect(bugKind(item({ title: "Login fails after token expiry" }))).toBe("fails");
    expect(bugKind(item({ title: "Tela de onboarding em 3 passos" }))).toBeNull();
    // "erro" dentro de outra palavra não conta.
    expect(bugKind(item({ title: "Ferrovia nova" }))).toBeNull();
  });

  it("bugs urgentes ficam no topo do agrupamento inteligente", () => {
    const list = [
      item({ key: "a", title: "Tela nova", state: "doing" }),
      item({ key: "b", kind: "bug", priority: 1 }),
      item({ key: "c", title: "Timeout no webhook" }),
      item({ key: "d", title: "Docs", state: "review" }),
      item({ key: "e", title: "Feito", state: "done" }),
    ];
    const g = group(list, "smart");
    expect(g.map((x) => [x.key, x.items.map((i) => i.key)])).toEqual([
      ["urgent", ["b"]],
      ["bugs", ["c"]],
      ["continue", ["a"]],
      ["next", []],
      ["review", ["d"]],
      ["done", ["e"]],
    ]);
  });

  it("pontuação explica a ordem", () => {
    const i = item({ kind: "bug", priority: 1, state: "blocked", inSprint: true });
    expect(reasons(i, 2).map((r) => r.key)).toEqual(["bug", "p1", "blocked", "sprint", "newComments"]);
    expect(score(i)).toBeGreaterThan(score(item({ priority: 1 })));
  });
});

describe("GitHub", () => {
  it("lê tipo, prioridade e estado das labels", () => {
    const i = fromGithubIssue(issue({ labels: { nodes: [{ name: "bug", color: "" }, { name: "P1", color: "" }, { name: "in progress", color: "" }] } }));
    expect(i.kind).toBe("bug");
    expect(i.priority).toBe(1);
    expect(i.state).toBe("doing");
    expect(i.tags).toEqual(["bug", "in progress"]);
    expect(i.key).toBe("gh:a/b#7");
    expect(fromGithubIssue(issue({ state: "CLOSED" })).state).toBe("done");
    expect(fromGithubIssue(issue({ issueType: { name: "Bug" } })).kind).toBe("bug");
  });
});

describe("Azure DevOps", () => {
  it("converte work items e marca sprint, bloqueio e dono", () => {
    const w = {
      id: 1832,
      fields: {
        "System.Title": "Login falha",
        "System.WorkItemType": "Bug",
        "System.State": "Active",
        "System.TeamProject": "Polvo Web",
        "System.IterationPath": "Polvo Web\\Sprint 42",
        "System.Tags": "Blocked; api",
        "System.CommentCount": 6,
        "System.AssignedTo": { id: "me" },
        "Microsoft.VSTS.Common.Priority": 2,
        "Microsoft.VSTS.Common.Severity": "1 - Critical",
      },
    };
    const i = fromAdoItem("nox", w, "me", "Polvo Web\\Sprint 42");
    expect(i).toMatchObject({ ref: "AB#1832", kind: "bug", state: "blocked", priority: 1, inSprint: true, assigned: true, comments: 6 });
    expect(i.url).toBe("https://dev.azure.com/nox/Polvo%20Web/_workitems/edit/1832");
    expect(fromAdoItem("nox", w, "other", null).assigned).toBe(false);
  });

  it("usa os estados reais (nome, cor e categoria) do Azure DevOps", () => {
    const defs = [
      { name: "New", color: "b2b2b2", category: "Proposed" },
      { name: "Approved", color: "b2b2b2", category: "Proposed" },
      { name: "Committed", color: "007acc", category: "Proposed" },
      { name: "Testing", color: "ff9d00", category: "InProgress" },
      { name: "Done", color: "339933", category: "Completed" },
    ];
    const w = (state: string) => ({ id: 1, fields: { "System.State": state, "System.WorkItemType": "Product Backlog Item", "System.TeamProject": "P" } });
    const committed = fromAdoItem("o", w("Committed"), null, null, () => defs);
    // Processo customizado: "Committed" é "Proposed" aqui, não "em andamento".
    expect([committed.state, committed.rawState, committed.stateColor, committed.typeName]).toEqual(["todo", "Committed", "#007acc", "Product Backlog Item"]);
    expect(fromAdoItem("o", w("Testing"), null, null, () => defs).state).toBe("doing");
    // Sem as definições, cai na heurística pelo nome.
    expect(fromAdoItem("o", w("Committed"), null, null).state).toBe("doing");
    const g = group([committed, fromAdoItem("o", { ...w("Testing"), id: 2 }, null, null, () => defs)], "state");
    expect(g.map((x) => [x.title, x.literal, x.color])).toEqual([
      ["Testing", true, "#ff9d00"],
      ["Committed", true, "#007acc"],
    ]);
  });

  it("calcula progresso e burndown da sprint", () => {
    const s: AdoSprint = {
      org: "nox",
      project: "P",
      name: "Sprint 42",
      path: "P\\Sprint 42",
      start: "2026-09-28T00:00:00Z",
      finish: "2026-10-09T00:00:00Z",
      url: "",
      items: [
        { id: 1, type: "User Story", state: "Closed", points: 5, closed: "2026-09-29T12:00:00Z" },
        { id: 2, type: "User Story", state: "Active", points: 3, closed: null },
        { id: 3, type: "Bug", state: "New", points: 2, closed: null },
      ],
    };
    const st = sprintStats(s, Date.parse("2026-10-01T12:00:00Z"))!;
    expect(st.unit).toBe("points");
    expect([st.total, st.done]).toEqual([10, 5]);
    expect(st.byState.map((x) => [x.name, x.value])).toEqual([
      ["Active", 3],
      ["New", 2],
      ["Closed", 5],
    ]);
    expect(st.burndown[0]).toBe(10);
    expect(st.burndown.at(-1)).toBe(5);
  });

  it("conta dias úteis", () => {
    // sexta 2026-10-02 → segunda 2026-10-05: sexta + segunda.
    expect(businessDaysBetween(Date.parse("2026-10-02T12:00:00"), Date.parse("2026-10-05T12:00:00"))).toBe(2);
  });
});

describe("agente e atividade", () => {
  it("nome de branch a partir do item", () => {
    expect(branchName(item({ num: 1832, kind: "bug", title: "Login falha quando o token do Entra expira!" }))).toBe("fix/1832-login-falha-quando-o-token-do-entra-expi");
    expect(branchName(item({ num: 5, title: "Ação nova" }))).toBe("feat/5-acao-nova");
  });

  it("HTML vira texto para o prompt", () => {
    expect(htmlToText("<p>Olá&nbsp;<b>mundo</b></p><ul><li>um</li><li>dois</li></ul>")).toBe("Olá mundo\n• um\n• dois");
  });

  it("agrupa commits por dia e hora", () => {
    const now = Date.parse("2026-10-02T15:00:00");
    const c = (iso: string) => ({ repo: "r", sha: iso, date: Date.parse(iso), subject: "", add: 1, del: 0 });
    const commits = [c("2026-10-02T09:10:00"), c("2026-10-02T09:40:00"), c("2026-10-01T22:00:00")];
    expect(perDay(commits, 3, now)).toEqual([0, 1, 2]);
    const m = heat(commits, now);
    expect(m[6][9]).toBe(2);
    expect(m[5][22]).toBe(1);
  });
});
