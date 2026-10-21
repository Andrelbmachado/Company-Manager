# PLANO — Company Manager

## Fase 1 — Auditoria
- [ ] Listar, por módulo, o que é tela real com dados no SQLite vs. mock.
- [ ] Testes (vitest) para regras de negócio; adicioná-los ao `ci.yml` existente.

## Fase 2 — Núcleo comercial
- [ ] CRM: contatos, empresas, histórico de interações.
- [ ] Leads: funil kanban, origem, conversão.
- [ ] Contratos: modelos, versões, assinatura, vencimentos e alertas.
- [ ] Billing: faturas, recorrência, status de pagamento, exportação.

## Fase 3 — Operação
- [ ] Projetos com horas e custos; estoque com movimentações; suporte com tickets e SLA.
- [ ] Permissões por papel (dono, gestor, colaborador).

## Fase 4 — Dashboard da liderança
- [ ] KPIs: receita, MRR, inadimplência, funil, margem por projeto.
- [ ] Relatórios exportáveis (PDF/CSV).

## Fase 5 — Distribuição
- [ ] Releases Windows/macOS pelo `release.yml`; backup e sincronização opcional (Open Base no futuro).
