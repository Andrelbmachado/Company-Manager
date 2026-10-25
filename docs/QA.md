# QA — Company Manager

Roteiro de verificação do app (navegador e app instalado) e o resultado da última rodada. Comandos e convenções gerais
estão no `AGENTS.md` (§3); este arquivo diz **o que** conferir e **o que já foi conferido**.

## 1. Automático

| O quê | Comando | Onde roda |
|---|---|---|
| Typecheck | `npm run typecheck` | tsc |
| Unidade e componente (SQLite real) | `npm test` | vitest |
| Build | `npm run build` | tsc + vite |
| Backend Rust | `cd src-tauri && cargo test --lib` | cargo |
| E2E do redesign | `npm run test:e2e` (ou `E2E_PORT=1431 npm run test:e2e` se a 1420 estiver ocupada) | Playwright + Chromium, banco demo |

`e2e/redesign.spec.ts` (Tarefa 11 do plano `docs/superpowers/plans/2026-10-25-redesign-modular.md`):

1. **Shell sem top bar:** nenhum `banner`; na sidebar, Buscar acima de Assistente de IA, acima do Dashboard, acima do botão da conta; `main` começa no topo e tem a altura da janela; Buscar abre a busca.
2. **Menu da conta:** switch "Tema escuro" liga/desliga a classe `dark`; Notificações abre a lista e "Marcar todas como lidas" zera o contador.
3. **Clientes (CRM):** Editar → muda o Segmento da 1ª linha → Atualizar pergunta (alterações não salvas) e "Cancelar" mantém o rascunho → Salvar ("1 linha salva.") → Atualizar mostra o valor → recarregar a página mantém o valor.
4. **Sem permissão (Auditoria em Financeiro):** Editar e Adicionar desativados com dica de permissão em toda tabela visível; Atualizar ativo.
5. **Dashboard:** 4 cards no resumo, cada um só com título + número; gráfico do balanço com 3 linhas (a 3ª tracejada) e legenda Resultado do mês / Acumulado no ano / Previsão de receita.
6. **Login rápido nas 11 áreas:** cada área abre todos os módulos da sidebar e todas as abas visíveis sem erro de página, de console ou alerta na tela, e a sidebar continua na tela enquanto a página carrega.
7. **Calendário com fixture iCal:** duas agendas adicionadas na tabela (uma servida com `src/lib/calendar/fixtures/google-semanal.ics`, outra respondendo 404); a boa fica "Sincronizada", a outra mostra o erro e o aviso "1 agenda com erro"; no mês (outubro de 2026) aparecem as 4 reuniões semanais às 09:00, o feriado de dia inteiro e a call das 17:00 UTC às 14:00 de São Paulo.

## 2. App instalado (`npm run install:app`)

`npm run install:app` compila, fecha o app aberto, troca `/Applications/Company Manager.app` e apaga a cópia do build.
Depois, confira que sobrou uma cópia só: `mdfind "kMDItemFSName == 'Company Manager.app'"` → só `/Applications/Company Manager.app`, e nenhum `.dmg` (`mdfind -name .dmg | grep -i company` vazio).

### 2a. Teste de fumaça sem tocar no banco real

O app instalado, aberto normalmente, usa `~/Library/Application Support/com.company.manager/company-manager.db` (dados do André). Para testar sem mexer nele, com o app fechado:

```bash
T=$(mktemp -d); H="$T/home/Library/Application Support/com.company.manager"; mkdir -p "$H"
cp ~/Library/Application\ Support/com.company.manager/company-manager.db "$H/"   # cópia; o original não é aberto
HOME="$T/home" CFFIXED_USER_HOME="$T/home" "/Applications/Company Manager.app/Contents/MacOS/company-manager" & PID=$!
lsof -p $PID | grep company-manager.db        # tem de apontar para $T, nunca para ~/Library
sqlite3 "$H/company-manager.db"   # é a cópia; -readonly falha em WAL sem o -shm "SELECT max(version) FROM _sqlx_migrations; SELECT value_json FROM settings WHERE key='demo_mode'; SELECT count(*) FROM leads;"
kill $PID; rm -rf "$T"
```

Num banco que já tem empresa, o app aplica as migrations logo ao abrir (o `App.tsx` do desktop chama `initDemoMode`, a conversão de senhas e o backup diário na partida), então dá para conferir sem clicar em nada.

### 2b. Só clicando na janela do app (manual)

- Login rápido nas 11 áreas (botões nas laterais da tela de login) e abrir os módulos de cada uma.
- Configurações › Modo demonstração: ligar (dados de exemplo aparecem nos módulos) e desligar (somem; leads e o que foi cadastrado ficam).
- Documentos › Conectar nuvem: escolher uma pasta do iCloud Drive no seletor nativo, listar, abrir e enviar um arquivo.
- Calendário › Agendas conectadas: colar um link iCal real (Google Agenda, "Endereço secreto no formato iCal") e ver os eventos (no app o link vai pelo plugin HTTP, sem CORS); Exportar agenda da empresa (diálogo nativo de salvar).
- Exclusões: o diálogo nativo `ask` pergunta antes de apagar.

## 3. Última rodada — 2026-10-25 (Tarefa 11 do redesign, branch `feat/crm-erp-completo`)

**Passou**
- `npm run typecheck`, `npm test` (206 arquivos, 1510 testes), `npm run build`.
- E2E: os 7 cenários acima, verdes no Chromium (`E2E_PORT=1431`, porque a 1420 estava ocupada por um `vite` aberto havia 3 dias, anterior à migration 0012).
- `npm run install:app`: app reinstalado em `/Applications`; `mdfind` só encontra `/Applications/Company Manager.app`; nenhum `.dmg` sobrando (nem `dist-installers/`, `~/cm-target/release/bundle/{macos,dmg}`, Desktop ou Downloads).
- Fumaça com cópia do banco real (2a): o app abriu com `HOME` temporário (`lsof` mostrou só o banco da cópia; o arquivo real ficou com a mesma data e tamanho), aplicou as migrations até a **0012** (`_sqlx_migrations` 1–12, todas com sucesso), gravou `demo_mode = false` e a limpeza da primeira abertura apagou todas as linhas de exemplo (`dev-*`/`demo-*`) de 56 tabelas, menos `companies`, `users` e `memberships` (fora da limpeza por regra). Ficaram os **155 leads** (todos na campanha "Prospecção 1", `prospeccao-1-demo-company-0001`), os pacotes/preços/cenários/previsão, o projeto "Desenvolvimento de Site" com 5 etapas e 10 tarefas, 1 atividade e o `seed.site_prospecting.v3`; `PRAGMA foreign_key_check` vazio. Só a instância aberta para o teste foi encerrada e a pasta temporária foi apagada.
- Modo demonstração ligado e desligado numa cópia do banco já migrado pelo app, pelo `changeDemoMode` (o mesmo que o switch chama; teste vitest temporário com `better-sqlite3` sobre a cópia, apagado depois): ligar gravou **443** linhas de exemplo sem falha em nenhum seed (ligar de novo: 0); desligar apagou as **443**, sem nenhuma retida por referência, `demo_mode` voltou a `false`, os 155 leads e o projeto real ficaram e `PRAGMA foreign_key_check` ficou vazio. Sobram 25 linhas com id de exemplo: a empresa e as 12 contas + 12 vínculos (fora da limpeza por regra).
- Repetido depois da reinstalação final (com as duas correções abaixo): mesmo resultado na fumaça (migrations 1–12, `demo_mode = false`, 155 leads, nenhum cliente de exemplo).

**Corrigido nesta rodada**
- `fix(dashboard)`: no primeiro login o seed de prospecção cria o projeto "Desenvolvimento de Site" depois que o Dashboard já carregou e o card "Projetos ativos" ficava com um a menos até recarregar (`useProspectingBootstrap` agora invalida `dashboard-kpis`).
- `fix(shell)`: o Suspense das rotas ficava fora do `AppShell`; na primeira visita a cada módulo o carregando cobria a janela toda e a sidebar sumia até a página chegar. Agora a página carrega dentro da casca (`[data-page-loading]` só no conteúdo).

**Não testado sem clicar na interface** (fica para o André, roteiro em 2b): login rápido nas 11 áreas **no app instalado** (no navegador foi coberto pelo E2E 6), o switch do modo demonstração na tela, conectar pasta do iCloud Drive (seletor nativo), agenda por link real pelo plugin HTTP e os diálogos nativos (salvar `.ics`, confirmar exclusão).

**Observações**
- O banco do André tem a empresa com id `demo-company-0001` ("Empresa Demo Ltda."). A limpeza não apaga `companies`, então ela fica; o que ela tem de real (leads, prospecção) também.
- As 12 contas de exemplo (`users`/`memberships` com id `dev-*`/`demo-*`) continuam, por regra (`DEMO_EXCLUDED_TABLES`); a senha delas não entra por login normal.
- Ao encerrar o app com `kill` o SQLite deixa o `-wal` ao lado do banco (normal; o próximo `open` aplica). Fechando pelo menu (⌘Q) isso não importa.
- No banco demo do navegador a linha tracejada "Previsão de receita" de novembro cai para −R$ 26.400: é o resultado líquido previsto da Tarefa 4 (a receber − a pagar em aberto no mês + recorrências), e confere com os dados de exemplo (R$ 39.540 a receber − R$ 53.890 a pagar − R$ 12.050 de recorrências). Não é receita bruta; se o rótulo confundir, ele se troca em Configurações › Área da empresa (`dashboard.balance_forecast`).
