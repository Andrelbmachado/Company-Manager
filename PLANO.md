# PLANO — Company Manager

Roteiro para levar a v0.1.0 (protótipo) a um app **completo e funcional**. Cada fase tem tarefas com arquivos-alvo e um **critério de pronto** verificável. Ordem pensada para fechar primeiro segurança e base técnica, depois valor de negócio.

**Regras para todas as fases**
- Toda mudança de schema entra como nova migration (`src-tauri/migrations/000N_*.sql`) registrada em `src-tauri/src/lib.rs` — nunca editar a `0001_init.sql`.
- Toda escrita de dados chama `emit()` (`src/lib/events/bus.ts`) e grava em `audit_logs`.
- Toda ação de tela checa `usePermission()` antes de exibir botão/formulário.
- CI verde (`ci.yml`) é obrigatório para merge.

---

## Fase 0 — Diagnóstico (estado em 21/10/2026)

| Área | Situação |
|---|---|
| Leitura do SQLite | ✅ Todas as telas listam dados reais |
| Criação | ✅ Clientes, tickets, OS a partir de ticket, itens de estoque, setup inicial · ❌ demais módulos |
| Edição / exclusão | ❌ Nenhum módulo |
| Dashboard | ✅ 8 KPIs reais · ⚠️ gráfico semanal usa array fixo (`WEEK_DATA`) |
| Auditoria | ⚠️ Tela lê `audit_logs`, mas nada grava nela (eventos vão só para `activities`) |
| Senhas | ⚠️ Texto puro com prefixo `plain:` (`src/lib/auth/login.ts`) |
| Permissões | ✅ RBAC com 8 papéis filtra o menu · ⚠️ `usePermission` não é usado em nenhuma tela |
| Leads | ⚠️ Tabela existe, sem tela |
| Contratos / Billing | ❌ Sem tabela nem tela (`projects.contract_id` aponta para nada) |
| Testes | ❌ Nenhum; CI roda só `tsc` + `cargo check` |

---

## Fase 1 — Fundação e segurança

- [ ] **Hash de senha**: comando Tauri `hash_password` / `verify_password` com crate `argon2` em `src-tauri/src/lib.rs`; usar em `login.ts` e `SetupPage.tsx`. Migration que força troca da senha demo no primeiro login.
- [ ] **Auditoria real**: `emit()` grava também em `audit_logs` (before/after JSON).
- [ ] **Camada de dados**: extrair SQL das páginas para `src/modules/<mod>/api.ts` (funções `list/create/update/remove`), com validação `zod`.
- [x] **Testes**: adicionar `vitest` + script `npm test`; testes para `rbac.ts` (todos os papéis × recursos) e validações zod; incluir `npm test` no `ci.yml`.
  - Regras de negócio extraídas para módulos puros: `src/modules/finance/finance.ts`, `src/modules/crm/pipeline.ts`.
  - Testes: `finance.test.ts`, `pipeline.test.ts`, `rbac.test.ts`, `utils.test.ts`. Rodar com `npm test`.
  - CI roda os testes em `.github/workflows/ci.yml` (passo "Unit tests").
  - Auditoria do estado real × mock por módulo em [AUDITORIA.md](AUDITORIA.md).
- [ ] **Permissões nas telas**: esconder botões de criar/editar com `usePermission()`.

**Pronto quando:** nenhuma senha `plain:` no banco após login; criar cliente gera linha em `audit_logs` visível na tela Auditoria; `npm test` roda no CI com ≥1 teste por papel.

## Fase 2 — CRUD completo dos módulos existentes

Para cada módulo: formulário de criar/editar (drawer), exclusão via soft delete, filtros, busca e estado vazio.

- [ ] CRM: editar cliente, contatos (`contacts`), linha do tempo a partir de `activities`.
- [ ] Oportunidades: criar/editar, mover estágio (drag and drop), motivo de perda.
- [ ] OS: criar, atribuir técnico, checklist (`checklist_json`), custos, fechar.
- [ ] Projetos + tarefas (`tasks`): status, responsável, prazo, horas estimadas.
- [ ] Estoque: locais (`stock_locations`), movimentações (`stock_movements`) atualizando `stock_balances` em transação.
- [ ] Custódia: retirada/devolução com prazo e alerta de atraso.
- [ ] Financeiro: lançar, aprovar e baixar contas a pagar/receber.
- [ ] Documentos: upload via `plugin-dialog` + `plugin-fs` para a pasta do app, versão e vínculo com entidade.

**Pronto quando:** todo módulo do menu permite criar, editar e excluir pelo app, com evento registrado.

## Fase 3 — Núcleo comercial novo

- [ ] **Leads**: tela kanban sobre a tabela `leads` (origem, score, responsável) + ação "converter em cliente/oportunidade".
- [ ] **Contratos** (migration nova `contracts`): cliente, valor, início/fim, renovação, status, documento anexo; alerta de vencimento em 30/15/7 dias via `notifications`.
- [ ] **Billing**: recorrência de contrato gera `receivables` mensais; status pago/atrasado; exportação CSV.
- [ ] **Propostas**: CRUD sobre `proposals` ligado a oportunidades, com versões.

**Pronto quando:** fluxo lead → oportunidade → proposta → contrato → recebíveis funciona ponta a ponta com dados de exemplo.

## Fase 4 — Dashboard da liderança

- [ ] Trocar `WEEK_DATA` por consulta real (OS e tickets dos últimos 7 dias).
- [ ] KPIs: receita do mês, MRR, inadimplência, conversão do funil, margem por projeto.
- [ ] Filtro por período e por departamento.
- [ ] Exportar relatórios em CSV e PDF.

**Pronto quando:** nenhum dado fixo no dashboard; números batem com consultas SQL manuais em base de teste.

## Fase 5 — Distribuição

- [ ] Versão única: sincronizar `package.json`, `tauri.conf.json` e `Cargo.toml`.
- [ ] Trocar `identifier` genérico (`com.company.manager`) por um definitivo.
- [ ] Assinatura de código macOS/Windows nos secrets do `release.yml`.
- [ ] Atualização automática (`tauri-plugin-updater`).
- [ ] Backup/restauração do arquivo SQLite pela tela de Configurações.
- [ ] Sincronização opcional entre máquinas (Open Base — futuro, a definir).

**Pronto quando:** tag `v0.2.0` gera instaladores assinados e o app instalado consegue fazer backup e restaurar.
