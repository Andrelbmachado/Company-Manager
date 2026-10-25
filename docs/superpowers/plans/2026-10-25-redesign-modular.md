# Company Manager — Redesign modular (dashboard, shell, edição na tabela, calendário, nuvem, modo demo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o app monocromático, modular (serve para TI, advocacia etc.), com shell novo (sem top bar), dashboard financeiro, edição direto na tabela em todo o app, calendário conectado e visual de calendário para tudo que é cronograma, nuvem nos documentos e modo demo.

**Architecture:** Fase A cria as peças compartilhadas (tema, shell, `EditableTable`, `CalendarView`, `KpiCard`/abas, perfil de área com rótulos, migration 0012) num único agente sequencial, porque tocam arquivos compartilhados. Fase B aplica as peças por módulo em worktrees paralelos (pastas disjuntas). Fase C integra, testa no app instalado e reinstala.

**Tech Stack:** o atual (Tauri 2, React 18, TS, Tailwind, TanStack Query/Table, recharts, zod, vitest + SQLite real). Novo: `ical.js` (ler/gerar iCal). Nada de backend: integrações usam o que roda local (links iCal, pastas sincronizadas).

**Spec:** pedido do André em 2026-10-25 (thread do projeto, "alterações"), resumido item a item na seção "Cobertura" no fim. Base técnica: `AGENTS.md` e o plano anterior `2026-10-24-company-manager-completion.md` (regras de execução 1–4 continuam valendo).

## Global Constraints

- Pré-requisito: os branches `task/t1-dmg`, `task/t5-import`, `task/t6-docs`, `task/t7-crm`, `task/t8a-vendas-compras`, `task/t8b-financeiro`, `task/t8c-estoque`, `task/t9-setores`, `task/t10-ops` já juntados em `feat/crm-erp-completo` (Tarefa 0). Sem isso, as telas reais de CRM/ERP ainda são páginas provisórias.
- UI 100% pt-BR. Cores só por tokens. Tema monocromático: fundo do app cinza puro escuro, sidebar cinza mais escuro; nenhuma cor de destaque (o azul `primary` vira cinza claro). Cor só onde é estado (sucesso/erro/alerta).
- Nenhuma edição de dado abre modal ou painel lateral: edição acontece na própria tabela ou no próprio lugar onde o dado aparece. `CrudDialog` e `DetailDrawer` deixam de ser usados para editar (o arquivo pode ficar só para confirmações).
- Toda tabela de dados tem os botões **Editar**, **Adicionar** e **Atualizar**; Editar/Adicionar respeitam `can(role, "edit"|"create", resource)`.
- Todo card no topo de tela mostra só título + número grande (nada de texto embaixo do número).
- Tudo que é cronograma/agenda aparece em `CalendarView` (mês/semana/dia, visual do Google Agenda).
- Títulos de cards, gráficos e módulos vêm do perfil de área (`labels`), editáveis em Configurações.
- Migrations 0001–0011 não se editam; nova: `0012_redesign_modular.sql`.
- Leads e prospecção são dados reais: nenhum seed, limpeza ou modo demo toca a tabela `leads`.
- Verificação de cada tarefa: `npm run typecheck && npm test && npm run build`; commits em português, sem push.

## Review Focus

1. Sair do modo demo com dados reais criados enquanto ele estava ligado — esperado: só somem linhas de demonstração (id `dev-*`/`demo-*`), o que o usuário criou fica; leads nunca somem.
2. Editar várias células e clicar em Atualizar antes de Salvar — esperado: o app avisa que há alterações não salvas e não as perde em silêncio.
3. Valor digitado em formato brasileiro na célula (`1.234,56`, `31/12/2025`) — esperado: salva o número/data certo, nunca `NaN` ou data invertida; reaproveita `normalizeValue` da Tarefa 5 anterior.
4. Link iCal inválido, fora do ar ou com eventos recorrentes/fuso — esperado: erro legível na fonte, outras fontes continuam; recorrência e fuso de São Paulo corretos.
5. Papel sem permissão de edição — esperado: botões Editar/Adicionar aparecem desativados com dica, e o salvamento também é barrado na camada de dados.

---

### Task 0: Juntar os branches das tarefas (precisa do "sim" do André)

**Files:** nenhum novo; resolve conflitos em `AGENTS.md`, `src/lib/dev/devSeed.ts`, `src-tauri/Cargo.*`.

- [x] **Step 1:** `git merge --no-ff` de cada branch listado em Global Constraints, nesta ordem: t1, t5, t6, t7, t8a, t8b, t8c, t9, t10.
- [x] **Step 2:** Resolver os `TODO(integração)` deixados pelos agentes: `ImportExportButtons` e `FileAttachments` reais nas telas; 8a usa `recordStockMovement` (8c) e `createPurchaseOrder`; importador de estoque passa pelo motor de estoque; DRE única (8b) usada por relatórios (T10); `employeeImportEntity` (T9) registrado no registry (T5); confirmações de exclusão com `ask()` do `@tauri-apps/plugin-dialog` em vez de `window.confirm` (bug no desktop: apagava sem perguntar).
- [x] **Step 3:** `npm run typecheck && npm test && npm run build` e `cargo test --lib` em `src-tauri` → tudo verde. Commit `merge: integra as tarefas 1 e 5–10`.

### Task 1: Tema monocromático, shell sem top bar, conta e assistente na sidebar

**Files:**
- Modify: `src/index.css` (tokens claro/escuro), `tailwind.config.js`, `src/app/layout/AppShell.tsx` (remove `<header>`), `src/app/layout/Sidebar.tsx`, `src/app/layout/CommandMenu.tsx`
- Create: `src/app/layout/AccountMenu.tsx`, `src/app/layout/AssistantLauncher.tsx`, `src/app/layout/SidebarSearch.tsx`, `src/lib/assistant/conversations.ts` (+ teste)

**Interfaces:**
- Produces: `listConversations(userId): Promise<Conversation[]>`, `createConversation(userId, title?): Promise<string>`, `appendMessage(conversationId, author: "user"|"assistant", text): Promise<void>`, `getMessages(conversationId): Promise<Message[]>` (tabelas da Tarefa 2).
- Produces: rota `/assistant/:conversationId?` (AssistantPage passa a ler/gravar a conversa; mesmo cliente de IA de hoje, `requestAssistantReply`).

Ordem da sidebar, de cima para baixo: logo → **busca** (abre o `CommandMenu`, atalho ⌘K) → **Assistente de IA** (dropdown: "Nova conversa" + últimas conversas do usuário, cada uma abre `/assistant/:id`) → **Dashboard** e o resto da navegação → rodapé com o **botão da conta** no lugar onde hoje fica o assistente. Dropdown da conta: nome/papel, Configurações da conta, Notificações (lista que hoje está na top bar, com contador), switch **Tema escuro**, Suporte, Trocar usuário, Sair.

Tokens (escuro, padrão): `--background: 0 0% 11%`, `--card: 0 0% 14%`, `--sidebar: 0 0% 7%`, `--border: 0 0% 20%`, `--primary: 0 0% 92%`, `--primary-foreground: 0 0% 9%`, `--muted-foreground: 0 0% 62%`. Claro: mesma escala invertida, sidebar `0 0% 93%`, fundo `0 0% 97%`. Saturação 0 em tudo que não for estado.

- [x] **Step 1:** Teste `conversations.test.ts` (SQLite real): criar conversa, gravar 2 mensagens, `listConversations` traz a conversa com a mais recente primeiro e só do próprio usuário.
- [x] **Step 2:** Teste de componente `AppShell.test.tsx`: não existe `banner`/`header`; sidebar tem botão "Buscar", botão "Assistente de IA" acima do link "Dashboard" e botão da conta por último; abrir a conta mostra switch "Tema escuro" e "Notificações".
- [x] **Step 3:** FAIL → implementar → PASS. Conferir no navegador (`npm run dev`, banco demo) que a área de conteúdo ocupa a altura toda.
- [x] **Step 4:** Commit `feat(shell): tema monocromático, busca, assistente e conta na sidebar, sem top bar`.

### Task 2: Migration 0012, perfil de área e rótulos editáveis

**Files:**
- Create: `src-tauri/migrations/0012_redesign_modular.sql`, `src/lib/labels/{profiles.ts,useLabel.ts}` (+ teste)
- Modify: `src-tauri/src/lib.rs` (version 12), `src/lib/db/demo.ts` (`EXTRA_TABLES`), `src/types/index.ts`, `src/modules/settings/pages/SettingsPage.tsx` (aba "Área da empresa")

**Tabelas (0012):** `assistant_conversations(id, company_id, user_id, title, created_at, updated_at, deleted_at)`, `assistant_messages(id, conversation_id, author, text, created_at)`, `calendar_sources(id, company_id, name, kind[ical|local], url, color, last_sync_at, last_error, created_at, updated_at, deleted_at)`, `calendar_events(id, company_id, source_id, uid, title, starts_at, ends_at, all_day, location, user_id, kind[ausencia|reuniao|externo|...], created_at, updated_at, deleted_at)`, `cloud_folders(id, company_id, provider[icloud|gdrive|onedrive|dropbox|outro], label, local_path, created_at, deleted_at)`, `prospecting_campaigns(id, company_id, name, created_at, updated_at, deleted_at)` e `leads.campaign_id` (`ALTER TABLE ADD COLUMN`; leads existentes vão para uma campanha "Prospecção 1", renomeável).
**Perfil de área:** chave `company.area_profile` em `settings` (`ti` | `advocacia` | `servicos` | `comercio` | `personalizado`) e `company.labels` (JSON sobrescrevendo rótulos).

**Interfaces:**
- Produces: `LABEL_KEYS` (`dashboard.active_work`, `dashboard.profit`, `dashboard.payables_week`, `dashboard.receivables_week`, `dashboard.balance_chart`, `module.projects`, ...), `labelFor(key, profile, overrides): string`, hook `useLabel(key): string`.
- Exemplo fixo: `labelFor("dashboard.active_work", "ti", {}) === "Projetos ativos"`; `"advocacia"` → `"Clientes ativos"` (no sentido de processos/casos em andamento).

- [x] **Step 1:** Teste schema: aplicar 0012 com `createTestDb()`; leads antigos ficam com `campaign_id` da campanha criada; `PRAGMA foreign_key_check` vazio.
- [x] **Step 2:** Teste `profiles.test.ts`: os exemplos acima; override vence o perfil; chave desconhecida devolve a própria chave (nunca vazio).
- [x] **Step 3:** FAIL → implementar (migration, `lib.rs`, demo, tipos, aba em Configurações com seletor de área e tabela editável de rótulos) → PASS.
- [x] **Step 4:** Commit `feat(config): perfil de área com rótulos editáveis e migration 0012`.

### Task 3: Componentes base — `EditableTable`, `CalendarView`, cards e abas

**Files:**
- Create: `src/components/shared/EditableTable.tsx`, `src/components/shared/editable/{cellEditors.tsx,useRowDrafts.ts}`, `src/components/shared/CalendarView.tsx`, `src/components/shared/calendar/{layout.ts,MonthGrid.tsx,WeekGrid.tsx}` (+ testes)
- Modify: `src/components/shared/KpiCard.tsx`, `src/components/shared/StatCard.tsx`, `src/app/layout/ModuleNav.tsx`, `src/components/shared/Tabs.tsx`

**Interfaces:**
- Produces:
```ts
type ColumnKind = "text" | "number" | "money" | "date" | "select" | "bool" | "email" | "phone";
interface EditableColumn<T> { key: keyof T & string; header: string; kind: ColumnKind; options?: { value: string; label: string }[]; readOnly?: boolean; width?: number }
interface EditableTableProps<T extends { id: string }> {
  resource: Resource; rows: T[]; columns: EditableColumn<T>[];
  onSave(changes: { updated: Partial<T>[] & { id: string }[]; created: Partial<T>[] }): Promise<void>;
  onRefresh(): Promise<unknown>; newRow?: () => Partial<T>; loading?: boolean;
}
```
  Barra: **Editar** (liga o modo edição; células viram campos), **Adicionar** (linha nova no topo, já em edição), **Atualizar** (refaz a consulta; com rascunhos pendentes pergunta antes), **Salvar** / **Cancelar** no modo edição. Linha alterada fica marcada; erro de validação aparece na célula. Conversão de valores usa `normalizeValue` (Tarefa 5 anterior).
- Produces: `interface CalendarItem { id: string; title: string; start: string; end?: string; allDay?: boolean; color?: string; sourceLabel?: string }`, `<CalendarView items view="month"|"week"|"day" onSelect?(item) onCreate?(start) />` e `layoutWeek(items, weekStart): Positioned[]` (colunas para eventos sobrepostos).
- `KpiCard`: só `title` + `value` (remove `subtitle` e `trend` da API; valor em `text-[clamp(2rem,3vw,3rem)]`). `StatCard` passa a ser alias de `KpiCard`.
- Abas (`ModuleNav`, `TabList`): sem `border-b` de largura total e sem barra de rolagem visível; a linha só existe embaixo das abas (`w-fit`, indicador por aba); texto `text-base font-semibold` (maior que hoje).

- [x] **Step 1:** Testes `EditableTable.test.tsx`: sem permissão os botões Editar/Adicionar ficam `disabled`; editar duas células e Salvar chama `onSave` só com as linhas alteradas; `money` digitado `1.234,56` vira `1234.56`; Atualizar com rascunho pede confirmação e Cancelar mantém o rascunho; Adicionar cria linha com `newRow()`.
- [x] **Step 2:** Testes `calendar/layout.test.ts`: dois eventos sobrepostos ficam em colunas diferentes; evento de dia inteiro vai para a faixa do topo; semana começa no domingo e respeita `America/Sao_Paulo`.
- [x] **Step 3:** Teste `KpiCard`: não renderiza texto além de título e valor.
- [x] **Step 4:** FAIL → implementar → PASS. Commit `feat(ui): tabela editável, calendário, cards com número grande e abas sem linha cheia`.

### Task 4: Dashboard

**Files:** `src/modules/dashboard/pages/DashboardPage.tsx`, `src/lib/dashboard/finance.ts` (+ teste), `src/modules/dashboard/components/BalanceChart.tsx`

**Interfaces:**
- Produces: `monthResult(db, companyId, month): Promise<{ result: number }>` (receitas recebidas − despesas pagas no mês; positivo = lucro, negativo = dívida), `weekPayables(db, companyId, today)`, `weekReceivables(db, companyId, today)` (abertos com vencimento de hoje até domingo), `activeWorkCount(db, companyId)` (projetos não concluídos; no perfil advocacia, clientes com projeto/caso ativo), `annualBalance(db, companyId, year): Promise<{ month: string; realizado: number | null; acumulado: number | null; previsto: number }[]>` (previsto = recebíveis/pagáveis em aberto + recorrentes dos meses futuros).
- Consumes: `useLabel` (Tarefa 2), `KpiCard` (Tarefa 3), `dre`/`cashflow` e `runRecurring` do financeiro.

Layout: 4 cards (Lucro / Dívida do mês, A pagar na semana, A receber na semana, Projetos ativos), o título do primeiro muda para "Dívida do mês" quando o resultado é negativo; abaixo, gráfico de linha do ano: linha mensal realizada, linha do acumulado (total anual) e linha tracejada de previsão de receita.

- [x] **Step 1:** Testes SQLite com massa fixa: mês com R$ 10.000 recebidos e R$ 12.500 pagos → `result === -2500`; semana com 2 recebíveis abertos (R$ 300 + R$ 200) → 500; recebível já pago não entra; `annualBalance` tem 12 meses, `acumulado` de março = soma jan–mar, meses futuros com `realizado === null` e `previsto` preenchido.
- [x] **Step 2:** FAIL → implementar → PASS. Commit `feat(dashboard): resultado do mês, semana a pagar/receber, trabalhos ativos e balanço anual com previsão`.

### Task 5: Calendário conectado

**Files:** `src/modules/calendar/pages/CalendarPage.tsx`, `src/lib/calendar/{ical.ts,sync.ts,feed.ts}` (+ testes), rota `/calendar` e item "Calendário" no grupo Visão Geral (registro feito na Tarefa 2 junto com a migration).

Conexão sem servidor próprio: cada fonte é um **link iCal** (Google Agenda: "Endereço secreto no formato iCal"; Apple/iCloud: agenda pública; Outlook: "Publicar agenda"), sincronizado ao abrir a tela e a cada 15 min. No outro sentido, o app gera um arquivo `.ics` com férias, ausências e reuniões da empresa para assinar no Google/Apple. Sincronização em duas vias (criar evento no Google pelo app) fica fora deste plano: exige registrar o app no Google Cloud/Microsoft.

**Interfaces:**
- Produces: `parseIcs(text, range): CalendarItem[]` (expande recorrências no intervalo), `syncSource(db, sourceId, fetcher = fetch): Promise<{ added: number; updated: number; removed: number }>` (upsert por `uid`), `buildCompanyFeed(db, companyId): Promise<string>` (iCal com ausências e reuniões).

- [ ] **Step 1:** Testes com fixtures `.ics`: evento semanal com `RRULE` gera 4 ocorrências no mês; evento com `TZID=America/Sao_Paulo` às 09:00 fica 09:00 local; sincronizar duas vezes não duplica; evento removido na fonte some; URL que responde 404 grava `last_error` e não apaga eventos antigos.
- [ ] **Step 2:** FAIL → implementar (tela com `CalendarView`, lista de fontes em `EditableTable`, filtro por funcionário, botão "Exportar agenda da empresa") → PASS. Commit `feat(calendar): agendas por link iCal e agenda da empresa exportável`.

### Task 6: Edição na tabela em todos os módulos (paralelo, um agente por grupo)

**Files:** só as pastas do grupo. Grupos: (a) `crm`, `leads`, `opportunities`, `sales`, `catalog`; (b) `finance`, `payroll`, `purchasing`; (c) `inventory`, `custody`, `operations`; (d) `hr`, `projects`, `products`, `support`, `settings`, `documents` (metadados).

**Interfaces:** Consumes `EditableTable`, `KpiCard`, `CalendarView` (Tarefa 3), `useLabel` (Tarefa 2).

Em cada tela do grupo: toda lista vira `EditableTable` com Editar/Adicionar/Atualizar; remover o uso de `CrudDialog`/`DetailDrawer` para editar (fichas como a do cliente passam a ter campos editáveis no próprio lugar); cards do topo só com título + número grande; tudo que é data/agenda (férias, banco de horas, cronograma de projeto, follow-ups do CRM, vencimentos do financeiro, ordens de serviço agendadas) ganha a visão `CalendarView` ao lado da lista. Grupo (c) acrescenta **Fornecedores** no grupo Logística da sidebar, apontando para a lista de fornecedores das Compras.

- [ ] **Step 1:** Teste de contrato por grupo (`src/modules/<grupo>/editing.test.tsx`): cada página do grupo renderiza um `EditableTable` e nenhum `role="dialog"` aparece ao clicar em Editar ou Adicionar.
- [ ] **Step 2:** `rg "CrudDialog|DetailDrawer" src/modules/<pastas do grupo>` → nenhum uso para edição.
- [ ] **Step 3:** FAIL → migrar telas → PASS. Commit por grupo `refactor(<grupo>): edição direto na tabela`.

### Task 7: Prospecção com várias campanhas e cards enxutos

**Files:** `src/modules/leads/**`, `src/lib/prospecting/campaigns.ts` (+ teste)

- Remover os textos fixos ("Leads de Sorocaba sem site", "Pacotes e cronograma", "Previsão de receita" como título de página, "implantação + 12 mensalidades", "preço da proposta", "41 com sites quebrados", "106 com WhatsApp", "abordados / interessados / fechados", "5 abordagens por dia útil" e qualquer texto embaixo de número de card).
- Seletor de campanha no topo + botão **Nova prospecção** (nome editável na hora); KPIs e listas filtram pela campanha escolhida.
- Cronograma de abordagens em `CalendarView`.
- **Interfaces:** `createCampaign(db, companyId, name): Promise<string>`, `renameCampaign(db, id, name)`, `campaignStats(db, campaignId): Promise<{ leads: number; contacted: number; won: number; potential: number }>`.

- [x] **Step 1:** Testes: nova campanha começa vazia; leads de uma campanha não entram nos números de outra; renomear não muda os leads; nenhum texto de `KpiCard` além do título e do valor (teste de componente da página).
- [x] **Step 2:** FAIL → implementar → PASS. Commit `feat(leads): várias prospecções nomeadas e cards só com números`.

### Task 8: Pacotes e preços

**Files:** `src/modules/leads/components/PackagesPanel.tsx`, `src/lib/prospecting/packages.ts` (se a lista de funções por pacote ainda não estiver em dados)

- Três cards (Básico, Essencial, Premium) centralizados; ordem dentro do card: nome → resumo → lista curta → **preço por último, grande**. Abaixo, tabela comparativa: uma linha por função, uma coluna por pacote, ✓ ou ✕.
- **Interfaces:** `packageFeatures(): { feature: string; basico: boolean; essencial: boolean; premium: boolean }[]` derivado dos dados de pacotes existentes (`src/types/index.ts`/`referral.ts`), sem duplicar preços.

- [ ] **Step 1:** Teste: a tabela tem uma linha por função e exatamente 3 colunas de pacote; preço é o último elemento de texto de cada card.
- [ ] **Step 2:** FAIL → implementar → PASS. Commit `feat(leads): pacotes centralizados com tabela comparativa`.

### Task 9: Documentos — nuvem e pastas monocromáticas

**Files:** `src/modules/documents/**`, `src/lib/files/cloudFolders.ts` (+ teste), `src-tauri/capabilities/default.json` (leitura das pastas escolhidas)

Conexão sem login de terceiros: o botão **Conectar nuvem** abre o seletor de pasta já posicionado nos caminhos padrão (`~/Library/Mobile Documents/com~apple~CloudDocs` para iCloud Drive, `~/Library/CloudStorage/GoogleDrive-*`, `~/Library/CloudStorage/OneDrive-*`, `~/Library/CloudStorage/Dropbox*`), grava em `cloud_folders` e mostra essas pastas ao lado das pastas internas, com abrir/baixar/enviar arquivo. Se o app do Google Drive/OneDrive não estiver instalado, a tela diz como instalar.
- **Interfaces:** `detectCloudFolders(home: string, exists: (p: string) => boolean): { provider: string; path: string }[]`, `listCloudFolder(path): Promise<{ name: string; isDir: boolean; size: number; modified: string }[]>` (sem seguir links simbólicos para fora da pasta).
- Ícone de pasta: chapado, 1 cor (ou 2 tons para a aba), sem gradiente/sombra/volume.

- [x] **Step 1:** Testes: `detectCloudFolders` acha iCloud e OneDrive com caminhos falsos; caminho com `..` ou link para fora da pasta conectada é recusado.
- [x] **Step 2:** FAIL → implementar → PASS. Commit `feat(documents): pastas de nuvem conectadas e ícones chapados`.

### Task 10: Modo demo e limpeza dos dados fictícios

**Files:** `src/lib/demo/{demoMode.ts,purge.ts}` (+ teste), `src/modules/settings/pages/SettingsPage.tsx` (switch), `src/lib/dev/devSeed.ts` e `src/lib/dev/seeds/*` (passam a ser chamados só pelo modo demo)

- Switch **Modo demonstração** em Configurações (só `ceo`/`admin`). Ligar: roda todos os seeds (ids `dev-*`/`demo-*`), grava `settings.demo_mode = on`. Desligar: apaga (hard delete, é dado fictício) toda linha com id `dev-%`/`demo-%` em todas as tabelas, **exceto `leads`** e as contas de login rápido, grava `off`.
- Login rápido deixa de semear dados sozinho (regra 3 do plano anterior muda: dados de exemplo só pelo modo demo).
- Na primeira abertura depois da atualização, o banco do André fica com modo demo **desligado**: os dados fictícios atuais somem, leads ficam (pedido explícito dele).
- **Interfaces:** `setDemoMode(db, companyId, on: boolean): Promise<{ inserted?: number; removed?: number }>`, `isDemoMode(db, companyId): Promise<boolean>`, `DEMO_EXCLUDED_TABLES = ["leads", "users", "memberships", "companies", "_sqlx_migrations"]`.

- [x] **Step 1:** Testes SQLite: ligar popula clientes, financeiro, estoque, projetos e RH; desligar remove todos eles e mantém 3 leads reais e um cliente criado pelo usuário (`id` uuid) durante o modo demo; ligar duas vezes não duplica; leads com id `dev-*` também ficam.
- [x] **Step 2:** FAIL → implementar → PASS. Commit `feat(settings): modo demonstração liga e desliga dados de exemplo sem tocar em leads`.

### Task 11: QA no app instalado

**Files:** `e2e/redesign.spec.ts`, `docs/QA.md`

- [ ] **Step 1:** Playwright (`npm run dev`, banco demo): shell sem top bar; dropdown da conta com tema e notificações; editar uma célula de cliente e ver o valor após Atualizar; dashboard com 4 cards e gráfico de 3 linhas; calendário com fixture iCal.
- [ ] **Step 2:** `npm run install:app`; abrir o app instalado; login rápido nas 11 áreas; ligar/desligar modo demo; conectar uma pasta do iCloud Drive.
- [ ] **Step 3:** Atualizar `AGENTS.md` (padrão EditableTable/CalendarView, perfil de área, modo demo) e commit `docs: redesign modular`.

## Execução em agentes

- **Fase A (sequencial, no branch principal):** Tarefa 0 → 1 → 2 → 3 (tocam arquivos compartilhados).
- **Fase B (paralela, worktree por tarefa):** 4, 5, 6a, 6b, 6c, 6d, 7, 8, 9, 10 — cada uma com implementador e revisor; nenhuma edita `routes.tsx`, `Sidebar.tsx`, `rbac.ts`, `demo.ts`, `lib.rs`, `types/index.ts` (a Tarefa 2 já registra rotas, nav e tabelas).
- **Fase C:** juntar os branches (com autorização), Tarefa 11, reinstalar com `npm run install:app`.

## Cobertura

| Pedido | Tarefa |
|---|---|
| 4 cards no dashboard (lucro/dívida do mês, a pagar semana, a receber semana, projetos/clientes ativos) | 4 |
| Títulos de cards/gráficos conforme a área da empresa (TI, advocacia...) | 2, 4 |
| Gráfico de linha do balanço anual mensal com total e previsão de receita | 4 |
| Calendário conectado (Google, Apple, outros) para presença de funcionários | 5 |
| Conta no lugar do assistente; tema e notificações dentro da conta | 1 |
| Assistente acima do Dashboard com histórico de conversas | 1, 2 |
| Fundo cinza puro escuro, sidebar mais escura, monocromático | 1 |
| Busca no topo da sidebar, acima do assistente | 1 |
| Remover a top bar | 1 |
| Switch modo demo; remover fictícios mantendo leads | 10 |
| Editar/Adicionar/Atualizar em toda tabela, edição no lugar, sem modal/painel | 3, 6 |
| Cronogramas em visual de calendário | 3, 5, 6, 7 |
| Pacotes centralizados, preço por último e grande, tabela ✓/✕ | 8 |
| Fornecedores em Logística | 6c |
| Documentos: conectar Google Drive, iCloud, OneDrive; pastas chapadas | 9 |
| Números grandes nos cards do topo em todas as telas | 3, 6, 7 |
| Linha das abas só embaixo dos títulos, sem barra no fim; títulos maiores | 3 |
| Prospecção sem textos fixos, várias prospecções nomeadas, cards sem texto | 7 |
