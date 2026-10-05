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

Para gerar apenas o build local assinado, sem publicar uma release:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-signed.ps1
```

O script instala as dependências pelo lockfile, valida a chave privada contra a
chave pública configurada no app, roda os testes e gera os instaladores `.exe` e
`.msi` e suas assinaturas em
`src-tauri/target/x86_64-pc-windows-msvc/release/bundle/`. O
`build-manifest.json` registra o commit, os arquivos e seus hashes SHA-256. Se
`CARGO_TARGET_DIR` estiver configurado, o script usa esse diretório de saída.

A chave vem de `TAURI_SIGNING_PRIVATE_KEY` (conteúdo ou caminho), de
`~/.tauri/polvo.key`, ou do parâmetro `-SigningKeyPath C:\segredos\polvo.key`.
Para uma chave protegida, configure `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` na
sessão antes de executar. As variáveis originais são restauradas ao terminar e
nenhum segredo é salvo no repositório. `-SkipInstall` e `-SkipChecks` permitem
reaproveitar dependências ou omitir testes explicitamente.

Essa assinatura é a do **atualizador Tauri**. A assinatura de código Windows
(Authenticode) depende de um certificado e da configuração `bundle.windows`
do Tauri; o script não cria certificados nem substitui a chave existente.

Para distribuir as alterações pelo atualizador, use uma versão maior que a
última release e siga os passos abaixo.

Se os instaladores já foram gerados com o script PowerShell, publique-os após
fazer o commit e push da versão:

```powershell
pnpm release --no-build --bundle-dir src-tauri/target/x86_64-pc-windows-msvc/release/bundle
```

A publicação valida novamente as duas assinaturas e vincula a tag ao commit
atual. Apenas os instaladores, suas assinaturas e o `latest.json` são enviados;
o manifesto local de build permanece fora da release.

1. `pnpm version:set 0.2.0` (atualiza `package.json`, `tauri.conf.json` e `Cargo.toml`).
2. Descreva a versão no `CHANGELOG.md` (seção `## 0.2.0`), que vira as notas da release.
3. Faça o commit e envie: `git commit -am "release: v0.2.0" && git push`.
4. `pnpm release` compila, assina com `~/.tauri/polvo.key`, gera o `latest.json` e publica a release `v0.2.0` com o `gh` (use `--draft` para rascunho).

Os apps instalados verificam atualizações ao abrir e a cada 6 horas (ou em Sobre → Procurar atualizações).

O workflow `.github/workflows/release.yml` faz o mesmo no GitHub Actions e pode ser disparado manualmente quando houver créditos.
