// Modelo do "Meu trabalho": junta GitHub, Azure DevOps e git local num formato
// só, classifica (bug? pendente? prioridade?) e ordena. Sem DOM: testável.
import type { AdoPr, AdoResult, AdoSprint, AdoWorkItem, GhData, GhIssue, GhPr, LocalCommit, LocalRepo } from "./api";

export type Src = "gh" | "ado";
export type ItemState = "todo" | "doing" | "review" | "blocked" | "done";
export type Kind = "bug" | "issue" | "story" | "task" | "feature" | "epic";

export interface Item {
  key: string;
  src: Src;
  /** "#12" (GitHub) ou "AB#123" (Azure DevOps). */
  ref: string;
  num: number;
  title: string;
  kind: Kind;
  state: ItemState;
  rawState: string;
  /** 1 (mais alta) a 4; null sem prioridade. */
  priority: number | null;
  tags: string[];
  /** Nome curto para mostrar (repositório ou projeto). */
  project: string;
  /** GitHub: "dono/repo". */
  repo?: string;
  /** Azure DevOps. */
  org?: string;
  adoProject?: string;
  url: string;
  comments: number;
  created: number;
  updated: number;
  closed: number | null;
  iteration?: string;
  points?: number;
  /** Na sprint atual (Azure DevOps). */
  inSprint: boolean;
  /** Atribuído a mim (itens só "mexidos hoje" aparecem na linha do tempo, não na lista). */
  assigned: boolean;
}

export interface Pr {
  key: string;
  src: Src;
  ref: string;
  title: string;
  repo: string;
  url: string;
  draft: boolean;
  created: number;
  updated: number;
  merged: number | null;
  role: "mine" | "review" | "merged";
  checks: "ok" | "bad" | "run" | null;
  review: "approved" | "changes" | "waiting" | null;
  add: number | null;
  del: number | null;
  author: string | null;
  branch: string | null;
  org?: string;
  adoProject?: string;
}

const ms = (s: string | null | undefined): number => (s ? Date.parse(s) || 0 : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isNode = <T extends object>(n: T | Record<string, never>): n is T => Object.keys(n).length > 0;

// ------------------------------------------------------------ classificação

/** Estado normalizado a partir do nome livre do estado (Agile, Scrum, CMMI, Basic, labels…). */
export function mapState(raw: string, closed = false): ItemState {
  const s = raw.toLowerCase();
  if (closed || /^(closed|done|completed|removed|cut|fechad|conclu)/.test(s)) return "done";
  if (/block|bloque/.test(s)) return "blocked";
  if (/resolved|review|revis|testing|test|qa|verify|validat|homolog/.test(s)) return "review";
  if (/active|progress|doing|committed|andamento|wip|desenvolv|working|open\b.*progress/.test(s)) return "doing";
  return "todo";
}

/** Palavras que, no título, sugerem um bug mesmo sem a marcação de bug. */
const BUG_WORDS =
  /(^|[^\p{L}])(bug|erro|error|falha|falhando|fails?|failing|failed|quebra|quebrad[oa]|broken|crash\w*|trava\w*|freez\w*|hang|leak|timeout|exce(?:ç|p)(?:ão|tion)|não funciona|nao funciona|doesn'?t work|not working|regress\w*|incorret\w*|wrong|500|401|403|404|null ?pointer|undefined)(?![\p{L}])/iu;

/** "label" quando o item é marcado como bug; a palavra que denuncia um provável bug; ou null. */
export function bugKind(i: Pick<Item, "kind" | "tags" | "title">): string | null {
  if (i.kind === "bug" || i.tags.some((t) => /^(bug|defect|defeito|type: ?bug|kind\/bug)$/i.test(t))) return "label";
  const m = i.title.match(BUG_WORDS);
  return m ? m[2].toLowerCase() : null;
}

export const isBug = (i: Item): boolean => bugKind(i) !== null;

/** Pendente: ainda depende de mim (não está em revisão nem concluído). */
export const isPending = (i: Item): boolean => i.state === "todo" || i.state === "doing" || i.state === "blocked";

const SECURITY = /^(security|segurança|seguranca|sec|vulnerability|cve)$/i;

export interface Reason {
  key: string;
  vars?: Record<string, string | number>;
  weight: number;
}

/** Por que o item está nesta posição (pesos somados = pontuação). */
export function reasons(i: Item, newComments = 0): Reason[] {
  const r: Reason[] = [];
  const b = bugKind(i);
  if (b === "label") r.push({ key: "bug", weight: 50 });
  else if (b) r.push({ key: "likelyBug", vars: { word: b }, weight: 35 });
  if (i.priority === 1) r.push({ key: "p1", weight: 40 });
  else if (i.priority === 2) r.push({ key: "p2", weight: 20 });
  if (i.tags.some((t) => SECURITY.test(t))) r.push({ key: "security", weight: 25 });
  if (i.state === "blocked") r.push({ key: "blocked", weight: 15 });
  if (i.state === "doing") r.push({ key: "started", weight: 12 });
  if (i.inSprint) r.push({ key: "sprint", weight: 10 });
  if (newComments > 0) r.push({ key: "newComments", vars: { n: newComments }, weight: 6 });
  return r;
}

export const score = (i: Item, newComments = 0): number => reasons(i, newComments).reduce((a, x) => a + x.weight, 0);

// ------------------------------------------------------------ GitHub

const PRIORITY_LABEL: [RegExp, number][] = [
  [/(^|\W)(p0|p1|sev[- ]?[01]|critical|crítico|critico|urgent|urgente|blocker)(\W|$)|priority:? ?(high|alta|1)|prioridade:? ?(alta|1)/i, 1],
  [/(^|\W)(p2|sev[- ]?2|important|importante)(\W|$)|priority:? ?(medium|média|media|2)|prioridade:? ?(média|media|2)/i, 2],
  [/(^|\W)(p3|p4|sev[- ]?[34]|minor|trivial)(\W|$)|priority:? ?(low|baixa|3|4)|prioridade:? ?(baixa|3|4)/i, 3],
];

function ghKind(issue: GhIssue, labels: string[]): Kind {
  const t = (issue.issueType?.name ?? "").toLowerCase();
  const all = [t, ...labels.map((l) => l.toLowerCase())];
  if (all.some((l) => /^(bug|defect|defeito|type: ?bug|kind\/bug)$/.test(l))) return "bug";
  if (all.some((l) => /^(feature|enhancement|melhoria|type: ?feature)$/.test(l))) return "feature";
  if (all.some((l) => /^(task|tarefa)$/.test(l))) return "task";
  if (all.some((l) => /^epic$/.test(l))) return "epic";
  return "issue";
}

export function fromGithubIssue(issue: GhIssue): Item {
  const labels = issue.labels.nodes.map((l) => l.name);
  const closed = issue.state === "CLOSED";
  const labelState = labels.map((l) => mapState(l)).find((s) => s !== "todo");
  const repo = issue.repository.nameWithOwner;
  return {
    key: `gh:${repo.toLowerCase()}#${issue.number}`,
    src: "gh",
    ref: `#${issue.number}`,
    num: issue.number,
    title: issue.title,
    kind: ghKind(issue, labels),
    state: closed ? "done" : (labelState ?? "todo"),
    rawState: closed ? "closed" : "open",
    priority: PRIORITY_LABEL.find(([re]) => labels.some((l) => re.test(l)))?.[1] ?? null,
    tags: labels.filter((l) => !PRIORITY_LABEL.some(([re]) => re.test(l))),
    project: repo.split("/")[1] ?? repo,
    repo,
    url: issue.url,
    comments: issue.comments.totalCount,
    created: ms(issue.createdAt),
    updated: ms(issue.updatedAt),
    closed: issue.closedAt ? ms(issue.closedAt) : null,
    inSprint: false,
    assigned: true,
  };
}

function ghChecks(pr: GhPr): Pr["checks"] {
  const s = pr.commits.nodes[0]?.commit.statusCheckRollup?.state;
  if (!s) return null;
  if (s === "SUCCESS") return "ok";
  if (s === "FAILURE" || s === "ERROR") return "bad";
  return "run";
}

export function fromGithubPr(pr: GhPr, role: Pr["role"]): Pr {
  const repo = pr.repository.nameWithOwner;
  return {
    key: `gh:${repo.toLowerCase()}!${pr.number}:${role}`,
    src: "gh",
    ref: `#${pr.number}`,
    title: pr.title,
    repo,
    url: pr.url,
    draft: pr.isDraft,
    created: ms(pr.createdAt),
    updated: ms(pr.updatedAt),
    merged: pr.mergedAt ? ms(pr.mergedAt) : null,
    role,
    checks: ghChecks(pr),
    review: pr.reviewDecision === "APPROVED" ? "approved" : pr.reviewDecision === "CHANGES_REQUESTED" ? "changes" : pr.reviewDecision ? "waiting" : null,
    add: pr.additions,
    del: pr.deletions,
    author: pr.author?.login ?? null,
    branch: pr.headRefName,
  };
}

// ------------------------------------------------------------ Azure DevOps

const ADO_KIND: Record<string, Kind> = {
  bug: "bug",
  issue: "issue",
  impediment: "issue",
  "user story": "story",
  "product backlog item": "story",
  requirement: "story",
  task: "task",
  feature: "feature",
  epic: "epic",
};

export function fromAdoItem(org: string, w: AdoWorkItem, meId: string | null, sprintPath: string | null): Item {
  const f = w.fields;
  const type = str(f["System.WorkItemType"]);
  const raw = str(f["System.State"]);
  const tags = str(f["System.Tags"])
    .split(";")
    .map((t) => t.trim())
    .filter(Boolean);
  const blocked = str(f["Microsoft.VSTS.CMMI.Blocked"]).toLowerCase() === "yes" || tags.some((t) => /^(blocked|bloqueado)$/i.test(t));
  const assignedTo = f["System.AssignedTo"] as { id?: string } | undefined;
  const project = str(f["System.TeamProject"]);
  const iteration = str(f["System.IterationPath"]);
  const severity = str(f["Microsoft.VSTS.Common.Severity"]);
  let priority = num(f["Microsoft.VSTS.Common.Priority"]);
  // Severidade crítica sobe a prioridade de um bug.
  if (/^1\b|critical/i.test(severity)) priority = 1;
  const state = mapState(raw);
  return {
    key: `ado:${org.toLowerCase()}:${w.id}`,
    src: "ado",
    ref: `AB#${w.id}`,
    num: w.id,
    title: str(f["System.Title"]),
    kind: ADO_KIND[type.toLowerCase()] ?? "task",
    state: blocked && state !== "done" ? "blocked" : state,
    rawState: raw,
    priority,
    tags,
    project,
    org,
    adoProject: project,
    url: `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${w.id}`,
    comments: num(f["System.CommentCount"]) ?? 0,
    created: ms(str(f["System.CreatedDate"])),
    updated: ms(str(f["System.ChangedDate"])),
    closed: f["Microsoft.VSTS.Common.ClosedDate"] ? ms(str(f["Microsoft.VSTS.Common.ClosedDate"])) : null,
    iteration,
    points: num(f["Microsoft.VSTS.Scheduling.StoryPoints"]) ?? num(f["Microsoft.VSTS.Scheduling.Effort"]) ?? num(f["Microsoft.VSTS.Scheduling.Size"]) ?? undefined,
    inSprint: !!sprintPath && iteration.toLowerCase() === sprintPath.toLowerCase(),
    assigned: !meId || assignedTo?.id === meId,
  };
}

export function fromAdoPr(pr: AdoPr): Pr {
  const votes = pr.votes;
  const review: Pr["review"] = votes.some((v) => v <= -5) ? "changes" : votes.some((v) => v >= 5) ? "approved" : "waiting";
  return {
    key: `ado:${pr.org.toLowerCase()}!${pr.id}:${pr.role}`,
    src: "ado",
    ref: `!${pr.id}`,
    title: pr.title,
    repo: pr.repo,
    url: pr.url,
    draft: pr.isDraft,
    created: ms(pr.created),
    updated: ms(pr.created),
    merged: null,
    role: pr.role,
    checks: pr.mergeStatus === "conflicts" ? "bad" : null,
    review,
    add: null,
    del: null,
    author: pr.author,
    branch: pr.source.replace(/^refs\/heads\//, ""),
    org: pr.org,
    adoProject: pr.project,
  };
}

// ------------------------------------------------------------ sprint

export interface SprintStats {
  name: string;
  project: string;
  org: string;
  url: string;
  start: number;
  finish: number;
  /** Dias úteis restantes (hoje incluído). */
  daysLeft: number;
  unit: "points" | "items";
  total: number;
  done: number;
  byState: Record<ItemState, number>;
  /** Restante ao fim de cada dia, do início até hoje (ou o fim). */
  burndown: number[];
  days: number;
}

export function businessDaysBetween(from: number, to: number): number {
  let n = 0;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (d <= end) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

export function sprintStats(s: AdoSprint, now = Date.now()): SprintStats | null {
  const start = ms(s.start);
  const finish = ms(s.finish);
  if (!start || !finish) return null;
  const pts = s.items.map((i) => i.points ?? 0);
  const unit = pts.some((p) => p > 0) ? "points" : "items";
  const weight = (i: AdoSprint["items"][number]) => (unit === "points" ? (i.points ?? 0) : 1);
  const byState: Record<ItemState, number> = { todo: 0, doing: 0, review: 0, blocked: 0, done: 0 };
  let total = 0;
  let done = 0;
  for (const i of s.items) {
    const st = mapState(i.state);
    byState[st] += weight(i);
    total += weight(i);
    if (st === "done") done += weight(i);
  }
  const day = 86_400_000;
  const days = Math.max(1, Math.round((finish - start) / day) + 1);
  const today = Math.min(Math.floor((Math.min(now, finish) - start) / day), days - 1);
  const burndown: number[] = [];
  for (let d = 0; d <= Math.max(0, today); d++) {
    const end = start + (d + 1) * day;
    const closed = s.items
      .filter((i) => mapState(i.state) === "done")
      .reduce((a, i) => a + ((i.closed ? ms(i.closed) : now) < end ? weight(i) : 0), 0);
    burndown.push(Math.max(0, total - closed));
  }
  return {
    name: s.name,
    project: s.project,
    org: s.org,
    url: s.url,
    start,
    finish,
    daysLeft: now > finish ? 0 : businessDaysBetween(Math.max(now, start), finish),
    unit,
    total,
    done,
    byState,
    burndown,
    days,
  };
}

// ------------------------------------------------------------ tudo junto

export interface Raw {
  local: { commits: LocalCommit[]; repos: LocalRepo[] } | null;
  gh: GhData | null;
  ado: AdoResult[];
}

export interface Model {
  items: Item[];
  /** Mexidos por mim hoje (Azure DevOps), inclusive os de outras pessoas. */
  touched: Item[];
  prs: Pr[];
  commits: LocalCommit[];
  repos: LocalRepo[];
  sprint: SprintStats | null;
}

export function build(raw: Raw, now = Date.now()): Model {
  const items: Item[] = [];
  const prs: Pr[] = [];
  const touched: Item[] = [];
  if (raw.gh) {
    const issues = [...raw.gh.assigned.nodes, ...raw.gh.closed.nodes].filter(isNode<GhIssue>);
    const seen = new Set<string>();
    for (const i of issues) {
      const it = fromGithubIssue(i);
      if (!seen.has(it.key)) {
        seen.add(it.key);
        items.push(it);
      }
    }
    for (const role of ["mine", "review", "merged"] as const) {
      for (const p of raw.gh[role].nodes.filter(isNode<GhPr>)) prs.push(fromGithubPr(p, role));
    }
  }
  let sprint: SprintStats | null = null;
  for (const o of raw.ado) {
    if (o.sprint && !sprint) sprint = sprintStats(o.sprint, now);
    const path = o.sprint?.path ?? null;
    const touchedIds = new Set(o.touched);
    for (const w of o.items) {
      const it = fromAdoItem(o.org, w, o.me?.id ?? null, path);
      if (it.assigned) items.push(it);
      if (touchedIds.has(w.id)) touched.push(it);
    }
    for (const p of o.prs) prs.push(fromAdoPr(p));
  }
  return {
    items,
    touched,
    prs,
    commits: raw.local?.commits ?? [],
    repos: raw.local?.repos ?? [],
    sprint,
  };
}

// ------------------------------------------------------------ lista "Para fazer"

export type StateFilter = "pending" | "doing" | "review" | "done" | "all";
export type GroupBy = "smart" | "state" | "project" | "none";

export const STATE_FILTERS: Record<StateFilter, (i: Item) => boolean> = {
  pending: isPending,
  doing: (i) => i.state === "doing",
  review: (i) => i.state === "review",
  done: (i) => i.state === "done",
  all: () => true,
};

export interface Group {
  key: string;
  /** Chave i18n do título (ou o nome do projeto quando `literal`). */
  title: string;
  literal?: boolean;
  hint?: string;
  urgent?: boolean;
  items: Item[];
}

const STATE_ORDER: ItemState[] = ["doing", "blocked", "todo", "review", "done"];

const urgentBug = (i: Item) => isBug(i) && (i.priority === 1 || i.state === "blocked" || i.state === "doing");

export function group(items: Item[], by: GroupBy, newComments: (i: Item) => number = () => 0): Group[] {
  const sorted = [...items].sort((a, b) => score(b, newComments(b)) - score(a, newComments(a)) || b.updated - a.updated);
  if (by === "none") return [{ key: "all", title: "", items: sorted }];
  if (by === "project") {
    const keys = [...new Set(sorted.map((i) => i.project))].sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ key: `p:${k}`, title: k, literal: true, items: sorted.filter((i) => i.project === k) }));
  }
  if (by === "state") return STATE_ORDER.map((s) => ({ key: s, title: `state.${s}`, items: sorted.filter((i) => i.state === s) }));
  const open = sorted.filter((i) => i.state !== "review" && i.state !== "done");
  return [
    { key: "urgent", title: "groups.urgent", hint: "groups.urgentHint", urgent: true, items: open.filter(urgentBug) },
    { key: "bugs", title: "groups.bugs", hint: "groups.bugsHint", items: open.filter((i) => isBug(i) && !urgentBug(i)) },
    { key: "continue", title: "groups.continue", hint: "groups.continueHint", items: open.filter((i) => !isBug(i) && i.state === "doing") },
    { key: "next", title: "groups.next", hint: "groups.nextHint", items: open.filter((i) => !isBug(i) && i.state !== "doing") },
    { key: "review", title: "state.review", items: sorted.filter((i) => i.state === "review") },
    { key: "done", title: "state.done", items: sorted.filter((i) => i.state === "done") },
  ];
}

export function matches(i: Item, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return `${i.title} ${i.ref} ${i.project} ${i.tags.join(" ")} ${i.rawState}`.toLowerCase().includes(s);
}

// ------------------------------------------------------------ agente

/** Nome de branch a partir do item: "fix/123-login-expira". */
export function branchName(i: Item): string {
  const slug = i.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${isBug(i) ? "fix" : "feat"}/${i.num}${slug ? `-${slug}` : ""}`;
}

/** HTML (descrição, comentário) para texto simples, para o prompt do agente. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h\d|hr)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ------------------------------------------------------------ atividade

export interface Slice {
  commits: LocalCommit[];
  add: number;
  del: number;
}

export function commitsSince(commits: LocalCommit[], since: number): Slice {
  const list = commits.filter((c) => c.date >= since);
  return { commits: list, add: list.reduce((a, c) => a + c.add, 0), del: list.reduce((a, c) => a + c.del, 0) };
}

/** Commits por dia (últimos `days` dias, o último é hoje). */
export function perDay(commits: LocalCommit[], days: number, now = Date.now()): number[] {
  const d0 = new Date(now);
  d0.setHours(0, 0, 0, 0);
  const out = new Array<number>(days).fill(0);
  for (const c of commits) {
    const idx = days - 1 - Math.floor((d0.getTime() + 86_400_000 - 1 - c.date) / 86_400_000);
    if (idx >= 0 && idx < days) out[idx]++;
  }
  return out;
}

/** Matriz [dia 0..6 (0 = 6 dias atrás)][hora 0..23] de commits. */
export function heat(commits: LocalCommit[], now = Date.now()): number[][] {
  const m = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const d0 = new Date(now);
  d0.setHours(0, 0, 0, 0);
  for (const c of commits) {
    const back = Math.floor((d0.getTime() + 86_400_000 - 1 - c.date) / 86_400_000);
    if (back < 0 || back > 6) continue;
    m[6 - back][new Date(c.date).getHours()]++;
  }
  return m;
}

export const startOfDay = (now = Date.now()): number => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const startOfWeek = (now = Date.now()): number => {
  const d = new Date(startOfDay(now));
  const wd = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - wd);
  return d.getTime();
};
