# Atualizações automáticas

O app se atualiza pelo GitHub Releases com o `tauri-plugin-updater`.

## Como funciona

- Na abertura e a cada 24 h (conferido de hora em hora, então vale mesmo com o app aberto direto), o app consulta o
  canal em silêncio (`src/lib/updater/updater.ts`, comando `update_check` em `src-tauri/src/updater.rs`).
- Versão mais nova (Semantic Versioning) habilita o botão **Atualizar** em Configurações > Atualizações e num aviso no
  canto da janela. Versão igual ou menor nunca é oferecida (o plugin e o front-end conferem).
- O download só começa com o clique. O pacote `.app.tar.gz` só é aceito se a assinatura minisign conferir com a chave
  pública do `tauri.conf.json`.
- No macOS, o app extraído é conferido (identificador, versão, `codesign --verify`) antes da troca. O app atual vai
  para `.<nome>.app.previous-<versão>` na mesma pasta; se a troca falhar, ele volta. A cópia anterior só é apagada
  quando a versão nova abre. Depois o app reinicia sozinho.
- Banco, anexos e backups ficam em `~/Library/Application Support/com.company.manager`, e preferências no WebKit do
  app, fora do `.app`. A atualização não mexe neles.

## Canais

| Canal | Tag | Endpoint | Quem recebe |
|---|---|---|---|
| Estável | `vX.Y.Z` (igual à versão do `tauri.conf.json`) | `releases/latest/download/latest.json` | Usuários, depois que alguém publica o rascunho |
| Teste | `vX.Y.Z-test.N` | release fixa `updater-test` | Só o app "Company Manager Teste" (`com.company.manager.updatetest`) |

A release `latest` do GitHub nunca é rascunho nem pre-release, então versões de teste não chegam ao canal estável. O
app de teste tem outro identificador, com banco e preferências próprios.

## Publicar

1. Suba a versão em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`. O workflow `.github/workflows/release.yml` compila, assina o pacote de
   atualização, gera o `latest.json` e deixa a release em **rascunho**.
3. Confira a release no GitHub e publique. A partir daí os apps instalados oferecem a atualização.

Para o canal de teste, use `vX.Y.Z-test.N`. O workflow publica a pre-release e atualiza a `updater-test` sozinho.

## Chave do atualizador

- Privada: `~/.tauri/company-manager-updater.key` no Mac do André (fora do repositório) e no segredo
  `TAURI_SIGNING_PRIVATE_KEY` do GitHub. Sem ela não dá para publicar atualizações que os apps instalados aceitem.
  Guarde uma cópia num cofre de senhas.
- Pública: `plugins.updater.pubkey` no `tauri.conf.json`.
- `npm run install:app` e `npm run dmg` leem a chave local (`scripts/updater-signing.sh`). Sem ela, o build segue sem o
  pacote de atualização.

## Assinatura Apple

O app usa assinatura ad-hoc (`signingIdentity: "-"`). Sem Developer ID e notarização, o macOS avisa
"desenvolvedor não identificado" ao abrir um DMG baixado. A atualização automática não passa por isso: o pacote é
baixado pelo próprio app, sem o atributo de quarentena.

## Teste de ponta a ponta

`scripts/updater-e2e.sh` instala uma versão inicial do app de teste numa pasta isolada, grava dados de controle no
banco dele, roda os cenários de falha contra um servidor local (sem atualização, versão inferior, falha de conexão,
pacote corrompido, download interrompido, falha de instalação) e depois atualiza de verdade pelo canal de teste do
GitHub, conferindo a versão nova rodando e os dados intactos. Veja o cabeçalho do script para o uso.
