// Os patches parciais precisam ser aceitos pelo `git apply` de verdade.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPatch, lineKey, parseDiff } from "../src/git/diff";

let dir = "";
const git = (...args: string[]) => execFileSync("git", ["-c", "core.autocrlf=false", ...args], { cwd: dir, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const apply = (patch: string, ...flags: string[]) =>
  execFileSync("git", ["apply", "--whitespace=nowarn", ...flags, "-"], { cwd: dir, input: patch, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

let hasGit = true;
try {
  execFileSync("git", ["--version"]);
} catch {
  hasGit = false;
}

const BASE = Array.from({ length: 30 }, (_, i) => `linha ${i + 1}`).join("\n") + "\n";

describe.skipIf(!hasGit)("patches parciais com git apply", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "polvo-diff-"));
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(dir, "a.txt"), BASE);
    git("add", ".");
    git("commit", "-qm", "base");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const edit = () => {
    const lines = BASE.split("\n");
    lines[1] = "linha 2 alterada";
    lines.splice(5, 0, "nova A", "nova B");
    lines[25] = "linha perto do fim alterada";
    writeFileSync(join(dir, "a.txt"), lines.join("\n"));
  };

  it("inclui só uma linha no índice e depois tira", () => {
    git("reset", "-q", "--hard");
    edit();
    const [f] = parseDiff(git("diff", "-U3"));
    expect(f.hunks.length).toBeGreaterThan(1);
    // Escolhe só a linha "+nova B".
    const hi = f.hunks.findIndex((h) => h.lines.some((l) => l.text === "nova B"));
    const li = f.hunks[hi].lines.findIndex((l) => l.text === "nova B");
    apply(buildPatch(f, new Set([lineKey(hi, li)]), false)!, "--cached");
    const staged = git("diff", "--cached", "-U0");
    expect(staged).toContain("+nova B");
    expect(staged).not.toContain("+nova A");
    expect(staged).not.toContain("alterada");

    // Agora tira do índice pelo diff do índice (aplicado ao contrário).
    const [s] = parseDiff(git("diff", "--cached"));
    const shi = s.hunks.findIndex((h) => h.lines.some((l) => l.text === "nova B"));
    const sli = s.hunks[shi].lines.findIndex((l) => l.text === "nova B");
    apply(buildPatch(s, new Set([lineKey(shi, sli)]), true)!, "--cached", "--reverse");
    expect(git("diff", "--cached")).toBe("");
  });

  it("inclui o segundo trecho sozinho (deslocamento das linhas)", () => {
    git("reset", "-q", "--hard");
    edit();
    const [f] = parseDiff(git("diff", "-U3"));
    const last = f.hunks.length - 1;
    const sel = new Set<string>();
    f.hunks[last].lines.forEach((l, i) => l.kind !== " " && sel.add(lineKey(last, i)));
    apply(buildPatch(f, sel, false)!, "--cached");
    const staged = git("diff", "--cached", "-U0");
    expect(staged).toContain("+linha perto do fim alterada");
    expect(staged).not.toContain("nova A");
  });

  it("descarta só algumas linhas da pasta de trabalho", () => {
    git("reset", "-q", "--hard");
    edit();
    const [f] = parseDiff(git("diff", "-U3"));
    const hi = f.hunks.findIndex((h) => h.lines.some((l) => l.text === "nova A"));
    const sel = new Set<string>();
    f.hunks[hi].lines.forEach((l, i) => (l.text === "nova A" || l.text === "linha 2 alterada" || l.text === "linha 2") && l.kind !== " " && sel.add(lineKey(hi, i)));
    apply(buildPatch(f, sel, true)!, "--reverse");
    const now = readFileSync(join(dir, "a.txt"), "utf8");
    expect(now).not.toContain("nova A");
    expect(now).toContain("nova B");
    expect(now).toContain("linha 2\n");
    expect(now).toContain("linha perto do fim alterada");
  });
});

describe.skipIf(!hasGit)("arquivos CRLF", () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "polvo-crlf-"));
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(dir, "w.txt"), "a\r\nb\r\nc\r\nd\r\n");
    git("add", ".");
    git("commit", "-qm", "base");
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("inclui uma linha de um arquivo CRLF", () => {
    writeFileSync(join(dir, "w.txt"), "a\r\nB\r\nc\r\nd\r\nE\r\n");
    const [f] = parseDiff(git("diff"));
    const li = f.hunks[0].lines.findIndex((l) => l.text === "E\r");
    apply(buildPatch(f, new Set([lineKey(0, li)]), false)!, "--cached");
    const staged = git("diff", "--cached");
    expect(staged).toContain("+E");
    expect(staged).not.toContain("+B");
  });
});
