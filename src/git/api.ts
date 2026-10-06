// Comandos de git do backend (src-tauri/src/gitops.rs), tipados.
import { Channel, invoke } from "@tauri-apps/api/core";

export interface FileChange {
  path: string;
  orig: string | null;
  x: string;
  y: string;
  untracked: boolean;
  conflict: boolean;
}

export type Operation = "merge" | "rebase" | "cherry-pick" | "revert";

export interface GitStatus {
  root: string;
  branch: string | null;
  head: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: FileChange[];
  operation: Operation | null;
  stashes: number;
  unborn: boolean;
}

export interface GitSummary {
  branch: string | null;
  changed: number;
  conflicts: number;
  ahead: number;
  behind: number;
}

export interface Commit {
  sha: string;
  short: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  refs: string[];
  subject: string;
  body: string;
  unpushed: boolean;
}

export interface CommitFile {
  status: string;
  path: string;
  orig: string | null;
}

export interface Branch {
  name: string;
  remote: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
  sha: string;
  date: number;
  subject: string;
  current: boolean;
  worktree: string | null;
}

export interface Stash {
  index: number;
  message: string;
  date: number;
}

export interface PullRequest {
  number: number;
  title: string;
  headRefName: string;
  baseRefName: string;
  author: { login: string } | null;
  isDraft: boolean;
  url: string;
  reviewDecision: string | null;
  statusCheckRollup: { conclusion?: string | null; status?: string | null; state?: string | null }[] | null;
  updatedAt: string;
}

export type DiffKind = "worktree" | "staged" | "untracked" | "commit";
export type RemoteOp = "fetch" | "pull" | "push" | "publish" | "force-push" | "push-tags";

function bytes(data: ArrayBuffer | number[] | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

export const git = {
  status: (repo: string) => invoke<GitStatus>("git_status", { repo }),
  summaries: (paths: string[]) => invoke<Record<string, GitSummary>>("git_summaries", { paths }),
  diff: (req: { repo: string; path: string; orig?: string | null; kind: DiffKind; sha?: string; context?: number; ignoreWs?: boolean }) =>
    invoke<string>("git_diff", { req }),
  fileAt: async (repo: string, rev: string, path: string) => bytes(await invoke<ArrayBuffer | number[]>("git_file_at", { repo, rev, path })),
  stage: (repo: string, paths: string[]) => invoke<void>("git_stage", { repo, paths }),
  unstage: (repo: string, paths: string[]) => invoke<void>("git_unstage", { repo, paths }),
  apply: (repo: string, patch: string, cached: boolean, reverse: boolean) => invoke<void>("git_apply", { repo, patch, cached, reverse }),
  discard: (repo: string, files: { path: string; orig: string | null; x: string; untracked: boolean }[]) => invoke<void>("git_discard", { repo, files }),
  commit: (req: { repo: string; message: string; amend: boolean; noVerify: boolean; all: boolean; signOff: boolean; paths: string[] }) =>
    invoke<{ sha: string; subject: string }>("git_commit", { req }),
  /** Com `expect`, só desfaz se o HEAD ainda for aquele commit. */
  undoCommit: (repo: string, expect?: string) => invoke<string>("git_undo_commit", { repo, expect: expect ?? null }),
  ignore: (repo: string, pattern: string) => invoke<void>("git_ignore", { repo, pattern }),
  init: (path: string) => invoke<void>("git_init", { path }),
  log: (repo: string, skip: number, limit: number, search?: string, rev?: string, path?: string) =>
    invoke<Commit[]>("git_log", { repo, skip, limit, search, rev, path }),
  commitFiles: (repo: string, sha: string) => invoke<CommitFile[]>("git_commit_files", { repo, sha }),
  branches: (repo: string) => invoke<Branch[]>("git_branches", { repo }),
  action: (repo: string, action: string, args: string[] = []) => invoke<string>("git_action", { req: { repo, action, args } }),
  stashes: (repo: string) => invoke<Stash[]>("git_stashes", { repo }),
  remote: (repo: string, op: RemoteOp, onProgress: (line: string) => void) => {
    const progress = new Channel<string>();
    progress.onmessage = onProgress;
    return invoke<string>("git_remote", { repo, op, progress });
  },
  webUrl: (repo: string) => invoke<string | null>("git_web_url", { repo }),
  prs: (repo: string) => invoke<PullRequest[]>("gh_prs", { repo }),
  prCreate: (repo: string) => invoke<void>("gh_pr_create", { repo }),
  aiMessage: (repo: string) => invoke<string>("git_ai_message", { repo }),
  openInEditor: (path: string, line?: number) => invoke<void>("open_in_editor", { path, line }),
  editorAvailable: () => invoke<boolean>("editor_available"),
  ghAvailable: () => invoke<boolean>("gh_available"),
  repoConfig: (repo: string) => invoke<{ remote: string | null; name: string; email: string; defaultBranch: string | null }>("git_repo_config", { repo }),
};
