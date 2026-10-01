# Publicando uma versão

As atualizações automáticas usam o `tauri-plugin-updater`. Cada instalação consulta o
`latest.json` da release mais recente no GitHub e só aceita pacotes assinados com a
chave privada do projeto.

## Configuração única (mantenedores)

A chave pública já está em `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`).
A chave privada **nunca** vai para o repositório. Ela fica nos *secrets* do GitHub:

| Secret | Valor |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | conteúdo do arquivo da chave privada |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | senha da chave (vazia, se não houver) |

Para gerar um novo par de chaves (isso invalida as atualizações das versões já instaladas):

```powershell
pnpm tauri signer generate -w "$HOME\.tauri\polvo.key"
```

## Lançar uma versão (local, sem GitHub Actions)

1. `pnpm version:set 0.2.0` (atualiza `package.json`, `tauri.conf.json` e `Cargo.toml`).
2. Descreva a versão no `CHANGELOG.md` (seção `## 0.2.0`), que vira as notas da release.
3. Faça o commit e envie: `git commit -am "release: v0.2.0" && git push`.
4. `pnpm release` compila, assina com `~/.tauri/polvo.key`, gera o `latest.json` e publica a release `v0.2.0` com o `gh` (use `--draft` para rascunho).

Os apps instalados verificam atualizações ao abrir e a cada 6 horas (ou em Sobre → Procurar atualizações).

O workflow `.github/workflows/release.yml` faz o mesmo no GitHub Actions e pode ser disparado manualmente quando houver créditos.
