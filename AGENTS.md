# AGENTS.md — Company Manager

Guia para agentes de IA (e pessoas) trabalharem neste repositório. Tudo aqui foi extraído do código; quando algo **não existe** (ex.: testes), está dito explicitamente.

## 1. Mapa do projeto e módulos

Company Manager é um sistema modular de gestão (ERP + CRM + ITSM + projetos) em **Tauri 2 + Vite + React 18 + TypeScript + Tailwind**. Roda como app desktop (SQLite) ou no navegador (banco demo em localStorage). A interface é em **pt-BR**.

Cada módulo é uma página lazy em `src/modules/<modulo>/pages/`, registrada em `src/app/routes.tsx`, controlada por RBAC em `src/lib/permissions/rbac.ts` (`visibleModules`) e exibida em `src/app/layout/Sidebar.tsx` / `CommandMenu.tsx`.

| Módulo (chave) | Rota | Recurso RBAC | Página | Observação |
|---|---|---|---|---|
| dashboard | `/` | — (sempre visível) | `dashboard/pages/DashboardPage.tsx` | KPIs |
| crm | `/crm` | `customers` | `crm/pages/CrmPage.tsx` | clientes; `can()` só libera para o papel `comercial` |
| leads | `/leads` | `leads` | `leads/pages/LeadsPage.tsx` | prospecção de sites: leads, cronograma, pacotes, previsão |
| opportunities | `/opportunities` | `opportunities` | `crm/pages/OpportunitiesPage.tsx` | funil de oportunidades |
| support | `/support` | `tickets` | `support/pages/SupportPage.tsx` | tickets/ITSM; fica no menu da conta, não na sidebar |
| operations | `/work-orders` | `work_orders` | `operations/pages/WorkOrdersPage.tsx` | ordens de serviço |
| projects | `/projects` | `projects` | `projects/pages/ProjectsPage.tsx` | projetos + troca de arquivo com o Project Manager |
| products | `/products` | `product_development` | `products/pages/ProductDevelopmentPage.tsx` | desenvolvimento de produtos |
| inventory | `/inventory` | `inventory` | `inventory/pages/InventoryPage.tsx` | estoque, fornecedores |
| custody | `/custody` | `custody` | `custody/pages/CustodyPage.tsx` | custódia de peças |
| finance | `/finance` | `finance` | `finance/pages/FinancePage.tsx` | contas a pagar/receber |
| documents | `/documents` | `documents` | `documents/pages/DocumentsPage.tsx` | |
| audit | `/audit` | `audit_logs` | `settings/pages/AuditPage.tsx` | `can()` só libera para o papel `tecnico` |
| settings | `/settings` | `settings` | `settings/pages/SettingsPage.tsx` | no menu da conta; IA, tema |
| assistant | `/assistant` | — (sempre visível) | `assistant/pages/AssistantPage.tsx` | chat com API compatível com OpenAI |

Papéis (`Role` em `src/types/index.ts`): `admin`, `gerente`, `tecnico`, `estoquista`, `financeiro`, `comercial`, `atendimento`, `produtos`, `auditor`.

## 2. Árvore de pastas

```
.
├── AGENTS.md / CLAUDE.md          # este guia (CLAUDE.md só importa AGENTS.md)
├── README.md                      # visão geral em pt-BR
├── design-system.html             # design system publicado (estático)
├── components.json                # config shadcn (aliases @/components, @/lib...)
├── package.json                   # scripts e dependências
├── vite.config.ts                 # porta 1420, alias @ -> src, ignora src-tauri no watch
├── tailwind.config.js             # tokens shadcn (hsl(var(--...))), darkMode: class
├── scripts/site-prospecting/      # gerador do seed de prospecção (ver §4 e §8)
│   ├── pricing.mjs                #   pacotes, preços (ESTIMATIVA), cenários, tarefas, cronograma
│   └── build-seed.mjs             #   CSV -> src/lib/prospecting/data/siteProspecting.generated.ts
├── .github/workflows/             # ci.yml (tsc + cargo check), release.yml (tags v*)
├── src-tauri/
│   ├── Cargo.toml                 # crate company-manager; plugins sql(sqlite)/fs/dialog/shell
│   ├── tauri.conf.json            # identifier com.company.manager, devUrl :1420
│   ├── capabilities/default.json  # permissões sql/fs/dialog/shell do webview
│   ├── migrations/                # 0001_init, 0002_assistant_support_inventory, 0003_site_prospecting
│   ├── src/lib.rs                 # registra as migrations (versão -> arquivo) e os plugins
│   └── icons/
└── src/
    ├── main.tsx                   # QueryClientProvider + tema
    ├── app/
    │   ├── App.tsx                # SessionContext + BrowserRouter
    │   ├── routes.tsx             # rotas lazy + RequireModule (RBAC)
    │   └── layout/                # AppShell (topbar, bootstrap), Sidebar, CommandMenu (Cmd/Ctrl+K)
    ├── components/shared/         # PageHeader, PageToolbar, CrudDialog, DetailDrawer, EmptyState, StatusBadge, KpiCard
    ├── components/ui/             # vazio: nenhum componente shadcn instalado ainda
    ├── hooks/                     # useSession, usePermission, useProspectingBootstrap
    ├── lib/
    │   ├── db/                    # client.ts (SQLite/Tauri ou demo), demo.ts (banco demo + contas demo)
    │   ├── auth/                  # login.ts (senha "plain:" V1), session.ts (sessionStorage)
    │   ├── permissions/rbac.ts    # PERMISSIONS por papel, can(), visibleModules()
    │   ├── events/bus.ts          # emit()/on(): grava em `activities` e dispara handlers
    │   ├── assistant/             # config.ts (provedores), client.ts (chat/completions)
    │   ├── prospecting/           # seed, forecast, queries, contact (+ data/*.generated.ts)
    │   ├── integrations/          # projectBundle.ts (contrato com o Project Manager), files.ts
    │   ├── theme.ts / utils.ts    # tema claro/escuro, cn(), formatCurrency(), formatDate()
    ├── modules/<modulo>/pages/    # uma página por rota (ver tabela do §1); leads e projects têm components/
    ├── styles/globals.css         # variáveis CSS (tema), .kpi-card
    └── types/index.ts             # tipos de domínio espelhando as tabelas
```

## 3. Stack e comandos

Node 20+ (CI usa 20), npm, Rust estável (só para o desktop). Dependências principais: React 18, react-router-dom 6, @tanstack/react-query 5, @tanstack/react-table 8, Tailwind 3 + tailwindcss-animate, lucide-react, cmdk, recharts, framer-motion, zod, uuid, plugins Tauri (`sql`, `fs`, `dialog`, `shell`).

| Objetivo | Comando |
|---|---|
| Instalar | `npm install` |
| Dev (navegador, banco demo) | `npm run dev` → http://localhost:1420 |
| Dev (desktop, SQLite real) | `npm run tauri dev` |
| Typecheck | `npm run typecheck` (= `tsc --noEmit`) |
| Build (tsc + vite) | `npm run build` |
| Build desktop | `npm run tauri build` |
| Testes | **não existe test runner configurado** (sem vitest/jest). Verifique com typecheck + build e exercite a UI. |
| Lint | **não existe** ESLint configurado. |
| Regenerar seed de prospecção | `node scripts/site-prospecting/build-seed.mjs [caminho.csv]` |

CI (`.github/workflows/ci.yml`): `npm ci`, `npx tsc --noEmit`, `cargo check` em `src-tauri`.

## 4. Modelo de dados e onde fica

- **Desktop (Tauri):** SQLite via `@tauri-apps/plugin-sql`, arquivo `company-manager.db` no diretório de dados do app (macOS: `~/Library/Application Support/com.company.manager/`). Schema = `src-tauri/migrations/*.sql`, aplicadas pelo `lib.rs` (`Migration { version, sql }`). Banco é ignorado pelo git (`*.db`).
- **Navegador:** `src/lib/db/demo.ts` — banco em **localStorage** (`cm_demo_database_v4`) que **emula SQL por padrões de texto**. Seed fixo (empresa TechFlow, contas demo `DEMO_ACCOUNTS`). Consulta/comando fora dos padrões lança `Consulta demo nao suportada` / `Comando demo nao suportada`. Há um fallback genérico para `INSERT [OR IGNORE|OR REPLACE]`, `UPDATE ... WHERE id=?` e `SELECT ... WHERE id=?` nas tabelas novas (leads, service_packages, package_prices, revenue_scenarios, revenue_forecasts, settings, tasks).
- Acesso: sempre `const db = await getDb()` (`src/lib/db/client.ts`) → `db.select<T>(sql, binds)` / `db.execute(sql, binds)`, com `?` posicionais. **O primeiro bind das consultas costuma ser `company_id`** (o demo depende disso).
- Convenções do schema (0001): IDs `TEXT` (uuid gerado no app), timestamps `TEXT` ISO (`datetime('now')`), `company_id` em quase tudo (multiempresa), **soft delete** com `deleted_at` (não use `DELETE` no fluxo normal), FKs ativas, índices por `company_id`/status/datas.
- Tabelas: `companies, users, departments, memberships` (núcleo/RBAC); `customers, contacts, leads, opportunities, proposals` (CRM); `projects, tasks`; `tickets, work_orders`; `inventory_items, stock_locations, stock_balances, stock_movements, custodies, suppliers`; `cost_centers, payables, receivables`; `documents, attachments`; `activities, audit_logs, notifications, automation_rules, approval_flows, approvals, settings` (0001); `user_settings` (0002); `service_packages, package_prices, revenue_scenarios, revenue_forecasts` + colunas novas em `leads` (0003).
- Tipos TypeScript das tabelas: `src/types/index.ts` (mantenha em sincronia com as migrations).
- **Prospecção de sites (migration 0003):** `leads` ganhou `project_id, category, business_type, whatsapp, google_rating, google_reviews, sem_site, online_presence, presence_kind, address, notes, source_url, package_id, estimated_setup, estimated_monthly, estimated_revenue, priority_rank, outreach_day, outreach_date, last_contact_at`. Status do funil: `novo → abordado → interessado → fechado` (os valores antigos `qualificado/descartado/convertido` seguem válidos no tipo). Valores de preço e previsão são **estimativas** (`is_estimate = 1`).
- **Seed:** `src/lib/prospecting/seed.ts` roda no primeiro login de papel que pode criar `leads` (`useProspectingBootstrap`, chamado no `AppShell`). Idempotente (flag `seed.site_prospecting.v1` em `settings`; ids uuid v5; `INSERT OR IGNORE`). Cria o projeto "Desenvolvimento de Site", 10 tarefas, 3 pacotes, 36 preços (12 segmentos × 3), 3 cenários (5/10/20%), 39 linhas de previsão e 155 leads. Dados vêm de `src/lib/prospecting/data/siteProspecting.generated.ts` (**gerado**).
- Sessão: `sessionStorage` (`cm_session`). Tema: `localStorage` (`cm_theme`). Sidebar: `cm_sidebar_width`, `cm_sidebar_collapsed`.

## 5. Convenções

**Código**
- TypeScript estrito (`strict`, `noUnusedLocals`, `noUnusedParameters`); alias `@/` = `src/`.
- Páginas: `export default function XxxPage()` em `modules/<modulo>/pages/XxxPage.tsx`; carregamento com `lazy()` em `routes.tsx`.
- Dados: `useQuery` / `useMutation` do TanStack Query; `queryKey = ["<recurso>", companyId, ...]`; invalide com `qc.invalidateQueries({ queryKey: [...] })` após mutações.
- Efeitos de negócio relevantes: chame `emit({ type, companyId, actorId, entityType, entityId, title, module })` (`lib/events/bus.ts`) — grava em `activities`.
- Permissões: `usePermission("create" | "edit" | ..., "<recurso>")` na UI; regras em `rbac.ts`. Nunca confie só na UI para dados sensíveis.
- Sem `any` desnecessário; sem comentários óbvios; comente o *porquê* (ex.: limitações do banco demo).

**Nomes**
- Arquivos de página/componente `PascalCase.tsx`; hooks `useXxx.ts`; libs em pastas minúsculas.
- Colunas e campos de dados em `snake_case` (iguais ao banco); variáveis/funções em `camelCase`.
- Valores de domínio em português sem acento/underscore (`em_andamento`, `aguardando_peca`, `concluida`); textos de UI em pt-BR.

**Commits**
- Conventional Commits: `tipo(escopo): descrição` (`feat`, `fix`, `refactor`, `style`, `chore`, `docs`). O histórico antigo está em inglês; **commits novos em português** (pedido do André).
- Commits pequenos e coerentes; uma migration + tipos juntos. **Não faça push sem o André pedir.**
- Rodapé de atribuição quando o agente cria o commit: `Co-Authored-By: ...` conforme a instrução da sessão.

**UI (shadcn)**
- `components.json` configura shadcn (estilo `default`, base `slate`, `cssVariables: true`), mas **`src/components/ui/` está vazio**: a UI atual usa Tailwind direto + `components/shared/`. Se precisar de um componente shadcn, instale com a CLI do shadcn (vai para `@/components/ui`) em vez de reescrever.
- Tokens de cor vêm de variáveis HSL em `globals.css` (`bg-background`, `text-muted-foreground`, `border`, `bg-primary`, `bg-card`...). Não use cores hex soltas; tema claro/escuro via classe `dark`.
- Reutilize: `PageHeader` (título + ações), `PageToolbar` (busca + filtros), `CrudDialog` (formulário modal), `DetailDrawer`/`DetailGrid`/`DetailItem` (detalhe lateral), `EmptyState`, `StatusBadge` (mapa status → cor/rótulo; adicione novos status lá), `KpiCard`.
- Inputs seguem `h-9 rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring`.

## 6. Como adicionar um módulo novo

1. **Dados:** nova migration `src-tauri/migrations/000N_<nome>.sql` (tabelas com `id TEXT PK`, `company_id`, timestamps, `deleted_at`) e registre em `src-tauri/src/lib.rs` com `version: N`. Atualize `src/types/index.ts`.
2. **Demo:** garanta que o banco demo entende suas consultas — adicione a tabela em `DemoTables`/`EXTRA_TABLES` de `src/lib/db/demo.ts` (o fallback genérico cobre `SELECT ... WHERE`, `INSERT` e `UPDATE` simples; casos especiais precisam de handler).
3. **RBAC:** em `rbac.ts`, inclua o recurso no tipo `Resource`, as permissões por papel em `PERMISSIONS` e o mapeamento módulo → recurso em `visibleModules` (`moduleMap`).
4. **Página:** `src/modules/<modulo>/pages/<Modulo>Page.tsx` (default export), seguindo `ProjectsPage.tsx`/`LeadsPage.tsx`.
5. **Rota:** `lazy()` + `<Route path="/<modulo>/*" element={<RequireModule module="<chave>">...}` em `routes.tsx`.
6. **Navegação:** item em `NAV_ITEMS` (`Sidebar.tsx`) e em `COMMANDS` (`CommandMenu.tsx`), com ícone lucide e grupo.
7. **Status novos:** cores e rótulos em `StatusBadge.tsx`.
8. Rode `npm run typecheck` e `npm run build`; abra o módulo com um papel que tenha acesso e outro que não tenha.

## 7. Integração Company Manager ⇄ Project Manager

Project Manager é um app irmão em `~/Documents/Trabalho/Sites/Project-Manager` (mesma stack e convenções; repositório git local separado). A integração é **por arquivo JSON**, sem acoplar os dois builds:

- **Contrato:** `company-manager.project-bundle` v1 — `{ format, version, exportedAt, source, projects[], tasks[] }` com as colunas de `projects` e `tasks` (ver `src/lib/integrations/projectBundle.ts`, validado com zod). O Project Manager tem o espelho em `src/module/integration/bundle.ts`. **Mantenha os dois arquivos sincronizados.**
- **UI:** `ProjectsPage` → botões *Importar do Project Manager* / *Exportar para o Project Manager* (`modules/projects/components/ProjectManagerSync.tsx`); detalhe do projeto lista as tarefas (`ProjectTasks.tsx`, somente leitura). Visível para quem tem `edit` em `projects`.
- **Regras de importação:** upsert por `id`; só atualiza se `updated_at` do arquivo for mais novo; linhas de outra empresa são ignoradas; `company_id` é reescrito para o da sessão; projetos novos ficam com o usuário atual como `owner_id`; `parent_task_id` só é mantido se a tarefa pai existir; `assignee_id`, `customer_id`, `contract_id` não trafegam.
- **Projeto exemplo:** "Desenvolvimento de Site" (criado pelo seed) já tem 10 tarefas e viaja no bundle.
- O Project Manager também exporta um módulo React (`ProjectManagerModule`) que pode ser montado dentro do Company Manager no futuro; hoje **não está montado aqui** (evita dependência entre repositórios).

## 8. Cuidados (o que não mexer)

- **Migrations já existentes (`0001`–`0003`) não se editam:** o `tauri-plugin-sql` guarda checksum; mudar uma já aplicada quebra o banco do usuário. Sempre crie a próxima (`0004_...`) e registre no `lib.rs`.
- **Não edite** `src/lib/prospecting/data/siteProspecting.generated.ts` à mão — rode o gerador. Preços ficam em `scripts/site-prospecting/pricing.mjs` e são **estimativas** até existir a Proposta Comercial.
- **Não toque no banco real** (`~/Library/Application Support/com.company.manager/company-manager.db`) por fora do app; teste com migrations em um SQLite temporário.
- **Segredos:** nunca commitar `.env*`, `*.db`, chaves de API. A chave do Assistente IA fica em `localStorage` (`cm_assistant_api_<userId>`) em texto puro e a CSP do Tauri está `null` — não coloque credenciais de produção em testes. Senhas V1 usam prefixo `plain:` (`lib/auth/login.ts`, TODO: argon2 via comando Tauri); as contas demo são só para demonstração.
- **RBAC com exceções embutidas:** `can()` bloqueia `customers` para qualquer papel que não seja `comercial` e `audit_logs` para qualquer papel que não seja `tecnico` (inclusive `admin`). Mudar isso altera o acesso a CRM e Auditoria.
- Banco demo: mudar o formato do seed sem trocar `STORAGE_KEY` deixa navegadores com dados antigos (tabelas novas são completadas em `load()`).
- `design-system.html`, `src-tauri/icons/` e `Cargo.lock` são artefatos versionados; não regenere sem motivo.
- O repositório está em `~/Documents` (iCloud Drive): arquivos podem ficar "somente na nuvem" (dataless) e travar `tsc`/`vite`. Se acontecer: `brctl download "<pasta>"`.
- Tema escuro é o padrão (`getTheme()`).

## 9. Checklist antes de commitar

- [ ] `npm run typecheck` sem erros.
- [ ] `npm run build` conclui.
- [ ] Se mexeu em SQL: o banco demo suporta (abra a tela no `npm run dev`) **e** o SQLite real aceita (aplique as migrations em um `sqlite3` temporário e rode a consulta).
- [ ] Nova migration criada (não editou as antigas), registrada em `lib.rs`, tipos atualizados.
- [ ] Novo recurso/módulo: RBAC (`rbac.ts`), rota (`routes.tsx`), sidebar e `CommandMenu`.
- [ ] Textos de UI em pt-BR; cores via tokens; componentes de `components/shared` reutilizados.
- [ ] Sem segredos, `.db` ou `dist/` no diff (`git status`).
- [ ] Se mudou o contrato do bundle: atualizou também o Project Manager.
- [ ] Mensagem de commit em Conventional Commits, em português; **sem push**.
