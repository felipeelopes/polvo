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

## Lançar uma versão

1. Atualize a versão em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
2. Faça o commit e crie a tag:
   ```powershell
   git commit -am "release: v0.2.0"
   git tag v0.2.0
   git push && git push --tags
   ```
3. O workflow **Release** compila, assina e cria uma release **em rascunho** com os instaladores e o `latest.json`.
4. Revise as notas e clique em **Publish**. A partir daí, os apps instalados oferecem a atualização (verificação ao abrir e a cada 6 horas).
