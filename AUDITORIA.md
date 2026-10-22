# Auditoria — Fase 1

Levantamento, por módulo, do que já é **tela real com dados no SQLite** vs. **mock/placeholder**.
Base: `src-tauri/migrations/0001_init.sql` (schema real, 24 tabelas), acesso via
`@tauri-apps/plugin-sql` em `src/lib/db/client.ts` (`Database.load("sqlite:company-manager.db")`).

> Convenção: **Real** = lê/grava no SQLite via `getDb()`. **Mock** = dado embutido no
> componente ou fallback estático. **Fallback** = usa mock só quando roda no navegador
> (sem Tauri), detectado por `"__TAURI_INTERNALS__" in window`.

## Resumo por módulo

| Módulo | Tela | Dados | Observações |
|---|---|---|---|
| Dashboard | Real | Real + mock parcial | KPIs por `COUNT(*)` reais quando em Tauri; fallback de KPIs e gráfico `WEEK_DATA` são mock |
| CRM — Clientes | Real | Real | `SELECT`/`INSERT` em `customers`; emite atividade |
| CRM — Oportunidades | Real | Real | `SELECT` em `opportunities`; funil agrupado no cliente |
| Financeiro | Real | Real | `SELECT` em `payables`/`receivables`; totais e saldo no cliente |
| Projetos | Real | Real | `SELECT` em `projects` (soft-delete) |
| Documentos | Real | Real | `SELECT` em `documents` (soft-delete) |
| Estoque | Real | Real | `SELECT` com JOIN `stock_balances` (SUM); `INSERT` de item |
| Operações (OS) | Real | Real | `SELECT` em `work_orders` (soft-delete) |
| Custódia | Real | Real | `SELECT` com LEFT JOIN em `inventory_items`/`users` |
| Suporte | Real | Real | `SELECT`/`INSERT` em `tickets`; converte ticket em OS |
| Configurações | Real | Real + mock parcial | Login real (`users`/`memberships`/`companies`); fallback de credenciais no navegador. `SettingsPage` só exibe a sessão |

## Pontos de mock / fallback (dívida a eliminar nas próximas fases)

1. **Dashboard — gráfico semanal** (`src/modules/dashboard/pages/DashboardPage.tsx`, `WEEK_DATA`):
   série estática apenas para demonstração visual. Substituir por agregação real (ex.: atividades por dia).
2. **Dashboard — KPIs fallback** (mesmo arquivo, bloco `if (!("__TAURI_INTERNALS__" in window))`):
   valores fixos para preview no navegador. Aceitável como fallback; não é o caminho em produção.
3. **Login — credenciais de demonstração** (`src/modules/settings/pages/LoginPage.tsx`):
   acesso demo no navegador sem Tauri. Manter isolado do fluxo real.

## Lacunas de produto (planejadas, ainda não no código)

Alinhado ao `PLANO.md` — **não existem** telas dedicadas para:

- **Leads**: funil kanban, origem e conversão (tipo `Lead` já existe em `src/types`; sem página).
- **Contratos**: modelos, versões, assinatura, vencimentos e alertas (sem tabela/tela).
- **Billing dedicado**: faturas, recorrência, status de pagamento, exportação (hoje só `payables`/`receivables`).

## Regras de negócio e testes (Fase 1)

Regras que estavam embutidas nos componentes foram extraídas para módulos puros e cobertas por testes (vitest):

| Regra | Módulo puro | Teste |
|---|---|---|
| Totais de contas em aberto e saldo projetado | `src/modules/finance/finance.ts` | `finance.test.ts` |
| Funil: agrupar por estágio, total e valor ponderado | `src/modules/crm/pipeline.ts` | `pipeline.test.ts` |
| Permissões por papel (RBAC) | `src/lib/permissions/rbac.ts` | `rbac.test.ts` |
| Formatação de moeda/data e iniciais | `src/lib/utils.ts` | `utils.test.ts` |

Rodar: `npm test` (ou `npm run test:coverage`). CI executa os testes em `.github/workflows/ci.yml`.
