import { describe, expect, it } from "vitest";
import { buildPatch, hunkSelection, lineKey, parseDiff } from "../src/git/diff";

const DIFF = `diff --git a/app.ts b/app.ts
index 1111111..2222222 100644
--- a/app.ts
+++ b/app.ts
@@ -1,4 +1,5 @@ class App
 a
-b
+B
+C
 c
 d
@@ -10,2 +11,3 @@
 x
+y
 z
`;

describe("parseDiff", () => {
  it("lê trechos, linhas e números", () => {
    const [f] = parseDiff(DIFF);
    expect(f.newPath).toBe("app.ts");
    expect(f.hunks).toHaveLength(2);
    expect(f.added).toBe(3);
    expect(f.removed).toBe(1);
    expect(f.hunks[0].section).toBe("class App");
    expect(f.hunks[0].lines[1]).toMatchObject({ kind: "-", text: "b", old: 2, new: null });
    expect(f.hunks[0].lines[3]).toMatchObject({ kind: "+", text: "C", old: null, new: 3 });
    expect(f.hunks[1].lines[1]).toMatchObject({ kind: "+", text: "y", new: 12 });
  });

  it("marca o fim de arquivo sem quebra de linha", () => {
    const [f] = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n");
    expect(f.hunks[0].lines[0].noEol).toBe(true);
    expect(f.hunks[0].lines[1].noEol).toBeFalsy();
  });

  it("reconhece binários e arquivos novos", () => {
    const [f] = parseDiff("diff --git a/img.png b/img.png\nnew file mode 100644\nBinary files /dev/null and b/img.png differ\n");
    expect(f.binary).toBe(true);
    const [g] = parseDiff("diff --git a/n.ts b/n.ts\nnew file mode 100644\n--- /dev/null\n+++ b/n.ts\n@@ -0,0 +1,2 @@\n+1\n+2\n");
    expect(g.oldPath).toBeNull();
    expect(g.hunks[0].lines).toHaveLength(2);
  });
});

describe("buildPatch", () => {
  const [f] = parseDiff(DIFF);

  it("inclui só uma linha adicionada", () => {
    const patch = buildPatch(f, new Set([lineKey(0, 3)]), false)!;
    // "-b" vira contexto, "+B" sai, "+C" fica.
    expect(patch).toContain("@@ -1,4 +1,5 @@ class App\n a\n b\n+C\n c\n d\n");
    expect(patch).not.toContain("@@ -10");
  });

  it("desloca o segundo trecho pelo saldo do primeiro", () => {
    const sel = new Set([...hunkSelection(f, 1)]);
    expect(buildPatch(f, sel, false)).toContain("@@ -10,2 +10,3 @@");
    sel.add(lineKey(0, 2)).add(lineKey(0, 3));
    expect(buildPatch(f, sel, false)).toContain("@@ -10,2 +12,3 @@");
  });

  it("monta o patch para aplicar ao contrário", () => {
    // Tirar só o "+C": "+B" vira contexto e "-b" some.
    const patch = buildPatch(f, new Set([lineKey(0, 3)]), true)!;
    expect(patch).toContain("@@ -1,4 +1,5 @@ class App\n a\n B\n+C\n c\n d\n");
  });

  it("nada escolhido → null", () => {
    expect(buildPatch(f, new Set(), false)).toBeNull();
  });
});
