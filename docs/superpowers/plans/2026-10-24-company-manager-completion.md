# Company Manager — Completar CRM/ERP, Logins por Setor, Import/Export e DMG

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar o Company Manager num app macOS instalável (DMG) com CRM e ERP completos, uma conta/tela por papel, upload/download real de documentos e importação/exportação CSV/XLSX de todos os dados.

**Architecture:** Mantém Tauri 2 + React + SQLite local (um banco por instalação; "qualquer um instala e gerencia a própria empresa" = cada instalação é uma empresa, via `SetupPage`). Todo módulo novo segue o padrão de `AGENTS.md` §6 (migration → demo DB → RBAC → página → rota → nav). Um motor de importação/exportação único (registro de "entidades importáveis") serve todos os módulos. Arquivos de documentos ficam em disco (pasta de dados do app), metadados no SQLite.

**Tech Stack:** Tauri 2, Vite, React 18, TS, Tailwind, TanStack Query/Table, zod, `tauri-plugin-sql|fs|dialog`, + novos: `vitest`, `papaparse`, `read-excel-file`, `write-excel-file`, `@playwright/test`.

**Spec:** pedido do André em 2026-10-24 (chat): DMG para MacBook; CRM e ERP completos; telas e login de todos os tipos de funcionário (cada login → conta diferente); upload/download de documentos; importar CSV/XLSX para ERP, CRM e demais módulos; uso inicial só na empresa dele, depois distribuível. Base técnica: `AGENTS.md` do repositório.

## Global Constraints

- UI 100% pt-BR; cores via tokens; reutilizar `components/shared` (`CrudDialog`, `DetailDrawer`, `PageHeader`, `KpiCard`, `StatusBadge`, `EmptyState`).
- Migrations `0001`–`0007` **não se editam**. Novas: `0008_crm_erp_core.sql`, `0009_documents_files.sql`, `0010_auth_hash.sql` — registrar em `src-tauri/src/lib.rs` com `version: N`.
- Toda tabela nova: `id TEXT PK`, `company_id`, `created_at`, `updated_at`, `deleted_at` (soft delete). Nada de `DELETE` no fluxo normal.
- Todo SQL novo precisa rodar no banco demo (`src/lib/db/demo.ts`) **e** no SQLite real (testado com `sqlite3` temporário, nunca no banco real em `~/Library/Application Support/com.company.manager/`).
- Não editar `src/modules/project-manager/` nem `*.generated.ts` à mão.
- Papéis (11): `ceo, admin, gerente, tecnico, estoquista, financeiro, rh, comercial, atendimento, produtos, auditor`. Folha (`payroll`) só `ceo` e `admin`.
- Sem segredos/`.db`/`dist/` no commit. Commits Conventional Commits em português, **sem push**.
- Repo está no iCloud Drive: se `tsc`/`vite` travar, `brctl download "<pasta>"`.
- Verificação mínima de cada tarefa: `npm run typecheck && npm test && npm run build`.

## Estado atual (análise, 2026-10-24)

- Já existe: Tauri configurado (`bundle.targets: "all"`, ícones, CI e `release.yml`), 7 migrations, 11 papéis com RBAC, login único, setup inicial, ~18 módulos, banco demo em localStorage. `src-tauri/target/debug` existe; **build release/DMG nunca gerado** (build iniciado em background nesta sessão: log em `scratchpad/dmg-build.log`).
- **Lacunas encontradas:**
  1. Sem runner de testes e sem lint (só typecheck/build).
  2. **Nenhuma importação/exportação CSV/XLSX** (só bundle JSON do Project Manager).
  3. **Documentos são só metadados**: `DocumentsPage` grava `file_path` fictício, não guarda bytes nem baixa arquivo.
  4. Senhas `plain:` (TODO argon2); CSP `null`; chave de IA em `localStorage`.
  5. RBAC com exceção que contradiz "CEO vê tudo": `can()` bloqueia `customers` para todo papel ≠ `comercial` (inclusive CEO/admin/gerente) e `audit_logs` para ≠ `tecnico`.
  6. CRM raso: `CrmPage` só lista/edita clientes; `contacts` e `proposals` existem no schema sem UI; sem timeline de atividades, funil kanban, conversão lead→oportunidade→cliente, proposta com itens/PDF.
  7. ERP inexistente além de estoque/financeiro simples: sem catálogo de produtos/serviços, compras (pedido→recebimento→estoque), vendas/faturas, plano de contas/categorias, fluxo de caixa, DRE, conciliação, recorrências. `FinancePage` só cria/edita (sem excluir/aprovar/pagar apesar do RBAC permitir).
  8. Sem backup/restauração, sem atualização automática, DMG não assinado (Gatekeeper bloqueia).
  9. Sem home/atalhos específicos por setor (Dashboard genérico filtrado por papel); sem contas semente para todos os 11 papéis.

## Review Focus

1. Importação com formatos brasileiros: CSV `;` + vírgula decimal (`1.234,56`), datas `dd/mm/aaaa`, BOM UTF-8 e Latin-1 acentuado — esperado: valores corretos, nunca `NaN`/data invertida.
2. Reimportar o mesmo arquivo — esperado: atualiza por chave natural (e-mail/CNPJ/SKU), não duplica; linhas ruins vão para relatório de erros, boas entram (ou nada entra se "tudo ou nada").
3. XLSX grande/estranho (50k linhas, várias abas, células mescladas, fórmulas, linhas vazias) — esperado: não trava a UI, avisa aba/linha do erro.
4. Upload de arquivo com nome malicioso (`../../x`, nome duplicado, 0 bytes, >limite) — esperado: sanitiza, versiona, rejeita com mensagem.
5. Papel alterado/removido com a sessão aberta e login legado `plain:` — esperado: acesso revalidado; hash migra para o novo formato no próximo login sem travar o usuário.

---

## Regras de execução adicionadas pelo André (valem para todas as tarefas)

1. **Uma única cópia do app no Mac.** Qualquer reinstalação usa `npm run install:app` (`scripts/install-app.sh`): compila, fecha o app, apaga `/Applications/Company Manager.app`, instala a nova e remove a cópia do build, DMGs de teste e volumes montados. Nunca deixar `.app`/`.dmg` sobrando (`mdfind` no fim confere). DMG de distribuição só sob pedido.
2. **Login rápido temporário** na tela de login: botões flutuantes nas laterais, um por área (11), entram direto sem digitar senha. Código isolado em `src/lib/dev/` + `src/components/dev/DevQuickLogin.tsx`; `DEV_QUICK_LOGIN = false` ou apagar essas pastas e a linha em `LoginPage.tsx` remove tudo. Implementado.
3. **Dados de exemplo em todos os módulos, exceto leads** (leads são pesquisa real e **não** são tocados): `src/lib/dev/devSeed.ts`, idempotente (flag `seed.dev_data.v1`), roda no primeiro login rápido do desktop. Novas tarefas que criarem tabelas (Tarefa 4 em diante) devem estender esse seed. Implementado e validado contra o schema real (SQLite com migrations 0001–0007).
4. Fix de build: `[profile.release.build-override] strip = "none"` em `src-tauri/Cargo.toml` (strip de proc-macros quebrava o link no macOS 27).

## Fases e paralelismo

Fase A (sequencial, base) → Fase B (paralela, módulos em pastas disjuntas) → Fase C (integração/QA/DMG final).
Arquivos compartilhados (`rbac.ts`, `routes.tsx`, `Sidebar.tsx`, `CommandMenu.tsx`, `demo.ts`, `lib.rs`, `types/index.ts`) são tocados **só na Fase A** (Tarefa 4) para que agentes da Fase B não conflitem.

### Task 1: DMG release build (baseline)

**Files:**
- Modify: `src-tauri/tauri.conf.json` (bundle.macOS, category, minimumSystemVersion, dmg)
- Create: `scripts/build-dmg.sh`
- Modify: `AGENTS.md` (§3 comando de DMG)

**Interfaces:**
- Produces: `npm run dmg` → `src-tauri/target/release/bundle/dmg/Company Manager_<ver>_aarch64.dmg`

- [ ] **Step 1:** Ler `scratchpad/dmg-build.log` do build já disparado; corrigir falhas (iCloud dataless, Rust, ícones).
- [ ] **Step 2:** Adicionar `bundle.category: "Business"`, `macOS.minimumSystemVersion: "12.0"`, `macOS.signingIdentity: "-"` (ad-hoc) e script `dmg` em `package.json` chamando `scripts/build-dmg.sh` (`npm ci` opcional → `npm run tauri build -- --bundles dmg` → copia DMG para `dist-installers/`).
- [ ] **Step 3:** Verificar: `hdiutil attach` do DMG, copiar `.app` para `/Applications`, `open -a "Company Manager"`; confirmar que migrations 0001–0007 aplicam num banco novo e que o login aparece. Expected: janela abre, setup inicial carrega. Documentar o aviso Gatekeeper (`xattr -dr com.apple.quarantine`) até haver assinatura Apple Developer.
- [ ] **Step 4:** Commit `feat(build): empacotamento DMG para macOS`.

### Task 2: Infra de testes

**Files:**
- Create: `vitest.config.ts`, `src/test/sqlite.ts` (helper que aplica `src-tauri/migrations/*.sql` num SQLite em memória via `better-sqlite3`), `src/test/sample.test.ts`
- Modify: `package.json` (`"test": "vitest run"`), `.github/workflows/ci.yml` (rodar `npm test`)

**Interfaces:**
- Produces: `createTestDb(): Promise<{ execute(sql:string, p?:unknown[]):Promise<void>; select<T>(sql:string, p?:unknown[]):Promise<T[]> }>` (mesma forma do cliente de `lib/db/client.ts`).

- [ ] **Step 1:** Teste que falha: `createTestDb()` aplica todas as migrations e `SELECT count(*) FROM companies` retorna 0.
- [ ] **Step 2:** Rodar `npx vitest run` → FAIL (módulo ausente). **Step 3:** Implementar helper e config. **Step 4:** PASS. **Step 5:** Commit `chore(test): vitest com SQLite real`.

### Task 3: Autenticação e RBAC corrigidos

**Files:**
- Modify: `src/lib/auth/login.ts`, `src/lib/permissions/rbac.ts`, `src-tauri/src/lib.rs` (comandos `hash_password`, `verify_password`), `src-tauri/Cargo.toml` (`argon2`), `src/modules/settings/pages/SetupPage.tsx`, `SettingsPage.tsx`
- Create: `src-tauri/migrations/0010_auth_hash.sql` (coluna `password_algo TEXT DEFAULT 'plain'`), `src/lib/auth/hash.ts`, `src/lib/auth/login.test.ts`, `src/lib/permissions/rbac.test.ts`, `src/lib/auth/seedRoleAccounts.ts`

**Interfaces:**
- Produces: `hashPassword(pw:string):Promise<string>` (`argon2id$…` no desktop; PBKDF2 `pbkdf2$…` via WebCrypto no demo), `verifyPassword(pw, stored):Promise<{ok:boolean; needsRehash:boolean}>`, `seedRoleAccounts(companyId, defaultPassword):Promise<Account[]>` (cria 1 conta por um dos 11 papéis).
- `can(role, action, resource)` sem exceções embutidas: `customers` visível para `ceo, admin, gerente, comercial, atendimento`; `audit_logs` para `ceo, admin, auditor, tecnico`.

- [ ] **Step 1:** Testes: `verifyPassword("x","plain:x")` → `{ok:true, needsRehash:true}`; senha errada → `ok:false`; `can("ceo","view","customers")===true`; `can("auditor","view","audit_logs")===true`; `can("estoquista","view","payroll")===false`; matriz completa papel×recurso espelhando `PERMISSIONS`.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar hash (argon2 via comando Tauri; fallback WebCrypto), rehash silencioso no login, remover exceções de `can()`, ajustar `visibleModules`. **Step 4:** PASS. 
- [ ] **Step 5:** `SetupPage`: opção "criar contas de demonstração por setor" chamando `seedRoleAccounts` (e-mails `<papel>@empresa.local`, senha inicial obrigatória trocar no 1º login); `SettingsPage > Usuários` ganha "forçar troca de senha".
- [ ] **Step 6:** Commit `feat(auth): argon2, rehash legado, RBAC sem exceções e contas por setor`.

### Task 4: Schema CRM/ERP + registro dos módulos (Fase A final — única a tocar arquivos compartilhados)

**Files:**
- Create: `src-tauri/migrations/0008_crm_erp_core.sql`, `src-tauri/migrations/0009_documents_files.sql`
- Modify: `src-tauri/src/lib.rs`, `src/types/index.ts`, `src/lib/db/demo.ts` (`EXTRA_TABLES`), `src/lib/permissions/rbac.ts`, `src/app/routes.tsx`, `src/app/layout/Sidebar.tsx`, `src/app/layout/CommandMenu.tsx`
- Create: páginas stub `src/modules/{sales,purchasing,catalog,reports,imports}/pages/*Page.tsx` (default export com `PageHeader`)

**Interfaces — tabelas novas (0008):** `products(id,company_id,sku,name,kind[produto|servico],unit,price,cost,tax_rate,active)`, `price_lists`, `sales_orders(+_items)`, `invoices(+_items)`, `purchase_orders(+_items)`, `goods_receipts`, `finance_categories(id,company_id,name,kind[receita|despesa],parent_id)`, `bank_accounts`, `bank_transactions`, `recurring_entries`, `crm_activities(id,company_id,entity_type,entity_id,kind[ligacao|email|reuniao|nota|tarefa],body,due_at,done_at,user_id)`, `proposal_items`, `tags`, `entity_tags`, `import_batches(id,company_id,entity,filename,rows_ok,rows_err,created_by,created_at)`.
**(0009):** `documents` ganha `storage_key, mime, size_bytes, sha256, entity_type, entity_id, parent_version_id` (via `ALTER TABLE ADD COLUMN`).
**RBAC novos recursos:** `products, sales_orders, invoices, purchase_orders, bank, reports, imports, crm_activities`.
**Rotas:** `/sales`, `/purchasing`, `/catalog`, `/reports`, `/imports`.

- [ ] **Step 1:** Teste (`src/test/schema.test.ts`): `createTestDb()` aplica 0008/0009; inserir produto + pedido de venda com 2 itens e ler de volta; `PRAGMA foreign_key_check` vazio.
- [ ] **Step 2:** FAIL → **Step 3:** escrever migrations, registrar em `lib.rs`, tipos, `EXTRA_TABLES`, RBAC (matriz por papel: comercial→sales/crm; estoquista→catalog/purchasing(receber); financeiro→invoices/bank/reports; gerente→view geral; auditor→view tudo exceto payroll), rotas e nav com stubs. **Step 4:** PASS + `npm run build`. **Step 5:** Commit `feat(schema): tabelas de CRM/ERP, documentos com arquivo e módulos registrados`.

### Task 5: Motor de importação/exportação CSV + XLSX

**Files:**
- Create: `src/lib/importexport/{parse.ts,normalize.ts,registry.ts,runImport.ts,export.ts,errors.ts}`, `src/lib/importexport/importers/{customers,contacts,leads,opportunities,products,suppliers,inventory,employees,payables,receivables,tickets,projects}.ts`, `src/modules/imports/pages/ImportsPage.tsx` (+ componentes `ImportWizard.tsx`, `ColumnMapper.tsx`, `ResultReport.tsx`), testes `*.test.ts` ao lado
- Modify: `package.json` (deps), `src-tauri/capabilities/default.json` (`fs:allow-read-file`, `fs:allow-write-file`)

**Interfaces:**
- `parseFile(file: File): Promise<{ sheets: { name: string; headers: string[]; rows: Record<string,string>[] }[] }>` — CSV (detecta `;`/`,`/tab, BOM, UTF-8/Latin-1) via `papaparse`; XLSX via `read-excel-file`.
- `interface ImportEntity<T> { key: string; label: string; resource: Resource; fields: FieldDef[]; schema: ZodType<T>; naturalKey: (r:T)=>string; upsert(db, companyId, rows:T[]): Promise<{inserted:number; updated:number}> }`; `registry: Record<string, ImportEntity<any>>`.
- `normalizeValue(kind:"money"|"date"|"int"|"bool"|"phone"|"cnpj"|"cpf"|"email", raw:string): {ok:true; value:unknown}|{ok:false; reason:string}`.
- `runImport(entity, mapping, rows, opts:{mode:"all-or-nothing"|"skip-errors"; dryRun:boolean}): Promise<{ok:number; errors:{row:number; field:string; message:string}[]; batchId:string}>`.
- `exportRows(entityKey, format:"csv"|"xlsx"): Promise<Blob>` e `templateFor(entityKey, format)` (modelo com cabeçalhos pt-BR + linha de exemplo).

- [ ] **Step 1:** Testes `normalize.test.ts`: `money("1.234,56")→1234.56`, `money("R$ 10,00")→10`, `date("31/12/2025")→"2025-12-31"`, `date("2025-12-31")` ok, `date("31/02/2025")` erro, `cnpj` inválido erro, `email` com maiúscula → minúscula.
- [ ] **Step 2:** `parse.test.ts`: CSV `;` com BOM e `ç` Latin-1 → headers corretos; XLSX fixture com 2 abas → 2 sheets; arquivo vazio → erro legível.
- [ ] **Step 3:** `runImport.test.ts` (SQLite real): importar 3 clientes → 3 inseridos; reimportar mesmo arquivo → 0 inseridos, 3 atualizados; linha com e-mail inválido em modo `skip-errors` → 2 ok + 1 erro com número da linha; em `all-or-nothing` → 0 gravados; `dryRun` não grava; registra em `import_batches`.
- [ ] **Step 4:** Rodar → FAIL. **Step 5:** Implementar (transação por lote; chunks de 500 linhas com `await` para não travar a UI; limite 100k linhas). **Step 6:** `ImportsPage`: escolher entidade (só as que o papel pode `create`), enviar arquivo (dialog Tauri / `<input>`), escolher aba, mapear colunas (auto-sugestão por nome), prévia das 20 primeiras linhas com erros marcados, executar, baixar relatório de erros CSV, baixar modelo.
- [ ] **Step 7:** Botões "Importar" / "Exportar CSV/XLSX" injetados via `PageToolbar` existente em cada lista (feito em cada tarefa de módulo da Fase B usando `<ImportExportButtons entity="…" />`).
- [ ] **Step 8:** Commit `feat(import): motor CSV/XLSX com mapeamento, prévia, relatório e modelos`.

### Task 6: Documentos reais (upload / download / versões)

**Files:**
- Create: `src/lib/files/store.ts`, `src/lib/files/store.test.ts`, `src/lib/files/demoStore.ts` (IndexedDB), `src/components/shared/FileAttachments.tsx`
- Modify: `src/modules/documents/pages/DocumentsPage.tsx`, `src-tauri/capabilities/default.json` (`fs:scope` em `$APPDATA/files/**`)

**Interfaces:**
- `saveFile(companyId, file: File, meta:{entityType?:string; entityId?:string; userId:string}): Promise<DocumentRow>` — grava em `$APPDATA/files/<companyId>/<sha256[0..2]>/<sha256>` (dedupe por hash), linha em `documents` com `storage_key, mime, size_bytes, sha256`; mesmo título → nova versão (`parent_version_id`, `version+1`).
- `openFile(doc): Promise<Blob>`, `downloadFile(doc)` (dialog "salvar como"), `deleteFile(doc)` (soft delete; bytes só somem sem outras referências).
- `sanitizeFileName(name:string): string`; limite 50 MB configurável.
- `<FileAttachments entityType entityId />` reutilizável em cliente, ticket, OS, projeto, fatura.

- [ ] **Step 1:** Testes: `sanitizeFileName("../../etc/passwd")==="passwd"`; salvar 2 vezes o mesmo conteúdo → 1 blob em disco, 2 linhas; mesmo título com conteúdo novo → `version===2`; arquivo 0 bytes e >50 MB rejeitados com mensagem; round-trip `saveFile`→`openFile` devolve bytes idênticos.
- [ ] **Step 2:** FAIL → **Step 3:** implementar store (Tauri `plugin-fs` no desktop, IndexedDB no navegador) → **Step 4:** PASS. **Step 5:** `DocumentsPage`: upload múltiplo e arrastar-soltar, pré-visualização de PDF/imagem, histórico de versões, download, anexos por entidade. **Step 6:** Commit `feat(documents): upload, download e versões com arquivo real`.

### Task 7: CRM completo

**Files:** (somente `src/modules/crm/**`, `src/lib/crm/**`)
- Create: `pages/{CustomerDetailPage,ContactsPanel,PipelineBoardPage,ProposalEditorPage,ActivitiesPage}.tsx`, `src/lib/crm/{queries.ts,convert.ts,proposalPdf.ts,dedupe.ts}` + testes
- Modify: `CrmPage.tsx`, `OpportunitiesPage.tsx`, `modules/leads/pages/LeadsPage.tsx`

**Interfaces:**
- `convertLeadToOpportunity(db, leadId, userId): Promise<{opportunityId:string}>` e `winOpportunity(db, oppId, userId): Promise<{customerId:string; salesOrderId:string|null}>`.
- `findDuplicateCustomers(db, companyId): Promise<{keep:string; merge:string[]}[]>` (CNPJ/e-mail/telefone normalizados) e `mergeCustomers(db, keepId, mergeIds)`.
- `renderProposalPdf(proposalId): Promise<Blob>` (HTML→print do webview, com itens, totais, validade).

- [ ] **Step 1:** Testes SQLite: converter lead cria oportunidade e marca lead `convertido`; ganhar oportunidade cria cliente (se não existir) e registra atividade; `findDuplicateCustomers` agrupa `a@x.com` e `A@X.com`; `mergeCustomers` move contatos/oportunidades/atividades e faz soft delete dos mesclados.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** UI: ficha do cliente (abas Resumo / Contatos / Oportunidades / Propostas / Atividades / Documentos / Financeiro), funil kanban com arrastar entre etapas e valor ponderado, editor de proposta com itens do catálogo, linha do tempo de atividades com follow-ups vencidos no Dashboard do comercial, tags e segmentos salvos, importação/exportação (`customers, contacts, leads, opportunities`).
- [ ] **Step 4:** Commit `feat(crm): ficha do cliente, funil, propostas, atividades e mesclagem`.

### Task 8: ERP — catálogo, vendas, compras, financeiro, estoque

**Files:** `src/modules/{catalog,sales,purchasing,finance,inventory}/**`, `src/lib/erp/{pricing.ts,orders.ts,receiving.ts,cashflow.ts,dre.ts,reconcile.ts,recurring.ts}` + testes

**Interfaces:**
- `createSalesOrder(db, input:{customerId; items:{productId; qty; unitPrice; discount}[]}): Promise<string>`; `invoiceSalesOrder(db, orderId): Promise<{invoiceId; receivableIds:string[]}>` (gera contas a receber por parcela).
- `createPurchaseOrder(...)`, `receivePurchaseOrder(db, poId, items:{itemId; qty; locationId}[]): Promise<void>` (cria `stock_movements` entrada e `payables`).
- `cashflow(db, companyId, from, to): Promise<{date:string; in:number; out:number; balance:number}[]>`; `dre(db, companyId, month): Promise<{receita:number; custos:number; despesas:number; resultado:number}>`; `parseOfx(text):BankTx[]`/`reconcile(db, accountId, txs)`; `runRecurring(db, companyId, today)` gera lançamentos do mês sem duplicar.

- [ ] **Step 1:** Testes SQLite: faturar pedido de R$1.000 em 3 parcelas → 3 recebíveis somando 1000,00 (última parcela absorve centavos); receber 5 un. de PO baixa/aumenta `stock_balances` e cria payable; `runRecurring` duas vezes no mesmo mês → 1 lançamento; `cashflow` e `dre` com massa fixa batem valores esperados; `parseOfx` fixture → transações com sinal correto; estoque nunca negativo em transferência.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** UI: Catálogo (produtos/serviços, listas de preço), Vendas (pedidos → faturas), Compras (pedidos, recebimento), Financeiro completo (excluir/aprovar/pagar/receber com baixa parcial, categorias, centros de custo, contas bancárias, conciliação OFX/CSV, fluxo de caixa, DRE, recorrentes), Estoque (multi-local, transferência, ponto de reposição → sugestão de compra, inventário/contagem). Cada lista com Importar/Exportar.
- [ ] **Step 4:** Commit por subárea (`feat(erp): …`).

### Task 9: Telas e home por setor (11 papéis)

**Files:** `src/modules/dashboard/**` (por papel), `src/modules/hr/**` (completar), `src/lib/dashboard/roleHomes.ts` + teste

**Interfaces:** `roleHome(role: Role): HomeWidget[]` — lista de widgets (KPIs, atalhos, pendências) por papel; ex.: comercial → funil, follow-ups; financeiro → vencidos, fluxo; estoquista → abaixo do mínimo; rh → solicitações pendentes; auditor → últimas ações; tecnico → tickets/OS abertos.

- [ ] **Step 1:** Teste: para cada um dos 11 papéis, todo widget retornado referencia recurso que `can(role,"view",recurso)` permite (nenhum vazamento) e há ≥3 widgets.
- [ ] **Step 2:** FAIL → implementar → PASS. **Step 3:** RH completo: ciclo de admissão/desligamento, documentos do colaborador (`FileAttachments`), banco de horas simples, importação de colaboradores. **Step 4:** Commit `feat(dashboard): home por setor e RH completo`.

### Task 10: Relatórios, backup/restauração e distribuição

**Files:** `src/modules/reports/**`, `src/lib/backup/{backup.ts,restore.ts}` + teste, `src/modules/settings/pages/SettingsPage.tsx` (aba Backup), `src-tauri/src/lib.rs` (comando `backup_db`/`restore_db`), `tauri.conf.json` (updater opcional)

**Interfaces:** `backupToFile(path): Promise<void>` (cópia consistente do `.db` + pasta `files/` em `.cmbackup` zip); `restoreFromFile(path): Promise<void>` (valida versão de schema, faz backup automático antes, exige reinício).

- [ ] **Step 1:** Teste: backup → apagar dado → restaurar → dado volta; restaurar arquivo corrompido/versão futura → erro sem alterar o banco atual.
- [ ] **Step 2:** FAIL → implementar → PASS. **Step 3:** Relatórios (vendas por período/cliente/vendedor, aging de recebíveis/pagáveis, giro de estoque, DRE) com exportação CSV/XLSX/PDF. **Step 4:** Backup automático diário (mantém 14) e onboarding de nova empresa (`SetupPage` limpa, sem dados de prospecção da LeadingSites). **Step 5:** Commit `feat(ops): relatórios, backup e restauração`.

### Task 11: QA ponta a ponta e DMG final

**Files:** `e2e/{roles.spec.ts,import.spec.ts,documents.spec.ts}`, `playwright.config.ts`, `docs/QA.md`

- [ ] **Step 1:** Playwright contra `npm run dev` (banco demo): para cada papel, logar e afirmar que a Sidebar mostra exatamente `visibleModules(role)` e que URL de módulo proibido redireciona.
- [ ] **Step 2:** E2E import: subir `fixtures/clientes.csv` e `fixtures/produtos.xlsx` → contadores corretos → reimportar → "0 novos, N atualizados".
- [ ] **Step 3:** E2E documentos: upload → baixar → bytes idênticos.
- [ ] **Step 4:** `npm run dmg`, instalar, abrir, rodar setup, criar contas por setor, importar fixture, anexar arquivo, fazer backup/restauração no app empacotado. Expected: tudo passa sem erro no console.
- [ ] **Step 5:** Atualizar `AGENTS.md`/`README.md`; commit `docs: estado final e QA`; tag `v0.2.0` (sem push).

---

## Execução em agentes (para gastar a janela de tokens)

- **Onda 1 (sequencial, 1 agente cada, nesta ordem):** Tarefa 2 → 3 → 4. Tarefa 1 roda em paralelo (só config de build).
- **Onda 2 (paralela, worktree isolado cada):** Tarefas 5, 6, 7, 8, 9, 10 — pastas disjuntas após a Tarefa 4. Cada tarefa = 1 implementador + 1 revisor independente; Tarefa 8 divide em 3 subagentes (vendas/compras, financeiro, estoque).
- **Onda 3:** Tarefa 11 + revisão final de todo o branch (segurança: path traversal, SQL injection nos importadores, CSP; corretude: dinheiro em centavos/arredondamento).
- Merge entre worktrees só com sua autorização; nada de push.

## Self-review

- Cobertura: DMG (T1), CRM completo (T7), ERP completo (T8), todos os papéis/login/telas (T3, T9), upload/download (T6), import CSV/XLSX de tudo (T5 + botões em T7–T9), distribuição para terceiros (T10: setup limpo, backup; assinatura Apple Developer **pendente de conta paga** — fora do escopo técnico).
- Tipos consistentes: `ImportEntity.resource` usa o `Resource` do RBAC (T4); `FileAttachments` (T6) é consumido em T7/T9; `createTestDb` (T2) em todos os testes.
- Risco aberto: multiusuário em máquinas diferentes **não** é suportado (SQLite local); logins por setor funcionam no mesmo Mac. Sincronização/servidor fica para uma fase futura se quiser vender como SaaS.
