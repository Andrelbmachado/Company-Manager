# AGENTS.md — guia para agentes de IA (e para humanos)

Company Manager é um app desktop **local-first** (Tauri 2 + React 18 + TypeScript + SQLite)
para gestão de empresas: CRM, leads/oportunidades, suporte, OS, projetos, estoque,
custódia, financeiro, documentos e auditoria. A interface é toda em pt-BR.

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm ci` | Instala dependências |
| `npm run dev` | Vite em `http://127.0.0.1:1420` (preview no navegador, sem Tauri) |
| `npm run tauri dev` | App desktop completo (precisa de Rust + deps do sistema) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Testes unitários (Vitest) |
| `npm run build` | Typecheck + build de produção |

Antes de abrir PR: `npm run typecheck && npm test && npm run build`. A CI também roda `cargo check`.

## Dois modos de execução

- **Desktop (Tauri)**: dados em SQLite (`sqlite:company-manager.db`), migrações em
  `src-tauri/migrations/` registradas em `src-tauri/src/lib.rs`.
- **Navegador (preview/agentes/testes)**: sem SQLite. Os dados ficam em `localStorage`
  (`cm_store_v1`) e começam com um conjunto de demonstração (`src/lib/data/demoSeed.ts`).
  Login demo: `admin@companymanager.local` / `CompanyDemo2026!` (botão "Entrar com a conta demo").

`isTauri()` (`src/lib/runtime.ts`) decide o modo. Nunca chame `getDb()` direto em uma página:
use o repositório, que funciona nos dois modos.

## Arquitetura de dados (leia antes de mexer)

```
src/lib/data/
  entities.ts      # REGISTRO de entidades: campos, tipos, enums, refs, aliases de CSV
  repository.ts    # listEntity / insertEntities / updateEntity (SQLite ou localStorage)
  values.ts        # parse de números "R$ 1.234,56", datas "31/12/2026", enums por rótulo
  importExport.ts  # CSV/JSON: leitura, mapeamento de colunas, plano de importação, exportação, backup
  browserStore.ts  # store localStorage do modo navegador
src/lib/csv.ts     # parser/serializer CSV (detecta , ; TAB, BOM, aspas)
src/hooks/useEntity.ts  # hooks React Query: useEntityList, useCreateEntity, useUpdateEntity
```

O **registro de entidades** (`entities.ts`) é a fonte única de verdade. A partir dele saem:
formulário de criação (`EntityFormDialog`), importação (`ImportDialog`), exportação
(`ImportExportActions`), modelo CSV, backup completo e a API de automação.

Campos `ref` (ex.: `customer_id`) são resolvidos na importação pelo texto (nome, documento,
e-mail, SKU...) e exportados como nome legível. Ao listar, cada ref ganha a coluna virtual
`<campo>__label` (use `refLabel(row, "customer_id")`).

### Adicionar um módulo/entidade

1. Tabela em uma nova migração `src-tauri/migrations/000N_*.sql` + registro em `lib.rs`.
2. Entrada em `ENTITY_LIST` (`entities.ts`) com campos, `aliases` de cabeçalho CSV e `dedupeBy`.
3. Recurso RBAC em `src/lib/permissions/rbac.ts`.
4. Página em `src/modules/<modulo>/pages/` usando `PageHeader` + `ImportExportActions` +
   `NewButton` + `Toolbar`/`SearchInput` + `DataTable` + `EntityFormDialog`.
5. Rota em `src/app/routes.tsx` e item em `src/app/layout/navigation.ts`.
6. Dados de demo em `demoSeed.ts` e testes em `src/lib/__tests__/`.

## API de automação (`window.companyManager`)

Disponível no console do navegador/webview após o login. Respeita o RBAC do usuário logado.

```js
companyManager.runtime()                         // "browser" | "tauri"
companyManager.entities()                        // esquema de todas as entidades
await companyManager.list("leads")
await companyManager.create("leads", { name: "Ana", email: "ana@x.com", score: "80" })
await companyManager.update("opportunities", id, { stage: "proposta" })
await companyManager.import("leads", csvText)    // mapeamento automático de colunas
await companyManager.import("leads", jsonText, { format: "json", skipDuplicates: false })
await companyManager.export("customers", "csv")  // ou "json"
companyManager.template("leads")                 // CSV modelo
companyManager.navigate("/opportunities?tab=leads")
companyManager.resetDemoData()                   // só no navegador
```

Chaves de entidade: `customers`, `leads`, `opportunities`, `tickets`, `work_orders`, `projects`,
`inventory_items`, `custodies`, `payables`, `receivables`, `documents`, `audit_logs` (só exportação).

## Seletores estáveis para automação de UI

Prefira `data-testid` e papéis ARIA; não dependa de classes Tailwind.

| Elemento | Seletor |
| --- | --- |
| Abrir/fechar sidebar (também `Ctrl/⌘+B`) | `[data-testid=sidebar-toggle]`, estado em `[data-testid=sidebar][data-collapsed]` |
| Itens do menu | `[data-testid=nav-<rota>]` ex.: `nav-opportunities`, `nav-dashboard` |
| Menu da conta / sair / tema | `account-menu-trigger`, `account-logout`, `theme-light|dark|system` |
| Notificações | `notifications-trigger`, `notifications-mark-read` |
| Busca rápida (`Ctrl/⌘+K`) | `command-trigger`, `command-menu` |
| Importar / exportar | `import-button`, `export-button`, `export-<entidade>-csv|json`, `template-<entidade>` |
| Diálogo de importação | `import-dialog`, `import-file-input`, `import-target-<entidade>`, `import-map-<i>`, `import-summary`, `import-confirm`, `import-result` |
| Criar registro | `new-<entidade>`, `create-dialog-<entidade>`, campos `[data-field=<chave>]`, `create-submit` |
| Listas | `list-search`, `list-count`, tabelas `<entidade>-table`, linhas `[data-row-id]` |
| Abas | `tab-pipeline`, `tab-leads`, `tab-receivables`, `tab-payables` |
| Login | `login-form`, `login-demo`, `login-submit` |

## Convenções

- Texto de UI em pt-BR; código e comentários em inglês, no estilo do arquivo ao redor.
- Tailwind com tokens do tema (`bg-card`, `text-muted-foreground`...) para funcionar em modo escuro.
- Componentes base em `src/components/ui/` (`Button`, `Dialog`, `Menu`, `Field`); compostos em `src/components/shared/`.
- Soft delete (`deleted_at`) — nunca `DELETE` no fluxo normal.
- Toda escrita passa pelo repositório, que emite eventos no barramento (`src/lib/events/bus.ts`) e grava `activities`.
- Valores numéricos/datas de usuário passam por `coerceField` (`values.ts`).

## CSV de leads

Na página **Oportunidades → Importar** (alvo "Leads"). Aceita `,`, `;` ou TAB, UTF-8 com ou sem BOM,
e cabeçalhos em português ou inglês (`Nome`, `Full Name`, `E-mail`, `Celular`, `WhatsApp`,
`Empresa`, `Company`, `Cargo`, `Job Title`, `Origem`, `Lead Source`, `Status`, `Pontuação`, `Obs`...).
O usuário confere o mapeamento antes de importar; duplicados (mesmo e-mail ou telefone) são ignorados por padrão.
