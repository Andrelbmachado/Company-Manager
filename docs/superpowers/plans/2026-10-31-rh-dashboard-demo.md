# Notificações, Meu RH, Dashboard e modo demonstração cheio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comunicados viram notificações no menu da conta (e e-mail quando importantes), o Meu RH e o Dashboard ficam mais enxutos, o Assistente de IA abre dentro da sidebar e o modo demonstração preenche todas as telas e colunas.

**Architecture:** As notificações usam a tabela `notifications` que já existe (0001) e passam a ser gravadas por um módulo novo `src/lib/notifications/`; publicar um comunicado no RH grava uma notificação para cada conta da empresa e, se o comunicado for importante, uma linha numa fila de e-mail nova (migration 0014). Os seeds do modo demonstração deixam de depender só de flags (que podem ficar órfãs no banco do desktop) e passam a rodar de novo sempre que o app abre com o modo ligado, todos idempotentes (ids `dev-*` + `INSERT OR IGNORE`). O balanço do Dashboard ganha períodos (ano, mês, semana) trocados pelo título.

**Tech Stack:** Tauri 2, React 18, TypeScript, TanStack Query, Tailwind, Recharts, Vitest (SQLite real em `src/test/sqlite.ts`), Playwright.

**Spec:** mensagem do André na thread "Ajustar dashboard, RH e dados demo" (2026-10-31), resumida em "Requisitos" abaixo.

**Base:** branch `feat/rh-dashboard-demo` a partir de `feat/ajustes-telas-filtros` (PR #6 ainda aberto); o PR novo aponta para `feat/ajustes-telas-filtros`.

## Requisitos (do pedido)

1. R1 — Sem card de comunicados em nenhuma tela (Meu RH e qualquer setor). Comunicados viram **notificações** no botão da conta (rodapé da sidebar → Notificações). Se for importante, também vai por **e-mail**.
2. R2 — Meu RH: sem botão de calendário; "Minhas pendências" ocupa a largura toda, como "Minhas solicitações".
3. R3 — Modo demonstração: tudo populado, inclusive Meu RH (solicitações, pendências, tempo de empresa, pendências abertas, solicitações em análise), Ordens de serviço, Project Manager, Desenvolvimento de produtos.
4. R4 — Fornecedores com todas as colunas (nome fantasia, contato, categoria, avaliação, cidade, UF…); Financeiro com todas as colunas (categoria, centro de custo, documento, forma de pagamento, conta prevista, competência, emissão, parcelas, observações); Folha com algumas observações; balanço anual com mais movimento.
5. R5 — Documentos: sem o card "Arquivos na raiz"; caminho começando em "Raiz /" (dá para voltar até a raiz); sem a aba "Anexos de registros".
6. R6 — Assistente de IA abre **dentro** da sidebar (empurra os itens para baixo), não num menu suspenso flutuante.
7. R7 — Dashboard: o título "Balanço anual" troca para Balanço mensal e Balanço semanal; o semanal mostra o fluxo dos próximos 7 dias; sai o card "Fluxo dos próximos 7 dias".
8. R8 — Dashboard sem: "Itens abaixo do mínimo", "Últimas ações", "Atalhos", seção "Meu RH". Fica "Solicitações de RH a decidir".
9. Relatórios, Importar dados e Auditoria não mudam.

## Global Constraints

- Interface em pt-BR; textos novos seguem o tom das telas atuais.
- Seeds: ids fixos `dev-<área>-...`, `INSERT OR IGNORE`, SQL que o banco demo do navegador entende (ver `src/lib/dev/seedUtils.ts`), **nunca** tocar em `leads` (dados reais de prospecção do André).
- No desktop, dado de exemplo só se apoia em registro de exemplo (`isExampleRecord`), exceto o Meu RH da própria pessoa, que ganha registros `dev-*` (a limpeza apaga) sem alterar o cadastro dela.
- Migration nova é a `0014_notifications_email.sql`, registrada em `src-tauri/src/lib.rs`; o banco demo lê o schema das migrations (`demoSchema.ts`).
- Desligar o modo demonstração continua apagando tudo que é `dev-*`/`demo-*` (inclusive notificações e e-mails de exemplo).
- Atualizar `AGENTS.md` (tabela de módulos, §6b) no mesmo commit da mudança de comportamento.

## Review Focus

1. Banco do desktop com o modo já ligado antes desta versão (flags gravadas, dados de exemplo faltando): ao abrir o app, os dados que faltam aparecem sem a pessoa desligar e ligar o modo.
2. Conta cujo cadastro de colaborador é criado **depois** de ligar o modo (primeira visita ao Meu RH): o Meu RH dela já vem com solicitações e pendências de exemplo.
3. Colaborador sem data de admissão: "Tempo de empresa" mostra o tempo desde a criação da conta, não "—".
4. Comunicado publicado com o modo demonstração desligado: notifica as contas reais; nada de e-mail para conta sem e-mail; o comunicado não aparece como card em lugar nenhum.
5. Desligar o modo demonstração com iniciativas de produto da pessoa misturadas às de exemplo (guardadas no mesmo JSON de `settings`): só as `dev-*` somem.

---

### Task 1: Seeds do modo demonstração sempre completos (desktop e navegador)

Hoje o seed principal só roda sem a flag `seed.dev_data.v1` e os seeds de área só sem a flag deles; no desktop do André há telas vazias (OS, projetos, RH, balanço) com o modo ligado, o que bate com o seed principal não ter rodado. A correção não depende da causa exata: todos os seeds viram idempotentes sem flag de "já rodou" e rodam de novo ao abrir o app com o modo ligado.

**Files:**
- Modify: `src/lib/dev/devSeed.ts` (tirar o gate da flag; a flag continua gravada só como registro)
- Modify: `src/lib/dev/seeds/*.ts` (trocar `if (await hasSeedFlag(...)) return;` por idempotência de linha; seeds que fazem baixa/movimentação — `settlements`, `inventory` — continuam protegidos por id da movimentação, como `applyStockMovement` já faz)
- Modify: `src/lib/demo/demoMode.ts` (nova `refreshDemoData`)
- Modify: `src/app/App.tsx` (chamar `refreshDemoData` depois de `initDemoMode`, desktop e navegador)
- Test: `src/lib/demo/demoMode.test.ts`

**Interfaces:**
- Produces: `refreshDemoData(db: DatabaseLike, companyId: string): Promise<AreaSeedResult[]>` — se `isDemoMode`, roda `ensureDevAccounts` + `seedDevData`; senão não faz nada e devolve `[]`.

- [ ] **Step 1: Testes que falham** em `demoMode.test.ts`:
  - `it("refreshDemoData recompõe o que falta mesmo com as flags gravadas")`: liga o modo, apaga `work_orders`, `projects` e `employees` `dev-*`, chama `refreshDemoData` → `count(work_orders) >= 8`, `count(projects) >= 3`, `count(employees) > 0`; `leads` continua 0.
  - `it("refreshDemoData com o modo desligado não grava nada")`: snapshot antes = depois.
  - `it("ligar duas vezes não duplica")` continua passando.
- [ ] **Step 2:** `npx vitest run src/lib/demo/demoMode.test.ts` → FAIL (`refreshDemoData` não existe).
- [ ] **Step 3:** Implementar. Seed que precisa de base (`people`, `balance`) só grava quando a base existe, e como agora roda a cada abertura, a base criada depois é aproveitada.
- [ ] **Step 4:** `npx vitest run src/lib/demo src/lib/dev` → PASS.
- [ ] **Step 5:** Commit `fix(demo): dados de exemplo se recompõem ao abrir o app com o modo ligado`.

### Task 2: Seeds novos e colunas completas

**Files:**
- Create: `src/lib/dev/seeds/products.ts` (iniciativas de Desenvolvimento de produtos)
- Create: `src/lib/dev/seeds/operations.ts` (mais OS, com prazo, técnico, checklist e descrição; projetos com etapas e tarefas por etapa)
- Modify: `src/lib/dev/devSeed.ts` (fornecedores, contas a pagar/receber e documentos com todas as colunas)
- Modify: `src/lib/dev/seeds/purchasing.ts`, `finance.ts`, `balance.ts`, `hr.ts`
- Modify: `src/lib/demo/purge.ts` (tirar iniciativas `dev-*` do JSON `product_development.initiatives`)
- Test: `src/lib/dev/seedsDemo.test.ts`, `src/lib/demo/purge.test.ts`

**Interfaces:**
- Consumes: `refreshDemoData` (Task 1) para chegar aos bancos já ligados.
- Produces: `seed(companyId)` em `products.ts` e `operations.ts` (descobertos por `seeds/index.ts`).

Valores fixados:
- Fornecedores `dev-*`: todos com `trade_name`, `contact_name`, `category`, `rating` (1–5), `address_json` com `city` e `state` (UF de 2 letras), `notes`.
- Contas `dev-*` (pagar e receber): `category_id`, `cost_center_id`, `document_number`, `payment_method`, `bank_account_id`, `competence` (`AAAA-MM`), `issue_date`, `installment_number`/`installment_count`, `notes` — nenhuma coluna da tabela do Financeiro vazia.
- Folha: `notes` em pelo menos 5 colaboradores (ex.: "Reajuste de 6% em março", "Adicional de periculosidade").
- Balanço: de janeiro do ano até dezembro, 6 a 8 lançamentos por mês (hoje são 7), com meses no verde e no vermelho; o mês corrente com movimento em quase todos os dias úteis para o balanço mensal/semanal (Task 7) não ficar vazio; os próximos 7 dias com entradas e saídas em pelo menos 4 dias.
- Desenvolvimento de produtos: 8 iniciativas `dev-initiative-N`, 4 físicas e 4 digitais, status variados, responsável, próximo marco e data.
- OS: pelo menos 12, todas com prazo, técnico e custo; projetos: os 3 do seed principal ganham etapas com tarefas.

- [ ] **Step 1: Testes que falham** em `seedsDemo.test.ts` (SQLite real, modo ligado):
  - `it("fornecedores de exemplo têm todas as colunas da tabela")`: para cada `suppliers` `dev-*`, `trade_name`, `contact_name`, `category`, `rating`, `JSON.parse(address_json).city` e `.state` não vazios.
  - `it("contas de exemplo têm todas as colunas do Financeiro")`: idem para `payables`/`receivables` `dev-*` nas colunas acima.
  - `it("folha tem observações")`: `count(employee_compensation WHERE notes IS NOT NULL) >= 5`.
  - `it("desenvolvimento de produtos tem iniciativas")`: `loadInitiatives` → 8, físicas e digitais.
  - `it("balanço tem movimento em todos os meses e nos próximos 7 dias")`: `annualBalance` sem mês zerado; lançamentos em aberto em ≥ 4 dos próximos 7 dias.
  - em `purge.test.ts`: `it("desligar tira só as iniciativas de exemplo do JSON")`.
- [ ] **Step 2:** `npx vitest run src/lib/dev src/lib/demo` → FAIL.
- [ ] **Step 3:** Implementar os seeds e a limpeza.
- [ ] **Step 4:** Mesmo comando → PASS; `npx tsc --noEmit` limpo.
- [ ] **Step 5:** Commit `feat(demo): produtos, OS, fornecedores, financeiro, folha e balanço completos`.

### Task 3: Meu RH cheio e enxuto

**Files:**
- Create: `src/lib/dev/seeds/myHr.ts` com `seedMyHrDemo(companyId: string, employeeId: string): Promise<void>` (solicitações e pendências `dev-people-*-<employeeId>-N`, as mesmas de `people.ts`, que passa a reaproveitar esta função)
- Modify: `src/lib/hr/queries.ts` (`ensureMyEmployee`: com o modo ligado, chama `seedMyHrDemo` para o cadastro da pessoa)
- Modify: `src/modules/hr/pages/MyHrPage.tsx` (sem card de comunicados; "Minhas pendências" em largura total; "Tempo de empresa" cai para a data de criação da conta)
- Modify: `src/modules/hr/pages/HrManagePage.tsx` (sem `ViewSwitch` Lista/Calendário em Solicitações e Pendências: o Calendário já mostra tudo)
- Modify: `src/lib/hr/rules.ts` (`tenureLabel` sem mudança; quem chama passa `me.hire_date ?? session.user.created_at`)
- Test: `src/lib/hr/hr.demo.test.ts`, `src/modules/hr/pages/hrPages.test.tsx`

- [ ] **Step 1: Testes que falham:**
  - `hr.demo.test.ts` › `it("conta criada depois de ligar o modo ganha Meu RH de exemplo")`: liga o modo, cria uma conta nova, `ensureMyEmployee` → `fetchMyRequests` ≥ 4 (com pendente, aprovada e recusada) e `fetchMyHrTasks` ≥ 3 abertas.
  - `hrPages.test.tsx` › `it("Meu RH não mostra comunicados nem calendário")`: sem texto "Comunicados do RH", sem botão "Calendário"; a seção "Minhas pendências" não está dentro de grid de duas colunas.
  - `hrPages.test.tsx` › `it("tempo de empresa usa a criação da conta sem data de admissão")`: valor diferente de "—".
- [ ] **Step 2:** `npx vitest run src/lib/hr src/modules/hr` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Mesmo comando → PASS.
- [ ] **Step 5:** Commit `feat(rh): Meu RH sem comunicados e calendário, pendências em largura total e demo cheio`.

### Task 4: Notificações no menu da conta (comunicados viram notificações)

**Files:**
- Create: `src-tauri/migrations/0014_notifications_email.sql` (`ALTER TABLE notifications ADD COLUMN title TEXT; ADD COLUMN important INTEGER NOT NULL DEFAULT 0; ADD COLUMN link TEXT`; tabela `email_outbox (id, company_id, notification_id, to_email, subject, body, status 'pendente'|'enviado'|'cancelado', created_at, sent_at)`) + registro em `src-tauri/src/lib.rs`
- Create: `src/lib/notifications/notifications.ts`
- Create: `src/app/layout/NotificationsPanel.tsx` (lista dentro do menu da conta, sai o exemplo fixo de `AccountMenu.tsx`)
- Modify: `src/app/layout/AccountMenu.tsx`, `src/modules/hr/pages/HrManagePage.tsx` (coluna "Importante" no comunicado; salvar chama `notifyAnnouncement`), `src/types/index.ts`
- Modify: `src/lib/dev/seeds/hr.ts` (notificações de exemplo para as contas: comunicados, solicitação aprovada, pendência nova)
- Test: `src/lib/notifications/notifications.test.ts`, `src/app/layout/AppShell.test.tsx`

**Interfaces:**
- Produces:
  - `notifyUsers(db, companyId, input: { userIds: string[]; type: string; title: string; message: string; link?: string; important?: boolean; refType?: string; refId?: string }): Promise<string[]>` — grava uma notificação por conta; se `important`, também uma linha em `email_outbox` por conta com e-mail.
  - `notifyAnnouncement(db, companyId, announcement: HrAnnouncement & { important?: number }): Promise<void>` — todas as contas ativas da empresa (`memberships`).
  - `listNotifications(db, companyId, userId, limit = 20): Promise<Notification[]>`, `unreadCount(...)`, `markRead(db, companyId, userId, id?)` (sem id = todas).
  - Query key `["notifications", companyId, userId]`, `refetchInterval: 60_000`.
- Também notificam (mesmo `notifyUsers`): decisão de solicitação de RH (para o colaborador) e pendência nova do RH (para o colaborador).

- [ ] **Step 1: Testes que falham** (`notifications.test.ts`, SQLite real):
  - `it("comunicado notifica todas as contas da empresa")`.
  - `it("comunicado importante põe e-mail na fila só para quem tem e-mail")`.
  - `it("marcar como lida zera o contador só da pessoa")`.
  - `AppShell.test.tsx` › `it("menu da conta lista as notificações do banco e marca como lidas")`.
- [ ] **Step 2:** `npx vitest run src/lib/notifications src/app/layout` → FAIL.
- [ ] **Step 3:** Implementar. No painel: título em negrito, mensagem, "há X" e o selo "Importante"; clicar marca como lida e abre `link` (comunicado → `/hr`).
- [ ] **Step 4:** Mesmo comando → PASS; `npx vitest run src/lib/db` (schema demo lê a 0014) → PASS.
- [ ] **Step 5:** Commit `feat(notificacoes): comunicados e avisos do RH no menu da conta, importantes na fila de e-mail`.

### Task 5: Envio dos e-mails importantes

Escopo depende da decisão do André (cartão na thread). Recomendado: **fila + app de e-mail** agora; SMTP depois.

**Files:**
- Create: `src/modules/settings/components/EmailOutboxCard.tsx` (Configurações → Notificações: e-mails pendentes, "Enviar pelo app de e-mail" abre `mailto:` com os destinatários em Cco, depois marca como enviado; "Descartar")
- Modify: `src/modules/settings/pages/SettingsPage.tsx`
- Test: `src/modules/settings/emailOutbox.test.tsx`

- [ ] **Step 1:** Teste que falha: `it("agrupa os pendentes do mesmo comunicado num mailto com Cco e marca enviados")` — `href` começa com `mailto:?bcc=` e contém os e-mails; depois do clique, `status = 'enviado'`.
- [ ] **Step 2:** `npx vitest run src/modules/settings` → FAIL.
- [ ] **Step 3:** Implementar `buildMailto(rows: EmailOutboxRow[]): string` em `src/lib/notifications/email.ts` e o card.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(notificacoes): fila de e-mails importantes com envio pelo app de e-mail`.

### Task 6: Documentos sem "Arquivos na raiz" e sem "Anexos de registros"

**Files:**
- Modify: `src/modules/documents/pages/DocumentsPage.tsx` (sem `TabList`; só `DocumentFolders`)
- Modify: `src/modules/documents/components/FolderBrowser.tsx` (na raiz não renderiza a `EditableTable`; caminho começa com o botão "Raiz /" e segue com as pastas; dentro de uma pasta a tabela fica com o título `Arquivos em /<caminho>`)
- Modify: `src/modules/documents/components/CloudFolderBrowser.tsx` (mesmo "Raiz /")
- Delete: `src/modules/documents/components/AttachmentsBrowser.tsx` (só se nada mais importa)
- Test: `src/modules/documents/pages/DocumentsPage.test.tsx`

- [ ] **Step 1:** Testes que falham: `it("raiz sem tabela de arquivos e sem aba de anexos")`; `it("caminho Raiz / Financeiro / volta para a raiz")`.
- [ ] **Step 2:** `npx vitest run src/modules/documents` → FAIL.
- [ ] **Step 3:** Implementar. Arquivos soltos na raiz (de versões antigas) continuam acessíveis pela busca.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(documentos): raiz só com pastas, caminho a partir de Raiz e sem aba de anexos`.

### Task 7: Dashboard enxuto e balanço por período

**Files:**
- Modify: `src/lib/dashboard/finance.ts` — `export type BalancePeriod = "ano" | "mes" | "semana"`; `balanceSeries(db, companyId, period: BalancePeriod, today: string): Promise<BalancePoint[]>` com `BalancePoint = { key: string; label: string; realizado: number | null; acumulado: number | null; previsto: number; entradas?: number; saidas?: number }`. Ano = `annualBalance` atual; mês = dias do mês (realizado até hoje, previsto depois); semana = hoje + 6 dias, com `entradas`/`saidas` em aberto por dia (a mesma conta do `fin.cashflow7`).
- Modify: `src/modules/dashboard/components/BalanceChart.tsx` — título é um botão-menu ("Balanço anual ▾") com as 3 opções; semana desenha barras de entradas/saídas + linha do saldo; a escolha fica em `localStorage` (`cm.dashboard.balancePeriod`).
- Modify: `src/lib/labels/profiles.ts` (`dashboard.balance_chart_month` "Balanço mensal", `dashboard.balance_chart_week` "Balanço semanal")
- Modify: `src/lib/dashboard/roleHomes.ts` — tirar `fin.cashflow7`, `inv.belowMin`, `audit.recent` e todos os `shortcut` das homes; tirar `PERSONAL` (Meu RH) da home. Manter `hr.pendingRequests`.
- Modify: `src/modules/dashboard/pages/DashboardPage.tsx` (sem seções Atalhos e Meu RH), `HomeWidgets.tsx` (`HomeShortcuts` sai se ficar sem uso)
- Test: `src/lib/dashboard/finance.test.ts`, `roleHomes.test.ts`, `src/modules/dashboard/pages/DashboardPage.test.tsx`, `BalanceChart.test.tsx`

- [ ] **Step 1:** Testes que falham:
  - `finance.test.ts` › `it("balanceSeries semana: 7 dias a partir de hoje com entradas e saídas em aberto")`, `it("balanceSeries mês: um ponto por dia do mês")`.
  - `roleHomes.test.ts` › `it("nenhuma home tem fluxo de 7 dias, abaixo do mínimo, últimas ações, atalhos ou Meu RH")` e `it("RH e CEO continuam com Solicitações de RH a decidir")`.
  - `BalanceChart.test.tsx` › `it("clicar no título troca para Balanço mensal e semanal")`.
- [ ] **Step 2:** `npx vitest run src/lib/dashboard src/modules/dashboard` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(dashboard): balanço anual, mensal e semanal no título e home sem cards repetidos`.

### Task 8: Assistente de IA dentro da sidebar

**Files:**
- Modify: `src/app/layout/AssistantLauncher.tsx` — com a sidebar aberta, a lista (Nova conversa + Recentes) abre **em fluxo** logo abaixo do botão (sem `absolute`, sem sombra, recuada como subitens), empurrando a navegação; não fecha ao clicar fora (fecha no próprio botão ou ao abrir uma conversa). Com a sidebar no trilho continua o menu flutuante ao lado.
- Test: `src/app/layout/Sidebar.test.tsx`

- [ ] **Step 1:** Teste que falha: `it("assistente abre dentro da sidebar e empurra o Dashboard para baixo")` — `#assistant-menu` sem classe `absolute` e o link Dashboard depois dele no fluxo.
- [ ] **Step 2:** `npx vitest run src/app/layout` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(sidebar): conversas do assistente abrem dentro da sidebar`.

### Task 9: Verificação, documentação e PR

- [ ] `npx tsc --noEmit` e `npm test` → tudo verde.
- [ ] E2E no navegador (config temporária com `executablePath: "/opt/pw-browsers/chromium"`): login Admin com o modo ligado, prints de Dashboard (3 períodos), Meu RH, Gestão de RH, OS, Project Manager, Desenvolvimento de produtos, Fornecedores, Financeiro, Folha, Documentos, menu da conta com notificações e assistente aberto.
- [ ] `AGENTS.md` (tabela de módulos e §6b: notificações, fila de e-mail, `refreshDemoData`), `docs/QA.md`.
- [ ] PR para `feat/ajustes-telas-filtros`.
