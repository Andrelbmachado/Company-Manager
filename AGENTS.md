# AGENTS.md — Company Manager

Guia para agentes de IA (e pessoas) trabalharem neste repositório. Tudo aqui foi extraído do código; quando algo **não existe** (ex.: testes), está dito explicitamente.

## 1. Mapa do projeto e módulos

Company Manager é um sistema modular de gestão (ERP + CRM + ITSM + projetos) em **Tauri 2 + Vite + React 18 + TypeScript + Tailwind**. Roda como app desktop (SQLite) ou no navegador (banco demo em localStorage). A interface é em **pt-BR**.

Cada módulo é uma página lazy em `src/modules/<modulo>/pages/`, registrada em `src/app/routes.tsx`, controlada por RBAC em `src/lib/permissions/rbac.ts` (`visibleModules`) e exibida em `src/app/layout/Sidebar.tsx` / `CommandMenu.tsx`.

| Módulo (chave) | Rota | Recurso RBAC | Página | Observação |
|---|---|---|---|---|
| dashboard | `/` | — (sempre visível) | `dashboard/pages/DashboardPage.tsx` | KPIs do que o papel pode ver, mais saldo de férias e pendências de RH |
| hr | `/hr` | `hr_self` (todos os papéis) | `hr/pages/MyHrPage.tsx` | **Meu RH**: férias, solicitações, comunicados do RH e pendências do próprio colaborador |
| hr_manage | `/hr/manage` | `hr_admin` (RH, CEO, admin) | `hr/pages/HrManagePage.tsx` | **Gestão de RH**: colaboradores, solicitações (aprovar/recusar), comunicados, pendências; sem salário |
| payroll | `/payroll` | `payroll` (**só CEO e admin**) | `payroll/pages/PayrollPage.tsx` | **Folha de pagamento**: salário base por colaborador e soma mensal (questão administrativo-financeira) |
| crm | `/crm` | `customers` | `crm/pages/CrmPage.tsx` | clientes; `can()` só libera para o papel `comercial` |
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
| audit | `/audit` | `audit_logs` | `settings/pages/AuditPage.tsx` | `can()` só libera para o papel `tecnico` |
| settings | `/settings` | `settings` | `settings/pages/SettingsPage.tsx` | no menu da conta; IA, tema |
| assistant | `/assistant` | — (sempre visível) | `assistant/pages/AssistantPage.tsx` | chat com API compatível com OpenAI |

Papéis (`Role` em `src/types/index.ts`): `ceo`, `admin`, `gerente`, `tecnico`, `estoquista`, `financeiro`, `rh`, `comercial`, `atendimento`, `produtos`, `auditor`. **O papel vem da conta (e-mail + senha)**; a tela de login é única e cada setor só vê os módulos do seu papel (`visibleModules`). `ceo` vê tudo (inclusive CRM, auditoria, Gestão de RH e Folha de pagamento); `financeiro` tem **todo o financeiro** (o RBAC libera ver, criar, editar, apagar, aprovar e exportar contas a pagar e a receber; a tela `FinancePage` hoje só oferece criar e editar) **menos as questões administrativo-financeiras** (folha de pagamento); `rh` vê Gestão de RH, Meu RH, dashboard, assistente, suporte, documentos e configurações (sem salário); todos os papéis têm o Meu RH. A folha (`payroll`) só aparece para `ceo` e `admin`.

## 2. Árvore de pastas

```
.
├── AGENTS.md / CLAUDE.md          # este guia (CLAUDE.md só importa AGENTS.md)
├── README.md                      # visão geral em pt-BR
├── design-system.html             # referência visual do design system (estático, usa os tokens atuais)
├── components.json                # config shadcn (aliases @/components, @/lib...)
├── package.json                   # scripts e dependências
├── vite.config.ts                 # porta 1420, alias @ -> src, ignora src-tauri no watch
├── tailwind.config.js             # tokens shadcn (hsl(var(--...))), darkMode: class
├── scripts/sync-project-manager.mjs   # copia o módulo do Project Manager para src/modules/project-manager (`npm run sync:project-manager`)
├── scripts/site-prospecting/      # gerador do seed de prospecção (ver §4 e §8)
│   ├── pricing.mjs                #   pacotes Básico/Essencial/Premium, preços da Proposta, cenários, tarefas, cronograma
│   ├── build-seed.mjs             #   CSV -> src/lib/prospecting/data/siteProspecting.generated.ts
│   └── export-pacotes.mjs         #   gera ~/LeadingSitesSorocaba/PACOTES_PRECOS.md (preços + previsão)
├── .github/workflows/             # ci.yml (tsc + cargo check), release.yml (tags v*)
├── src-tauri/
│   ├── Cargo.toml                 # crate company-manager; plugins sql(sqlite)/fs/dialog/shell
│   ├── tauri.conf.json            # identifier com.company.manager, devUrl :1420
│   ├── capabilities/default.json  # permissões sql/fs/dialog/shell do webview
│   ├── migrations/                # 0001_init … 0004_packages_referral, 0005_project_stages, 0006_hr, 0007_payroll
│   ├── src/lib.rs                 # registra as migrations (versão -> arquivo) e os plugins
│   └── icons/
└── src/
    ├── main.tsx                   # QueryClientProvider + tema
    ├── app/
    │   ├── App.tsx                # SessionContext + BrowserRouter
    │   ├── routes.tsx             # rotas lazy + RequireModule (RBAC)
    │   └── layout/                # AppShell (topbar, bootstrap), Sidebar, CommandMenu (Cmd/Ctrl+K)
    ├── components/shared/         # PageHeader, PageToolbar, CrudDialog, DetailDrawer, EmptyState, StatusBadge (tags sólidas), StatCard e KpiCard (valor grande)
    ├── components/ui/             # vazio: nenhum componente shadcn instalado ainda
    ├── hooks/                     # useSession, usePermission, useProspectingBootstrap
    ├── lib/
    │   ├── db/                    # client.ts (SQLite/Tauri ou demo), demo.ts (banco demo + contas demo)
    │   ├── auth/                  # login.ts (senha "plain:" V1), session.ts (sessionStorage), social.ts (botões Google/Microsoft/GitHub: só explicam o que falta)
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
| Atualizar o módulo Project Manager | `npm run sync:project-manager` (`-- --check` só compara) |

CI (`.github/workflows/ci.yml`): `npm ci`, `npx tsc --noEmit`, `cargo check` em `src-tauri`.

## 4. Modelo de dados e onde fica

- **Desktop (Tauri):** SQLite via `@tauri-apps/plugin-sql`, arquivo `company-manager.db` no diretório de dados do app (macOS: `~/Library/Application Support/com.company.manager/`). Schema = `src-tauri/migrations/*.sql`, aplicadas pelo `lib.rs` (`Migration { version, sql }`). Banco é ignorado pelo git (`*.db`).
- **Navegador:** `src/lib/db/demo.ts` — banco em **localStorage** (`cm_demo_database_v4`) que **emula SQL por padrões de texto**. Seed fixo (empresa TechFlow, contas demo `DEMO_ACCOUNTS`). Consulta/comando fora dos padrões lança `Consulta demo nao suportada` / `Comando demo nao suportada`. Há um fallback genérico para `INSERT [OR IGNORE|OR REPLACE]`, `UPDATE ... WHERE ...` e `SELECT ... WHERE ...` nas tabelas novas (`EXTRA_TABLES`: leads, service_packages, package_prices, revenue_scenarios, revenue_forecasts, settings, tasks, project_stages, employees, hr_*, employee_compensation). O WHERE só aceita `col=?`, `col IS [NOT] NULL` ligados por `AND`: nessas tabelas, qualquer outra condição (`IN`, `LIKE`, `<`, `OR`) **lança erro** em vez de devolver linhas a mais. **Diferenças conhecidas do SQLite** (o demo é só para visualização): não aplica UNIQUE nem FK, `normalize()` baixa a caixa de literais de texto no SQL (use binds), nulos vão por último na ordenação, `COUNT(*)` e `LIMIT` só nos formatos fixos. Teste qualquer SQL novo em SQLite real (migrations aplicadas em memória) **e** no demo.
- Acesso: sempre `const db = await getDb()` (`src/lib/db/client.ts`) → `db.select<T>(sql, binds)` / `db.execute(sql, binds)`, com `?` posicionais. **O primeiro bind das consultas costuma ser `company_id`** (o demo depende disso).
- Convenções do schema (0001): IDs `TEXT` (uuid gerado no app), timestamps `TEXT` ISO (`datetime('now')`), `company_id` em quase tudo (multiempresa), **soft delete** com `deleted_at` (não use `DELETE` no fluxo normal), FKs ativas, índices por `company_id`/status/datas.
- Tabelas: `companies, users, departments, memberships` (núcleo/RBAC); `customers, contacts, leads, opportunities, proposals` (CRM); `projects, tasks`; `tickets, work_orders`; `inventory_items, stock_locations, stock_balances, stock_movements, custodies, suppliers`; `cost_centers, payables, receivables`; `documents, attachments`; `activities, audit_logs, notifications, automation_rules, approval_flows, approvals, settings` (0001); `user_settings` (0002); `service_packages, package_prices, revenue_scenarios, revenue_forecasts` + colunas novas em `leads` (0003); `package_prices.feature_note` e, em `leads`, `pricing_segment, referred_by, referral_status` (0004); `project_stages` + `tasks.stage_id` (0005); `employees, hr_requests, hr_announcements, hr_tasks` (0006); `employee_compensation` (0007, folha).
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
2. **Demo:** garanta que o banco demo entende suas consultas — adicione a tabela em `DemoTables`/`EXTRA_TABLES` de `src/lib/db/demo.ts` (o fallback genérico cobre `SELECT ... WHERE`, `INSERT` e `UPDATE` simples; casos especiais precisam de handler).
3. **RBAC:** em `rbac.ts`, inclua o recurso no tipo `Resource`, as permissões por papel em `PERMISSIONS` e o mapeamento módulo → recurso em `visibleModules` (`moduleMap`).
4. **Página:** `src/modules/<modulo>/pages/<Modulo>Page.tsx` (default export), seguindo `ProjectsPage.tsx`/`LeadsPage.tsx`.
5. **Rota:** `lazy()` + `<Route path="/<modulo>/*" element={<RequireModule module="<chave>">...}` em `routes.tsx`.
6. **Navegação:** item em `NAV_ITEMS` (`Sidebar.tsx`) e em `COMMANDS` (`CommandMenu.tsx`), com ícone lucide e grupo.
7. **Status novos:** cores e rótulos em `StatusBadge.tsx`.
8. Rode `npm run typecheck` e `npm run build`; abra o módulo com um papel que tenha acesso e outro que não tenha.

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
- **Segredos:** nunca commitar `.env*`, `*.db`, chaves de API. A chave do Assistente IA fica em `localStorage` (`cm_assistant_api_<userId>`) em texto puro e a CSP do Tauri está `null` — não coloque credenciais de produção em testes. Senhas V1 usam prefixo `plain:` (`lib/auth/login.ts`, TODO: argon2 via comando Tauri); as contas demo são só para demonstração.
- **RBAC com exceções embutidas:** `can()` bloqueia `customers` para qualquer papel que não seja `comercial` e `audit_logs` para qualquer papel que não seja `tecnico` (inclusive `admin`). Mudar isso altera o acesso a CRM e Auditoria.
- Banco demo: mudar o formato do seed sem trocar `STORAGE_KEY` deixa navegadores com dados antigos (tabelas novas são completadas em `load()`).
- `design-system.html`, `src-tauri/icons/` e `Cargo.lock` são artefatos versionados; não regenere sem motivo.
- O repositório está em `~/Documents` (iCloud Drive): arquivos podem ficar "somente na nuvem" (dataless) e travar `tsc`/`vite`. Se acontecer: `brctl download "<pasta>"`.
- Tema escuro é o padrão (`getTheme()`).

## 8b. Contas, login e RH

- **Login (`modules/settings/pages/LoginPage.tsx`):** um único card centralizado (sem painel lateral) com os botões "Entrar com Google", "Entrar com Microsoft" e "Entrar com GitHub" empilhados, cada um entrando direto, e abaixo e-mail e senha (mostrar/ocultar), "Esqueci minha senha" e o botão Entrar. **Os botões sociais ainda não entram**: `lib/auth/social.ts` explica o que falta (registrar o aplicativo no provedor e um servidor para concluir o OAuth). "Esqueci minha senha" é informativo (não há e-mail): quem redefine é o CEO ou a Administração, em Configurações, Usuários e acessos. **O e-mail não diferencia maiúsculas de minúsculas** (login compara `lower(email)`; contas novas são gravadas em minúsculas). **Revalidação:** `App.tsx` confere o papel da sessão no banco ao abrir e quando a janela ganha foco (`revalidateSession`); rebaixar ou remover alguém vale sem ele sair e entrar. Não há mais lista de contas na tela.
- **Contas demo (`DEMO_ACCOUNTS` em `lib/db/demo.ts`, só no navegador):** `ceo@techflow.com` (CEO, controle geral), `admin@techflow.com`, `gerencia@techflow.com`, e por setor `gerente.<setor>@techflow.com` / `<setor>@techflow.com` (ti, estoque, financeiro, comercial, atendimento, produtos, auditoria, rh). A senha demo fica no mesmo arquivo. Bancos já salvos no navegador recebem as contas novas e os dados de RH ao abrir.
- **RH (`lib/hr/` + `modules/hr/`):** regras puras em `rules.ts` (dias da solicitação, saldo de férias do ano, quem está de férias, tempo de empresa), consultas em `queries.ts`. `ensureMyEmployee` cria o cadastro do próprio usuário (ou liga o que o RH já cadastrou com o mesmo e-mail) na primeira visita ao Meu RH **ou ao Dashboard**, que o chama no primeiro login de qualquer papel. Ao cadastrar um colaborador, o RH completa o cadastro existente com o mesmo e-mail em vez de duplicar. O saldo de férias é o do **ano em que as férias começam** (vale para a validação do pedido e para a aprovação, que também confere o status e reconfere o saldo no banco); férias que cruzam o ano contam inteiras no ano de início. Aprovar/recusar e criar colaborador/comunicado/pendência exigem `hr_admin`. **O RH não tem salário**: remuneração fica em `employee_compensation` (0007), lida só pela Folha de pagamento (`payroll`, CEO e admin). O histórico de atividades da folha não grava valores.
- **Usuários e acessos** (Configurações, para quem tem `create` em `users`: CEO e admin): lista as contas, cria conta (nome, e-mail, senha inicial, papel) e troca o papel de alguém (menos o próprio). Também **redefine a senha** de alguém (CEO redefine qualquer uma; a Administração, as dos demais, nunca a do CEO). É assim que se cria o RH, o comercial etc. no app desktop; senha ainda usa o prefixo `plain:`. A conta criada no **Setup (primeiro acesso do desktop) é o CEO** da empresa: só o CEO concede o papel de CEO.
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
- [ ] `npm run build` conclui.
- [ ] Se mexeu em SQL: o banco demo suporta (abra a tela no `npm run dev`) **e** o SQLite real aceita (aplique as migrations em um `sqlite3` temporário e rode a consulta).
- [ ] Nova migration criada (não editou as antigas), registrada em `lib.rs`, tipos atualizados.
- [ ] Novo recurso/módulo: RBAC (`rbac.ts`), rota (`routes.tsx`), sidebar e `CommandMenu`.
- [ ] Textos de UI em pt-BR; cores via tokens; componentes de `components/shared` reutilizados.
- [ ] Sem segredos, `.db` ou `dist/` no diff (`git status`).
- [ ] Se mudou o contrato do bundle: atualizou também o Project Manager.
- [ ] Mensagem de commit em Conventional Commits, em português; **sem push**.
