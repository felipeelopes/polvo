// Comandos do "Meu trabalho" (src-tauri/src/work), tipados.
import { Channel, invoke } from "@tauri-apps/api/core";

export interface AdoOrg {
  name: string;
  /** "account" (Microsoft Entra ID ou Azure CLI) ou "pat". */
  auth: "account" | "pat";
}

export interface WorkConfig {
  onboarded: boolean;
  github: boolean;
  adoOrgs: AdoOrg[];
  bugsFirst: boolean;
  agent: string;
  refreshMinutes: number;
}

export interface Detect {
  githubLogin: string | null;
  githubSource: "polvo" | "gh" | null;
  githubName: string | null;
  githubAvatar: string | null;
  ghInstalled: boolean;
  githubNative: boolean;
  entraNative: boolean;
  entraConnected: boolean;
  azInstalled: boolean;
  azUser: string | null;
}

export interface Remote {
  kind: "github" | "ado" | "other";
  slug: string;
  org: string | null;
  project: string | null;
}

export interface LocalRepo {
  path: string;
  remote: Remote | null;
  user: string;
  email: string;
  /** Branches locais (ausente em cache antigo). */
  branches?: string[];
}

export interface LocalCommit {
  repo: string;
  sha: string;
  date: number;
  subject: string;
  add: number;
  del: number;
}

export interface LocalWork {
  commits: LocalCommit[];
  repos: LocalRepo[];
}

export interface GhLabel {
  name: string;
  color: string;
}

export interface GhIssue {
  number: number;
  title: string;
  url: string;
  state: "OPEN" | "CLOSED";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  repository: { nameWithOwner: string };
  labels: { nodes: GhLabel[] };
  comments: { totalCount: number };
  issueType?: { name: string } | null;
}

export interface GhPr {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  headRefName: string;
  baseRefName: string;
  reviewDecision: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  repository: { nameWithOwner: string };
  author: { login: string } | null;
  comments: { totalCount: number };
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}

type Nodes<T> = { nodes: (T | Record<string, never>)[] };

export interface GhData {
  viewer: { login: string; name: string | null; avatarUrl: string };
  assigned: Nodes<GhIssue>;
  closed: Nodes<GhIssue>;
  mine: Nodes<GhPr>;
  review: Nodes<GhPr>;
  merged: Nodes<GhPr>;
}

export interface AdoWorkItem {
  id: number;
  fields: Record<string, unknown>;
}

export interface AdoPr {
  org: string;
  project: string;
  role: "mine" | "review";
  id: number;
  title: string;
  repo: string;
  isDraft: boolean;
  created: string;
  source: string;
  target: string;
  mergeStatus: string | null;
  author: string | null;
  votes: number[];
  url: string;
}

export interface AdoSprint {
  org: string;
  project: string;
  name: string;
  path: string;
  start: string | null;
  finish: string | null;
  url: string;
  items: { id: number; type: string; state: string; points: number | null; closed: string | null }[];
}

/** Estado de um tipo de work item como o Azure DevOps define (inclusive processos customizados). */
export interface AdoStateDef {
  name: string;
  /** Hex sem "#". */
  color: string;
  /** Proposed | InProgress | Resolved | Completed | Removed */
  category: string;
}

export interface AdoResult {
  org: string;
  error: string | null;
  me: { id: string; providerDisplayName?: string } | null;
  items: AdoWorkItem[];
  touched: number[];
  prs: AdoPr[];
  sprint: AdoSprint | null;
  /** Por "projeto|tipo" em minúsculas. */
  states?: Record<string, AdoStateDef[]>;
}

export interface ThreadComment {
  author: string | null;
  avatar: string | null;
  html: string | null;
  date: string | null;
  bot?: boolean;
}

export interface Thread {
  body: string | null;
  comments: ThreadComment[];
}

/** Mensagens do login: o código a digitar (device flow) ou "abrimos o navegador". */
export type LoginEvent = { code: string; url: string } | { browser: true };

function channel(on: (e: LoginEvent) => void): Channel<LoginEvent> {
  const c = new Channel<LoginEvent>();
  c.onmessage = on;
  return c;
}

export const work = {
  config: () => invoke<WorkConfig>("work_config_get"),
  saveConfig: (config: WorkConfig) => invoke<WorkConfig>("work_config_set", { config }),
  detect: () => invoke<Detect>("work_detect"),
  githubLogin: (on: (e: LoginEvent) => void) => invoke<void>("work_github_login", { progress: channel(on) }),
  githubLogout: () => invoke<void>("work_github_logout"),
  adoLogin: (on: (e: LoginEvent) => void) => invoke<string | null>("work_ado_login", { progress: channel(on) }),
  /** Sem `org`: sai da conta Microsoft; com `org`: apaga o PAT dela. */
  adoLogout: (org?: string) => invoke<void>("work_ado_logout", { org: org ?? null }),
  adoDiscover: () => invoke<string[]>("work_ado_discover"),
  adoPat: (org: string, pat: string) => invoke<string>("work_ado_pat_set", { org, pat }),
  local: (repos: string[], since: number) => invoke<LocalWork>("work_local", { repos, since }),
  github: (since: string) => invoke<GhData>("work_github", { since }),
  ado: (orgs: AdoOrg[], hints: { org: string; project: string }[]) => invoke<AdoResult[]>("work_ado", { orgs, hints }),
  githubThread: async (repo: string, number: number): Promise<Thread> => {
    const r = await invoke<{ body: ThreadComment; comments: ThreadComment[] }>("work_github_thread", { repo, number });
    return { body: r.body.html, comments: r.comments };
  },
  githubComment: (repo: string, number: number, body: string) => invoke<void>("work_github_comment", { repo, number, body }),
  /** "open" reabre; "completed" ou "not_planned" fecha. */
  githubSetState: (repo: string, number: number, state: "open" | "completed" | "not_planned") => invoke<void>("work_github_set_state", { repo, number, state }),
  adoSetState: (org: AdoOrg, project: string, id: number, state: string) =>
    invoke<void>("work_ado_set_state", { org: org.name, auth: org.auth, project, id, state }),
  adoThread: async (org: AdoOrg, project: string, id: number): Promise<Thread> => {
    const r = await invoke<{ description: string | null; repro: string | null; acceptance: string | null; comments: ThreadComment[] }>("work_ado_thread", {
      org: org.name,
      auth: org.auth,
      project,
      id,
    });
    const body = [r.repro, r.description, r.acceptance].filter(Boolean).join("<hr>");
    return { body: body || null, comments: r.comments };
  },
  adoComment: (org: AdoOrg, project: string, id: number, text: string) =>
    invoke<void>("work_ado_comment", { org: org.name, auth: org.auth, project, id, text }),
};
