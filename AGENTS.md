# AGENTS.md — Company Manager

Guia para agentes de IA (e pessoas) trabalharem neste repositório. Tudo aqui foi extraído do código; quando algo **não existe** (ex.: lint), está dito explicitamente.

## 1. Mapa do projeto e módulos

Company Manager é um sistema modular de gestão (ERP + CRM + ITSM + projetos) em **Tauri 2 + Vite + React 18 + TypeScript + Tailwind**. Roda como app desktop (SQLite) ou no navegador (banco demo em localStorage). A interface é em **pt-BR**.

Cada módulo é uma página lazy em `src/modules/<modulo>/pages/`, registrada em `src/app/routes.tsx`, controlada por RBAC em `src/lib/permissions/rbac.ts` (`visibleModules`) e exibida em `src/app/layout/Sidebar.tsx` / `CommandMenu.tsx`.

| Módulo (chave) | Rota | Recurso RBAC | Página | Observação |
|---|---|---|---|---|
| dashboard | `/` | — (sempre visível) | `dashboard/pages/DashboardPage.tsx` | KPIs do que o papel pode ver, mais saldo de férias e pendências de RH |
| hr | `/hr` | `hr_self` (todos os papéis) | `hr/pages/MyHrPage.tsx` | **Meu RH**: férias, solicitações, comunicados do RH e pendências do próprio colaborador |
| hr_manage | `/hr/manage` | `hr_admin` (RH, CEO, admin) | `hr/pages/HrManagePage.tsx` | **Gestão de RH**: colaboradores, solicitações (aprovar/recusar), comunicados, pendências; sem salário |
| payroll | `/payroll` | `payroll` (**só CEO e admin**) | `payroll/pages/PayrollPage.tsx` | **Folha de pagamento**: salário base por colaborador e soma mensal (questão administrativo-financeira) |
| crm | `/crm` | `customers` | `crm/pages/CrmPage.tsx` | clientes; CEO, admin, gerente e comercial editam, atendimento só consulta |
| leads | `/leads` | `leads` | `leads/pages/LeadsPage.tsx` | prospecção de sites: leads, cronograma, pacotes e preços, previsão, indicações |
| opportunities | `/opportunities` | `opportunities` | `crm/pages/OpportunitiesPage.tsx` | funil de oportunidades |
| support | `/support` | `tickets` | `support/pages/SupportPage.tsx` | tickets/ITSM; fica no menu da conta, não na sidebar |
| operations | `/work-orders` | `work_orders` | `operations/pages/WorkOrdersPage.tsx` | ordens de serviço |
| projects | `/projects` | `projects` | `projects/pages/ProjectsPage.tsx` | **Project Manager embutido** (`modules/project-manager`): projetos, etapas, fluxo visual e quadro de tarefas |
| products | `/products` | `product_development` | `products/pages/ProductDevelopmentPage.tsx` | desenvolvimento de produtos |
| inventory | `/inventory` | `inventory` | `inventory/pages/InventoryPage.tsx` | estoque, fornecedores |
| custody | `/custody` | `custody` | `custody/pages/CustodyPage.tsx` | custódia de peças |
| finance | `/finance` | `finance` | `finance/pages/FinancePage.tsx` | contas a pagar/receber |
| documents | `/documents` | `documents` | `documents/pages/DocumentsPage.tsx` | |
| audit | `/audit` | `audit_logs` | `settings/pages/AuditPage.tsx` | CEO, admin, TI (`tecnico`) e Auditoria (esta também exporta) |
| catalog | `/catalog` | `products` | `catalog/pages/CatalogPage.tsx` | catálogo de produtos/serviços e tabelas de preço (página provisória) |
| sales | `/sales` | `sales_orders` | `sales/pages/SalesPage.tsx` | pedidos de venda e faturas (`invoices`); parcelas viram contas a receber (provisória) |
| purchasing | `/purchasing` | `purchase_orders` | `purchasing/pages/PurchasingPage.tsx` | pedidos de compra, aprovação e recebimento (`receive`) (provisória) |
| reports | `/reports` | `reports` | `reports/pages/ReportsPage.tsx` | relatórios; cada um também confere `view` no recurso de origem (provisória) |
| imports | `/imports` | `imports` | `imports/pages/ImportsPage.tsx` | importar planilhas; importar uma entidade também exige `create` no recurso dela (provisória) |
| settings | `/settings` | `settings` | `settings/pages/SettingsPage.tsx` | no menu da conta; IA, tema |
| assistant | `/assistant` | — (sempre visível) | `assistant/pages/AssistantPage.tsx` | chat com API compatível com OpenAI |

**Subpáginas dos módulos** (registro único em `src/app/subpages.ts`; ver §6b): CRM `/crm/clientes/:id`, `/crm/contatos`, `/crm/funil`, `/crm/propostas` e `/crm/propostas/:id`, `/crm/atividades`, `/crm/duplicados` (exige `edit` em `customers`); Catálogo `/catalog/tabelas-de-preco`; Vendas `/sales/pedidos/:id`, `/sales/faturas` e `/sales/faturas/:id`; Compras `/purchasing/pedidos/:id`, `/purchasing/recebimentos`, `/purchasing/fornecedores` (recurso `suppliers`); Estoque `/inventory/movimentacoes`, `/inventory/transferencias`, `/inventory/inventarios` e `/inventory/inventarios/:id`, `/inventory/reposicao`, `/inventory/locais`; Financeiro `/finance/fluxo-de-caixa`, `/finance/dre`, `/finance/contas-bancarias` e `/finance/conciliacao` (recurso `bank`), `/finance/categorias`, `/finance/recorrentes`; RH `/hr/banco-de-horas` (Meu RH), `/hr/manage/colaboradores/:id`, `/hr/manage/banco-de-horas`, `/hr/manage/admissoes`; Importação `/imports/historico`; Relatórios `/reports/vendas`, `/reports/contas`, `/reports/estoque`, `/reports/dre` (cada um também exige `view` no recurso de origem); Configurações `/settings/backup` (recurso `backups`, só CEO e admin). Todas têm página provisória (`PagePlaceholder`); `:id` = `nova` abre a criação onde a página tiver.

Papéis (`Role` em `src/types/index.ts`): `ceo`, `admin`, `gerente`, `tecnico`, `estoquista`, `financeiro`, `rh`, `comercial`, `atendimento`, `produtos`, `auditor`. **O papel vem da conta (e-mail + senha)**; a tela de login é única e cada setor só vê os módulos do seu papel (`visibleModules`). `ceo` vê tudo (inclusive CRM, auditoria, Gestão de RH e Folha de pagamento); `financeiro` tem **todo o financeiro** (ver, criar, editar, apagar, aprovar e exportar contas a pagar e a receber; na `FinancePage`, baixa e estorno exigem `edit`, aprovar exige `approve` e excluir exige `delete`) **menos as questões administrativo-financeiras** (folha de pagamento); `rh` vê Gestão de RH, Meu RH, dashboard, assistente, suporte, documentos e configurações (sem salário); todos os papéis têm o Meu RH. A folha (`payroll`) só aparece para `ceo` e `admin`.

## 2. Árvore de pastas

```
.
├── AGENTS.md / CLAUDE.md          # este guia (CLAUDE.md só importa AGENTS.md)
├── README.md                      # visão geral em pt-BR
├── design-system.html             # referência visual do design system (estático, usa os tokens atuais)
├── components.json                # config shadcn (aliases @/components, @/lib...)
├── package.json                   # scripts e dependências
├── vite.config.ts                 # porta 1420, alias @ -> src, ignora src-tauri no watch
├── vitest.config.ts               # testes: alias @, Node por padrão, *.test.tsx em jsdom
├── tailwind.config.js             # tokens shadcn (hsl(var(--...))), darkMode: class
├── scripts/sync-project-manager.mjs   # copia o módulo do Project Manager para src/modules/project-manager (`npm run sync:project-manager`)
├── scripts/site-prospecting/      # gerador do seed de prospecção (ver §4 e §8)
│   ├── pricing.mjs                #   pacotes Básico/Essencial/Premium, preços da Proposta, cenários, tarefas, cronograma
│   ├── build-seed.mjs             #   CSV -> src/lib/prospecting/data/siteProspecting.generated.ts
│   └── export-pacotes.mjs         #   gera ~/LeadingSitesSorocaba/PACOTES_PRECOS.md (preços + previsão)
├── .github/workflows/             # ci.yml (tsc + npm test + cargo check), release.yml (tags v*)
├── src-tauri/
│   ├── Cargo.toml                 # crate company-manager; plugins sql(sqlite)/fs/dialog/shell
│   ├── tauri.conf.json            # identifier com.company.manager, devUrl :1420, dragDropEnabled: false
│   ├── capabilities/default.json  # permissões sql/fs/dialog/shell do webview
│   ├── migrations/                # 0001_init … 0007_payroll, 0008_crm_erp_core, 0009_documents_files, 0010_auth_hash, 0011_crm_hr_extras
│   ├── src/lib.rs                 # registra as migrations (versão -> arquivo), os plugins e os comandos
│   ├── src/auth.rs / backup.rs    # hash de senha; backup_db/restore_db/list_backups (provisórios, ver §6b)
│   └── icons/
└── src/
    ├── main.tsx                   # QueryClientProvider + tema
    ├── app/
    │   ├── App.tsx                # SessionContext + BrowserRouter
    │   ├── routes.tsx             # rotas lazy + RequireModule (RBAC) + rotas das subpáginas (RequireSubpage)
    │   ├── subpages.ts            # registro das subpáginas: rota, página, rótulo, permissões; abas e busca
    │   └── layout/                # AppShell (topbar, bootstrap), Sidebar, CommandMenu (Cmd/Ctrl+K), ModuleNav (abas do módulo)
    ├── components/shared/         # PageHeader, PageToolbar, CrudDialog, DetailDrawer, EmptyState, PagePlaceholder, StatusBadge (tags sólidas), StatCard e KpiCard (valor grande), ImportExportButtons, FileAttachments
    ├── components/ui/             # vazio: nenhum componente shadcn instalado ainda
    ├── hooks/                     # useSession, usePermission, useProspectingBootstrap
    ├── lib/
    │   ├── db/                    # client.ts (SQLite/Tauri ou demo), demo.ts (banco demo + contas demo), demoSchema.ts (schema do demo lido das migrations), sequence.ts (número PV-00012 por empresa)
    │   ├── money.ts               # dinheiro em centavos: roundMoney, sumMoney, lineTotal, orderTotals, splitInstallments
    │   ├── importexport/          # registry.ts (entidades importáveis; importers/<chave>.ts entram sozinhos)
    │   ├── dev/                   # TEMPORÁRIO: login rápido, devSeed.ts e seeds/<area>.ts (dados de exemplo por área)
    │   ├── auth/                  # hash.ts (argon2id no desktop, PBKDF2 no navegador), login.ts (login, rehash, revalidação), password.ts (trocar/redefinir/exigir troca), accounts.ts (criar conta), seedRoleAccounts.ts (uma conta por setor), session.ts (sessionStorage), social.ts (botões Google/Microsoft/GitHub: só explicam o que falta)
    │   ├── permissions/rbac.ts    # PERMISSIONS por papel, can(), visibleModules()
    │   ├── events/bus.ts          # emit()/on(): grava em `activities` e dispara handlers
    │   ├── assistant/             # config.ts (provedores), client.ts (chat/completions)
    │   ├── prospecting/           # seed, forecast, referral, queries, contact (+ data/*.generated.ts)
    │   ├── hr/                    # rules.ts (férias, dias, tempo de empresa) e queries.ts (colaboradores, solicitações, comunicados)
    │   ├── payroll/queries.ts     # remuneração (só CEO e admin)
    │   ├── theme.ts / utils.ts    # tema claro/escuro, cn(), formatCurrency(), formatDate()
    ├── modules/<modulo>/pages/    # uma página por rota (ver tabela do §1); leads, settings (UsersAccess) têm components/; hr e payroll têm só pages/
    ├── modules/project-manager/   # CÓPIA do módulo do app Project Manager (não edite aqui; ver §7)
    ├── styles/globals.css         # tokens claro/escuro, fontes, foco visível, .kpi-card (opaco)
    ├── test/                      # sqlite.ts (createTestDb: SQLite real em memória com as migrations), mockDb.ts (useTestDb + mock de lib/db/client)
    └── types/index.ts             # tipos de domínio espelhando as tabelas
```

## 3. Stack e comandos

Node 22+ (CI usa 22; o `better-sqlite3` dos testes exige), npm, Rust estável (só para o desktop). Dependências principais: React 18, react-router-dom 6, @tanstack/react-query 5, @tanstack/react-table 8, Tailwind 3 + tailwindcss-animate, lucide-react, cmdk, recharts, framer-motion, zod, uuid, plugins Tauri (`sql`, `fs`, `dialog`, `shell`).

| Objetivo | Comando |
|---|---|
| Instalar | `npm install` |
| Dev (navegador, banco demo) | `npm run dev` → http://localhost:1420 |
| Dev (desktop, SQLite real) | `npm run tauri dev` |
| Typecheck | `npm run typecheck` (= `tsc --noEmit`) |
| Build (tsc + vite) | `npm run build` |
| Build desktop | `npm run tauri build` |
| Testes | `npm test` (= `vitest run`, uma vez) ou `npm run test:watch`; um arquivo: `npx vitest run src/lib/dev/devSeed.test.ts`. Ver "Testes" abaixo. |
| Lint | **não existe** ESLint configurado. |
| Regenerar seed de prospecção | `node scripts/site-prospecting/build-seed.mjs [caminho.csv]` |
| Atualizar o módulo Project Manager | `npm run sync:project-manager` (`-- --check` só compara) |

CI (`.github/workflows/ci.yml`): `npm ci`, `npx tsc --noEmit`, `npm test`, `cargo check` em `src-tauri`.

**Testes (vitest 2):** arquivos `src/**/*.test.ts` (Node) e `src/**/*.test.tsx` (jsdom, para componente), ao lado do código. `e2e/` (Playwright) e a cópia `src/modules/project-manager/` ficam fora.
- **SQLite real:** `createTestDb()` (`src/test/sqlite.ts`) abre um banco em memória (`better-sqlite3`), liga `foreign_keys` (como o sqlx do app) e aplica **todas** as migrations de `src-tauri/migrations` em ordem numérica, cada uma numa transação. Devolve `{ select<T>(sql, binds?), execute(sql, binds?) → {rowsAffected, lastInsertId}, close(), migrate(), appliedVersions, raw }`, compatível com `DatabaseLike`. `createTestDb({ upTo: N })` + `migrate()` testa upgrade de schema com dados antigos. `insertTestCompany(db)` cria empresa + uma conta por papel (`test-user-<papel>`).
- **Código que chama `getDb()`:** no topo do teste, `vi.mock("@/lib/db/client", () => import("@/test/mockDb"))` e `const testDb = useTestDb()`: cada teste recebe um banco novo, `getDb()` devolve esse banco e `isTauriRuntime()` é `true` (caminho do desktop). Exemplo: `src/lib/dev/devSeed.test.ts`. Vale também para teste de componente (jsdom) que grava no banco: `src/modules/settings/pages/SetupPage.test.tsx`.
- **Binds iguais aos do app desktop** (`tauri-plugin-sql` 2.x): `undefined`/`NaN` → `NULL`, número → `REAL`, `Date` → texto ISO, objeto/array → texto JSON e **booleano → texto `'true'`/`'false'`** (não 1/0). Em colunas 0/1, passe `1`/`0`. BigInt e binários são recusados (o plugin não grava). O banco de teste **não** emula o demo do navegador: SQL de tabela nova continua tendo de caber nos padrões do `demo.ts` (§4).
- `src/test/sample.test.ts` também confere que toda migration está registrada no `lib.rs` com a versão do prefixo, sem buracos.

## 4. Modelo de dados e onde fica

- **Desktop (Tauri):** SQLite via `@tauri-apps/plugin-sql`, arquivo `company-manager.db` no diretório de dados do app (macOS: `~/Library/Application Support/com.company.manager/`). Schema = `src-tauri/migrations/*.sql`, aplicadas pelo `lib.rs` (`Migration { version, sql }`). Banco é ignorado pelo git (`*.db`).
- **Navegador:** `src/lib/db/demo.ts` — banco em **localStorage** (`cm_demo_database_v4`) que **emula SQL por padrões de texto**. Seed fixo (empresa TechFlow `DEMO_COMPANY_ID = "demo-company"`, contas demo `DEMO_ACCOUNTS`). **Tabelas, colunas e `DEFAULT` vêm das próprias migrations** (`demoSchema.ts` lê `src-tauri/migrations/*.sql` via `import.meta.glob`; `demoSchema.test.ts` confere que bate com o SQLite real): tabela ou coluna nova numa migration já existe no demo, linhas salvas antes ganham as colunas com o `DEFAULT` (ou o backfill da migration, ex.: `paid_amount` das contas já pagas) ao abrir, e INSERT preenche o que faltar. Padrões entendidos: `SELECT * | SELECT col, col | SELECT count(*) AS x FROM t [WHERE ...] [ORDER BY col [ASC|DESC], ...] [LIMIT n]`; `INSERT [OR IGNORE|OR REPLACE] INTO t (cols) VALUES (...)` (uma linha); `UPDATE t SET col=valor, ... [WHERE ...]`; `DELETE FROM t [WHERE ...]`. WHERE: `col=?`, `col='texto'`, `col=número`, `col IS [NOT] NULL`, ligados por `AND`. Valores: `?`, `'texto'`, número, `NULL`, `datetime('now')`, `date('now')` (dia UTC) e `date('now','localtime')` (dia local). **Tudo fora disso é erro com "demo" na mensagem** (JOIN, alias `t.col`, `SUM`/`MAX`/`GROUP BY`, `IN`, `LIKE`, `<`, `OR`, expressão como `quantity + ?`, `ON CONFLICT`, `RETURNING`, coluna que não existe, id repetido em INSERT simples): **faça JOIN, soma e agrupamento em TypeScript**. As 17 tabelas do demo original (`LENIENT_TABLES`) mantêm o comportamento antigo das telas legadas (consultas fixas com JOIN/COUNT tratadas à mão e, se o WHERE não for entendido, filtro por empresa); as demais são estritas. **Diferenças conhecidas do SQLite** (o demo é só para visualização): não aplica UNIQUE (fora o `id`) nem FK — por isso, **antes de gravar algo que tem chave única, procure no TypeScript pela chave natural** (`fitid` por conta no extrato, SKU, `number`, nome da tag, `entity_tags`, competência da recorrência): reimportar OFX/planilha não pode duplicar no navegador, onde o UNIQUE não barra —, nulos vão por último na ordenação, booleanos ficam como booleanos (o desktop grava `'true'`). Teste qualquer SQL novo em SQLite real (`createTestDb()` de `src/test/sqlite.ts`, ver §3) **e** no demo (`createDemoDb()` relê o localStorage; exemplo em `src/lib/db/demo.test.ts`).
- Acesso: sempre `const db = await getDb()` (`src/lib/db/client.ts`) → `db.select<T>(sql, binds)` / `db.execute(sql, binds)`, com `?` posicionais. **O primeiro bind das consultas costuma ser `company_id`** (o demo depende disso).
- Convenções do schema (0001): IDs `TEXT` (uuid gerado no app), timestamps `TEXT` ISO (`datetime('now')`), `company_id` em quase tudo (multiempresa), **soft delete** com `deleted_at` (não use `DELETE` no fluxo normal), FKs ativas, índices por `company_id`/status/datas.
- Tabelas: `companies, users, departments, memberships` (núcleo/RBAC); `customers, contacts, leads, opportunities, proposals` (CRM); `projects, tasks`; `tickets, work_orders`; `inventory_items, stock_locations, stock_balances, stock_movements, custodies, suppliers`; `cost_centers, payables, receivables`; `documents, attachments`; `activities, audit_logs, notifications, automation_rules, approval_flows, approvals, settings` (0001); `user_settings` (0002); `service_packages, package_prices, revenue_scenarios, revenue_forecasts` + colunas novas em `leads` (0003); `package_prices.feature_note` e, em `leads`, `pricing_segment, referred_by, referral_status` (0004); `project_stages` + `tasks.stage_id` (0005); `employees, hr_requests, hr_announcements, hr_tasks` (0006); `employee_compensation` (0007, folha); CRM/ERP (0008, ver abaixo); arquivo real em `documents` (0009); em `users`, `password_algo`, `must_change_password` e `password_changed_at` (0010, senhas; ver §8b); mesclagem de clientes e dados de admissão (0011, abaixo).
- **CRM/ERP (0008):** catálogo `products` (`kind` produto|servico, `sku` único por empresa sem diferenciar maiúsculas; SKU vazio grava `NULL` e o índice também ignora `''`, `inventory_item_id` liga ao estoque), `price_lists`, `price_list_items`; vendas `sales_orders` + `sales_order_items`, `invoices` + `invoice_items` (parcelas da fatura = `receivables.invoice_id` + `installment_number/installment_count`); compras `purchase_orders` + `purchase_order_items`, `goods_receipts` + `goods_receipt_items` (entrada → `stock_movements` e `payables`); financeiro `finance_categories` (plano de contas por `parent_id`, `dre_group`), `bank_accounts`, `bank_transactions` (extrato; `amount` > 0 = entrada; `fitid` único por conta), `finance_settlements` (baixas totais/parciais), `recurring_entries` (no máximo um lançamento por competência); estoque `inventory_counts` + `inventory_count_items`; CRM `crm_activities`, `proposal_items`, `tags`, `entity_tags`, `saved_views`; RH `hr_time_entries` (banco de horas); `import_batches`. Colunas novas em `customers, contacts, suppliers, payables, receivables, stock_movements, proposals, opportunities, employees, hr_tasks`. **Dinheiro:** REAL com 2 casas, sempre arredondado com `src/lib/money.ts` (descontos em R$, `tax_rate` em %; total = subtotal − desconto + frete + impostos; parcelas com `splitInstallments`, a última absorve a diferença). **Numeração** (`number`): por empresa, contando excluídos, com `nextSequenceNumber(db, tabela, companyId)` e `formatSequence` (`PV-`, `FAT-`, `PC-`, `REC-`, `PROP-`, `INV-`). Os valores aceitos de `status`/`kind` estão nos tipos de `src/types/index.ts` (não há CHECK) e os rótulos/cores no `StatusBadge`.
- **CRM/RH extras (0011):** `customers.merged_into_id` (duplicado mesclado em outro; o mesclado também recebe `deleted_at`), em `employees` os dados de admissão `rg, pis, address_json` (`{ logradouro, numero, complemento, bairro, cidade, uf, cep }`, padrão `'{}'`), `emergency_contact_name, emergency_contact_phone`, e índices para vendas por vendedor, origem da movimentação (`stock_movements.ref_type/ref_id`), contas por fornecedor, atividades por contato, conciliação e pastas de documentos. **Movimentação de estoque:** `quantity` sempre positiva; o sentido vem dos locais — entrada (`to_location_id`), saída (`from_location_id`), transferência (os dois) e ajuste de inventário (`to` = sobra, `from` = falta) — e `ref_type/ref_id` dizem a origem (`goods_receipt`, `sales_order`, `inventory_count`, `transfer`).
- **Documentos com arquivo (0009):** `documents` ganhou `storage_key, original_name, mime, size_bytes, sha256, parent_version_id, folder, description` (bytes fora do banco: desktop em `$APPDATA/files/...`, navegador em IndexedDB).
- Tipos TypeScript das tabelas: `src/types/index.ts` (mantenha em sincronia com as migrations).
- **Prospecção de sites (migration 0003):** `leads` ganhou `project_id, category, business_type, whatsapp, google_rating, google_reviews, sem_site, online_presence, presence_kind, address, notes, source_url, package_id, estimated_setup, estimated_monthly, estimated_revenue, priority_rank, outreach_day, outreach_date, last_contact_at`. Status do funil: `novo → abordado → interessado → fechado` (os valores antigos `qualificado/descartado/convertido` seguem válidos no tipo). Valores de preço e previsão são **estimativas** (`is_estimate = 1`).
- **Seed:** `src/lib/prospecting/seed.ts` roda no primeiro login de papel que pode criar `leads` (`useProspectingBootstrap`, chamado no `AppShell`). Idempotente (flag `seed.site_prospecting.v3` em `settings`; ids uuid v5; `INSERT OR IGNORE`). Quem tinha o seed v1 ou v2 é migrado: leads são reapontados, os pacotes antigos são apagados e a previsão é refeita, sem tocar em status, contato ou indicação. Cria o projeto "Desenvolvimento de Site" com 5 etapas e 10 tarefas, os 3 pacotes **Básico / Essencial / Premium**, 39 preços (13 segmentos de preço × 3), 3 cenários (5/10/20%), 42 linhas de previsão e 155 leads. Dados em `src/lib/prospecting/data/siteProspecting.generated.ts` (**gerado**).
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
2. **Demo:** a tabela já existe no banco demo (o schema vem das migrations); só escreva SQL nos padrões do §4 (JOIN/soma/agrupamento em TypeScript) e teste também com `createDemoDb()`.
3. **RBAC:** em `rbac.ts`, inclua o recurso em `RESOURCES`, as permissões por papel em `PERMISSIONS` (recursos de CRM/ERP ficam em `ERP_PERMISSIONS`, mesclado por papel) e o mapeamento módulo → recurso em `visibleModules` (`moduleMap`); atualize a matriz de `rbac.test.ts` / `src/test/modules.test.ts`.
4. **Página:** `src/modules/<modulo>/pages/<Modulo>Page.tsx` (default export), seguindo `ProjectsPage.tsx`/`LeadsPage.tsx`.
5. **Rota:** `lazy()` + `<Route path="/<modulo>/*" element={<RequireModule module="<chave>">...}` em `routes.tsx`.
6. **Navegação:** item em `NAV_ITEMS` (`Sidebar.tsx`) e em `COMMANDS` (`CommandMenu.tsx`), com ícone lucide e grupo. Se o módulo tiver subpáginas (abas), inclua a seção em `MODULE_SECTIONS` e as páginas em `SUBPAGES` (`src/app/subpages.ts`, ver §6b).
7. **Status novos:** cores e rótulos em `StatusBadge.tsx`.
8. Rode `npm run typecheck`, `npm test` e `npm run build`; abra o módulo com um papel que tenha acesso e outro que não tenha.

## 6b. Pontos de extensão (contratos já prontos)

Os módulos de CRM/ERP se ligam por estes contratos, sem editar arquivos compartilhados:

- **Rotas e menus:** `/catalog`, `/sales`, `/purchasing`, `/reports` e `/imports` já estão em `routes.tsx`, `Sidebar.tsx` e `CommandMenu.tsx`, cada uma com uma página provisória (`export default function XxxPage()`); troque o conteúdo da página e crie subcomponentes em `modules/<modulo>/components/`. As rotas usam `/*`: subrotas ficam num `<Routes>` dentro da página.
- **Subpáginas** (`src/app/subpages.ts`): cada item de `SUBPAGES` (`module, path, page, label, requires`) já tem rota, guarda, aba e busca — a tarefa do módulo **só troca o conteúdo** do arquivo `src/modules/<page>` (hoje `PagePlaceholder`), sem mexer em `routes.tsx`, `Sidebar.tsx`, `CommandMenu.tsx` nem no registro. `routes.tsx` gera uma rota por item (página por `import.meta.glob`, `RequireSubpage` = `canOpenSubpage`: ver o módulo e ter `view`, ou a ação dada, em cada recurso de `requires`; senão volta ao início). Listas recebem `/*` (subrotas num `<Routes>` dentro da página); rotas com `:id` são detalhes, ficam fora das abas e da busca e acendem a aba da lista (leia o id com `useParams()`; `nova` = criar). `ModuleNav` (no `AppShell`, acima da página) mostra as abas do módulo da URL — raiz + listas que o papel abre — e some quando só sobra a raiz; a busca lista as mesmas listas como "Módulo › Página". Link para um detalhe: `navigate("/crm/clientes/" + id)`. `src/test/subpages.test.ts` e `src/app/routes.test.tsx` conferem registro, arquivos, guarda e abas.
- **Financeiro (`src/lib/erp`):** regras sem React e testadas em SQLite e no banco demo (`financeDemo.test.ts`): `financeCommon` (conta normalizada `FinanceEntry`, `parseMoneyInput`), `settlements` (baixa total/parcial com juros/multa/desconto, estorno, aprovar, cancelar, excluir), `financeSetup` (contas com parcelas, contas bancárias com padrão única, plano de contas sem ciclo, centros de custo, recorrências), `recurring` (`runRecurring`: id determinístico por competência, nunca duplica; a `FinancePage` roda uma vez por sessão), `cashflow` (realizado = baixas + extrato conciliado sem conta + quitadas antigas sem baixa; previsto = saldo em aberto no vencimento ou hoje), `dre` (competência; linha da DRE herdada do pai), `statement`/`reconcile` (OFX/CSV, `fitid` sem duplicar, casa sozinho só com um candidato exato). As telas usam `src/modules/finance/components/financeShared.tsx` e testes de tela usam `src/test/pageHarness.tsx`. Sem transação no plugin SQL: grave primeiro o que não perde dinheiro se a segunda escrita falhar.
- **Fornecedores e backup no RBAC:** recurso `suppliers` (Estoque cadastra e exclui; Financeiro cadastra e edita; Gerência e Auditoria consultam e exportam) e `backups` (só CEO e admin, pelo `"*"`).
- **Backup e restauração (Tauri):** comandos `backup_db({ destPath?, automatic? }) → BackupInfo`, `restore_db({ srcPath }) → RestoreInfo` e `list_backups() → BackupInfo[]` já registrados no `lib.rs`; o corpo fica em `src-tauri/src/backup.rs` (hoje respondem "ainda não estão disponíveis" e lista vazia). Tipos em `src/types/index.ts`. Formato combinado: `.cmbackup` (zip com `company-manager.db` via `VACUUM INTO` + pasta `files/`), padrão em `$APPDATA/backups/`; depois de restaurar, `restart_app`. A tela é `/settings/backup` (`settings/pages/BackupPage.tsx`).
- **Arrastar e soltar arquivos:** `dragDropEnabled: false` na janela (`tauri.conf.json`), então o `drop` do HTML5 entrega o `File` (planilhas na importação, anexos) também no desktop.
- **`<ImportExportButtons entity="customers" onImported={...} />`** (`components/shared/ImportExportButtons.tsx`): botões Importar/Exportar das listas; por enquanto desativados ("Em breve"). `entity` é a chave do registro abaixo.
- **Registro de importação** (`src/lib/importexport/registry.ts`): `FieldDef`, `ImportEntity<T>` (`key, label, resource, fields, schema` zod, `naturalKey`, `upsert(db, companyId, rows)`) e `registry`, montado por `import.meta.glob("./importers/*.ts")`. Para registrar uma entidade, crie `importers/<chave>.ts` com `export const entity: ImportEntity<Linha> = { key: "<chave>", ... }` (o teste exige chave = nome do arquivo e `resource` do RBAC).
- **`<FileAttachments entityType="customer" entityId={id} canEdit={...} />`** (`components/shared/FileAttachments.tsx`): anexos de um registro (`documents.entity_type/entity_id`); por enquanto só o estado vazio.
- **Dados de exemplo por área:** `src/lib/dev/seeds/<area>.ts` com `export async function seed(companyId: string): Promise<void>` entra sozinho em `runAreaSeeds` (ordem alfabética, depois do seed principal, mesmo quando a flag principal já existe; também no login rápido do navegador). Regras: ids fixos `dev-<area>-...`, `INSERT OR IGNORE`, flag própria (`hasSeedFlag`/`setSeedFlag` de `src/lib/dev/seedUtils.ts`, chave `seed.dev.<area>.v1`), SQL nos padrões do demo, **nunca leads**. No desktop o login rápido roda no **banco de verdade**: o seed de área só se apoia em (e só mexe em) registros de exemplo, lendo a base com `exampleRows` (ids `dev-...`; no demo do navegador, todos) e conferindo ids avulsos com `isExampleRecord`; em registro que já existe, só preenche campo vazio. Um seed que falha não derruba os outros (o erro volta no resultado). Seed que depende de dados de outro (clientes, fornecedores, itens) confere e, se faltar, volta **sem gravar a flag** (tenta no próximo login). Já existem, nesta ordem: `catalog` (produtos e tabelas de preço), `crm` (tags, contato principal, atividades, propostas numeradas com itens, visões salvas), `finance` (plano de contas e contas bancárias), `hr` (dados de admissão, admissão e desligamento com checklist, banco de horas), `imports` (histórico), `inventory` (contagens e transferência), `purchasing` (pedidos, recebimentos, entradas e contas a pagar), `sales` (pedidos, faturas em parcelas, saída do estoque) e `settlements` (recorrências, baixas e extrato conciliado/pendente; roda por último). Utilitários em `seedUtils.ts`: `insertRows`, `selectRows` (com `deleted_at`), `exampleRows`/`isExampleRecord` (só registros de exemplo no desktop), `selectAll` (tabelas sem `deleted_at`), `membersByRole`/`memberFor` (conta de cada papel, também no demo; no desktop, só vínculos de exemplo), `applyStockMovement` (grava a movimentação e acerta os saldos uma vez só), `day`/`ts` (dia local). `devSeed.test.ts` confere contagens, totais, parcelas, estoque, baixas, FKs e que registros reais ficam intactos; `seedsDemo.test.ts`, que tudo roda no banco demo.
- **Status:** rótulos e cores de pedidos, faturas, compras, recebimentos, extrato, atividades, propostas, importação e catálogo já estão no `StatusBadge`.
- **Datas de documento** (`order_date`, `issue_date`, `expected_date`, `due_date`, `posted_at`, `paid_at`, `entry_date`, `valid_until`...) são `'YYYY-MM-DD'` no **dia local**: grave `todayIso()` (`src/lib/utils.ts`) ou a data que a pessoa escolheu, sempre explícita. O `DEFAULT (date('now','localtime'))` de `sales_orders.order_date`, `invoices.issue_date` e `purchase_orders.order_date` é só a rede de segurança. **Nunca** use `date('now')` (UTC) nem `new Date().toISOString().slice(0, 10)` para "hoje": no Brasil (UTC−3), depois das 21h vira o dia seguinte. `src/test/schemaDefaults.test.ts` recusa migration nova com `DEFAULT (date('now'))`. Timestamps (`created_at`, `updated_at`, `confirmed_at`...) continuam instantes UTC (`datetime('now')` / `toISOString()`).
- **Contas a receber:** a descrição fica em `receivables.description` (0008). Contas gravadas pela tela antiga podem ter só `ref_id` com o texto: leia `description ?? ref_id`. `ref_type`/`ref_id` é a origem do lançamento (ex.: fatura), não texto livre.
- **Nomes parecidos:** o **módulo** `products` (rota `/products`) é *Desenvolvimento de Produtos* e usa o **recurso** `product_development`; o **recurso** `products` é o *Catálogo* (módulo `catalog`, rota `/catalog`, tabela `products`). Em `usePermission(..., "products")` você está falando do catálogo.
- **Arquivos no desktop:** `capabilities/default.json` libera ler, gravar (texto e binário), copiar, renomear, apagar e `mkdir` **só em `$APPDATA`** (anexos em `$APPDATA/files/...`, backup), e ler (`read-file`, `read-text-file`, `read-dir`, `stat`, `exists`) também em Downloads e Documentos. Fora disso, só o caminho que a pessoa escolheu em `dialog.open`/`dialog.save` (o diálogo libera esse caminho para os comandos do `fs`): para exportar ou baixar um arquivo, peça o destino com `save()`; para importar, `open()`. Diálogos liberados: `open`, `save`, `message`, `ask`, `confirm`. Não há permissão em `$APPCONFIG` nem na Mesa.
- **Reiniciar o app** (ex.: depois de restaurar um backup): comando Tauri `restart_app` (`invoke("restart_app")` de `@tauri-apps/api/core`). Para backup do banco, `VACUUM INTO ?` (bind = caminho do arquivo novo, fora de transação) gera uma cópia consistente; confirmado no SQLite dos testes.

## 7. Integração Company Manager ⇄ Project Manager

O Project Manager (`~/Documents/Trabalho/Sites/Project-Manager`, repositório git local separado, mesma stack) é a fonte da verdade do módulo de projetos. O Company Manager **embute o módulo**:

- **Código:** `src/modules/project-manager/` é uma **cópia** de `Project-Manager/src/module`, feita por `npm run sync:project-manager` (`scripts/sync-project-manager.mjs`). O módulo só usa imports relativos e pacotes que já existem aqui (react, react-router-dom, @tanstack/react-query, lucide-react, zod, uuid, clsx, tailwind-merge). **Não edite a cópia**: altere no Project Manager, rode o sync e commite o resultado (`--check` diz se está desatualizada).
- **Montagem:** `modules/projects/pages/ProjectsPage.tsx` renderiza `<ProjectManagerModule db companyId userId canEdit canCreate fileExchange />` na rota `/projects/*` (item "Project Manager" da sidebar), com o mesmo banco do Company Manager (tabelas `projects`, `project_stages` e `tasks`) e as permissões do recurso `projects`.
- **Funcionalidades:** lista de projetos com progresso e etapa atual; página do projeto com indicadores, **fluxo linear** (etapas concluídas, em andamento e a seguir; status derivado das tarefas), plano por etapa e quadro kanban; criar/editar/reordenar/remover etapas e tarefas.
- **Troca de arquivo com o app Project Manager:** botões *Importar/Exportar ... app Project Manager* geram/leem o bundle JSON `company-manager.project-bundle` v2 (projetos, etapas, tarefas; v1 ainda é lido). Upsert por `id`, só sobrescreve se `updated_at` for mais novo, `company_id` reescrito para o da sessão, pais das tarefas ligados só dentro da empresa, exclusões não viajam, importação não transacional. Importar exige `edit` e `create` em `projects`. Regras completas no `AGENTS.md` do Project Manager (§7).
- **O seed** cria o projeto "Desenvolvimento de Site" com etapas e tarefas, que já aparecem no fluxo.
- Se o módulo precisar de SQL novo, o banco demo (`src/lib/db/demo.ts`) precisa entendê-lo; os testes do módulo ficam no Project Manager (vitest, com SQLite real) e, daqui, valide com typecheck + build.

## 8. Cuidados (o que não mexer)

- **Migrations já existentes (`0001`–`0007`) não se editam:** o `tauri-plugin-sql` guarda checksum; mudar uma já aplicada quebra o banco do usuário. Sempre crie a próxima (`0008_...`) e registre no `lib.rs`.
- **Não edite** `src/modules/project-manager/` (cópia do Project Manager; ver §7) nem `src/lib/prospecting/data/siteProspecting.generated.ts` à mão — rode o gerador. Preços ficam em `scripts/site-prospecting/pricing.mjs` e vêm da Proposta Comercial (`~/LeadingSitesSorocaba/Proposta_Comercial.md`, preços fixos); a previsão de receita continua sendo estimativa.
- **Não toque no banco real** (`~/Library/Application Support/com.company.manager/company-manager.db`) por fora do app; teste com migrations em um SQLite temporário.
- **Segredos:** nunca commitar `.env*`, `*.db`, chaves de API. A chave do Assistente IA fica em `localStorage` (`cm_assistant_api_<userId>`) em texto puro e a CSP do Tauri está `null` — não coloque credenciais de produção em testes. Senhas: ver "Senhas" no §8b; as contas demo são só para demonstração.
- **RBAC sem exceções:** `can()` só lê a tabela `PERMISSIONS` (`"*"` = as mesmas ações em todos os recursos, CEO e admin); a única regra fora da tabela é o `hr_self` (Meu RH) de todos os papéis. Quem vê cada recurso está fixado em `VIEW_MATRIX` de `src/lib/permissions/rbac.test.ts`, que também confere que `can()` espelha `PERMISSIONS` em todo papel × recurso × ação: mudar acesso é mudar a tabela **e** a matriz.
- Banco demo: mudar o formato do seed sem trocar `STORAGE_KEY` deixa navegadores com dados antigos (tabelas e colunas novas das migrations são completadas em `load()`; linhas novas do seed, não).
- `design-system.html`, `src-tauri/icons/` e `Cargo.lock` são artefatos versionados; não regenere sem motivo.
- O repositório está em `~/Documents` (iCloud Drive): arquivos podem ficar "somente na nuvem" (dataless) e travar `tsc`/`vite`. Se acontecer: `brctl download "<pasta>"`.
- Tema escuro é o padrão (`getTheme()`).

## 8b. Contas, login e RH

- **Login (`modules/settings/pages/LoginPage.tsx`):** um único card centralizado (sem painel lateral) com os botões "Entrar com Google", "Entrar com Microsoft" e "Entrar com GitHub" empilhados, cada um entrando direto, e abaixo e-mail e senha (mostrar/ocultar), "Esqueci minha senha" e o botão Entrar. **Os botões sociais ainda não entram**: `lib/auth/social.ts` explica o que falta (registrar o aplicativo no provedor e um servidor para concluir o OAuth). "Esqueci minha senha" é informativo (não há e-mail): quem redefine é o CEO ou a Administração, em Configurações, Usuários e acessos. **O e-mail não diferencia maiúsculas de minúsculas** (login compara `lower(email)`; contas novas são gravadas em minúsculas). **Revalidação:** `App.tsx` confere o papel da sessão no banco ao abrir e quando a janela ganha foco (`revalidateSession`); rebaixar ou remover alguém vale sem ele sair e entrar, e uma sessão cujo vínculo não é da própria conta e empresa é encerrada. Não há mais lista de contas na tela.
- **Contas demo (`DEMO_ACCOUNTS` em `lib/db/demo.ts`, só no navegador):** `ceo@techflow.com` (CEO, controle geral), `admin@techflow.com`, `gerencia@techflow.com`, e por setor `gerente.<setor>@techflow.com` / `<setor>@techflow.com` (ti, estoque, financeiro, comercial, atendimento, produtos, auditoria, rh). A senha demo fica no mesmo arquivo. Bancos já salvos no navegador recebem as contas novas e os dados de RH ao abrir.
- **RH (`lib/hr/` + `modules/hr/`):** regras puras em `rules.ts` (dias da solicitação, saldo de férias do ano, quem está de férias, tempo de empresa), consultas em `queries.ts`. `ensureMyEmployee` cria o cadastro do próprio usuário (ou liga o que o RH já cadastrou com o mesmo e-mail) na primeira visita ao Meu RH **ou ao Dashboard**, que o chama no primeiro login de qualquer papel. Ao cadastrar um colaborador, o RH completa o cadastro existente com o mesmo e-mail em vez de duplicar. O saldo de férias é o do **ano em que as férias começam** (vale para a validação do pedido e para a aprovação, que também confere o status e reconfere o saldo no banco); férias que cruzam o ano contam inteiras no ano de início. Aprovar/recusar e criar colaborador/comunicado/pendência exigem `hr_admin`. **O RH não tem salário**: remuneração fica em `employee_compensation` (0007), lida só pela Folha de pagamento (`payroll`, CEO e admin). O histórico de atividades da folha não grava valores.
- **Usuários e acessos** (Configurações, para quem tem `create` em `users`: CEO e admin): lista as contas, cria conta (nome, e-mail, senha inicial, papel; por padrão pede a troca no primeiro acesso) e troca o papel de alguém (menos o próprio). Também **redefine a senha** de alguém (CEO redefine qualquer uma; a Administração, as dos demais, nunca a do CEO; por padrão a pessoa troca a senha no próximo acesso) e **força ou dispensa a troca de senha** (selo "Troca de senha pendente"). É assim que se cria o RH, o comercial etc. no app desktop. A conta criada no **Setup (primeiro acesso do desktop) é o CEO** da empresa: só o CEO concede o papel de CEO. O Setup recusa rodar se já existe empresa e tem a opção **"Criar também uma conta para cada setor"** (`seedRoleAccounts`: `<papel>@empresa.local` ou outro domínio, nome = rótulo do papel, uma senha inicial comum, troca obrigatória no primeiro acesso; papel que já tem conta e e-mail já usado ficam de fora).
- **Senhas (`lib/auth/hash.ts`, migration 0010):** o formato vem no próprio `users.password_hash`: `$argon2id$...` (app desktop, comandos Rust `hash_password`/`verify_password` em `src-tauri/src/auth.rs`, crate `argon2`), `pbkdf2$sha256$600000$...` (navegador, WebCrypto) ou o legado `plain:<senha>`. O login confere os três e regrava em silêncio o que não é o padrão do ambiente (`plain:` e PBKDF2 viram argon2id no desktop); falha ao regravar não impede a entrada. Além disso, o app desktop converte **todos** os `plain:` restantes ao abrir (`upgradeLegacyPasswords`, em `App.tsx`), sem mudar a senha de ninguém. `users.password_algo` só espelha o formato (gatilhos SQLite; o app não grava). Se o comando nativo falhar ao gerar o hash, `hashPassword()` cai para PBKDF2 (o próximo login tenta o argon2 de novo). O argon2 roda em `spawn_blocking`; no perfil dev os crates `argon2` e `blake2` são compilados com `opt-level = 3` (sem isso o login leva segundos no `tauri dev`). Trocas, redefinições e exigências de troca vão para `activities` (`user.password_*`), nunca com a senha. Senha nova: mínimo 6 caracteres e não só espaços (`passwordProblem`). **Troca obrigatória:** `users.must_change_password = 1` vai na sessão; `App.tsx` mostra só `ChangePasswordPage` até a troca, e a revalidação (foco da janela) aplica a exigência a sessões já abertas. Conta suspensa não entra (a mensagem só aparece com a senha certa). Para criar contas use `createUserAccount` (`lib/auth/accounts.ts`); o banco demo tem tratadores fixos para `INSERT INTO users`/`memberships`, por isso a flag vai num `UPDATE` e o vínculo num `INSERT OR IGNORE`.
- A autorização é feita no cliente (RBAC do front-end), como no resto do app: não há servidor que a imponha.
- **Banco do app desktop compartilhado com outro checkout:** o identificador do app é `com.company.manager` e existe outra cópia do projeto em `~/vibecode-claude/Company-Manager`, cuja `0001_init.sql` tem um `INSERT` de conta demo a mais (checksum diferente). Se `company-manager.db` foi criado por aquela cópia, o `tauri-plugin-sql` recusa as migrations deste repositório (`VersionMismatch(1)`) e o app não abre. Não edite a `0001` nem o banco: faça backup do arquivo e deixe o app recriá-lo, ou dê outro `identifier` a uma das cópias. Decisão do André (pendente); nada disso foi executado.
- **Componentes de acessibilidade compartilhados:** `components/shared/useModalFocus.ts` (foco entra, Tab preso, Esc fecha, foco volta; usado por `CrudDialog` e `DetailDrawer`, que têm `role="dialog"` e `aria-modal`) e `components/shared/Tabs.tsx` (`TabList` com setas e `TabPanel` com `aria-controls`/`aria-labelledby`). Use-os em telas novas. O campo de senha do `CrudDialog` é `type: "password"`.
- **Cor de texto do primário:** use `text-primary-text` (token `--primary-text`, claro e escuro com contraste ≥ 4,5) para links e destaques em texto; `text-primary` puro é para ícones e bordas. Em verde, `text-emerald-700 dark:text-emerald-400`.
- **Datas:** `formatDay` recebe `YYYY-MM-DD` (mostra como está) ou timestamp com horário (mostra o dia no fuso local; horário sem fuso, como o `datetime('now')` do SQLite, é UTC).
- **Folha:** `monthlyPayroll` (`lib/payroll/queries.ts`) é a única regra do total (exclui desligados); a tela de Folha e o Dashboard usam a mesma e a edição invalida os dois.
- **Seed de prospecção, upgrade:** quem tem seed v1/v2 recebe pacotes, preços, agenda de abordagem (rank, dia, data) e a descrição nova da tarefa de pacotes, sem perder status, contato ou indicação. O projeto do seed é achado pelo id determinístico (`siteProjectSeedId`), então renomeá-lo no Project Manager não o perde. O id do lead usa a posição no CSV: **regerar o seed com um CSV diferente embaralha os ids**; suba a chave (`seed.site_prospecting.vN`) e escreva a migração dos ids antes.

## 9. Regras de negócio do projeto de sites (instruções do André)

Estas regras vêm de `~/LeadingSitesSorocaba/INSTRUCAO_*.md` e valem para o CRM, o seed e qualquer texto de negócio:

- **Pacotes (nomes exatos): BÁSICO, ESSENCIAL e PREMIUM.** Não use "Médio", "Completo", "Com agendamento" nem "Com funcionalidade-chave" (pacotes antigos, apagados). BÁSICO = só a vitrine (site público para o cliente final); ESSENCIAL = só o gerenciador (painel com login, específico do segmento, sem vitrine pública); PREMIUM = vitrine + gerenciador, com chave para ativar/desativar a gestão. Preços fixos da Proposta Comercial: implantação de R$ 1.600 a R$ 12.000 + mensalidade, com fidelidade de 12 meses. Tabela final em `~/LeadingSitesSorocaba/PACOTES_PRECOS.md` (regenere com `node scripts/site-prospecting/export-pacotes.mjs`).
- **Programa de Indicação (escalonado), só vale quando o indicado FECHA** (contrato assinado e pago): por indicado fechado, quem indica ganha 1 mês grátis na mensalidade e o indicado ganha 10% de desconto no setup; 3 fechados = +1 mês extra e 5 fechados = +2 meses extras para quem indica; indicação que não fecha não conta nem gera benefício; vale para qualquer pacote. No CRM: campos `referred_by` e `referral_status` (pendente até o fechamento, depois concedido), aba *Indicações* com a contagem de fechadas por quem indicou e os níveis atingidos (`src/lib/prospecting/referral.ts`, regras em `REFERRAL_RULES`). Os bônus de nível **não se somam** (decisão do André): vale só o maior nível atingido (`cumulative: false`); com 5 fechados são 5 meses + 2 extras = 7.
- **Skills por categoria** e **dois módulos por site** (vitrine + painel com toggle): ver `~/LeadingSitesSorocaba/AGENTS.md`. O CRM guarda os pacotes; as skills guardam os templates dos sites.
- Textos voltados ao negócio (propostas, tabelas de preço, documentos para clientes) **não mencionam Claude Code, agentes nem automações**. A redação da seção "Programa de Indicação" da Proposta Comercial e do Plano no Drive é do André.

## 10. Checklist antes de commitar

- [ ] `npm run typecheck` sem erros.
- [ ] `npm test` passa (lógica nova com teste, SQL testado com `createTestDb`).
- [ ] `npm run build` conclui.
- [ ] Se mexeu em SQL: o banco demo suporta (teste com `createDemoDb()` ou abra a tela no `npm run dev`) **e** o SQLite real aceita (teste com `createTestDb()`, que aplica as migrations em memória).
- [ ] Nova migration criada (não editou as antigas), registrada em `lib.rs`, tipos atualizados.
- [ ] Novo recurso/módulo: RBAC (`rbac.ts`), rota (`routes.tsx`), sidebar e `CommandMenu`.
- [ ] Textos de UI em pt-BR; cores via tokens; componentes de `components/shared` reutilizados.
- [ ] Sem segredos, `.db` ou `dist/` no diff (`git status`).
- [ ] Se mudou o contrato do bundle: atualizou também o Project Manager.
- [ ] Mensagem de commit em Conventional Commits, em português; **sem push**.
