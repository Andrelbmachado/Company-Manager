# Company Manager 🏢

**Um gerenciador completo de empresas: CRM, leads, contratos, financeiro e operação — num só app desktop.**

Feito com Tauri + React + SQLite, com um dashboard para a liderança acompanhar cada detalhe da operação.

## Módulos no código
| Módulo | Pasta |
|---|---|
| Dashboard | `src/modules/dashboard` |
| CRM | `src/modules/crm` |
| Financeiro | `src/modules/finance` |
| Projetos | `src/modules/projects` |
| Documentos | `src/modules/documents` |
| Estoque | `src/modules/inventory` |
| Operações | `src/modules/operations` |
| Custódia | `src/modules/custody` |
| Suporte | `src/modules/support` |
| Configurações | `src/modules/settings` |

> O nível de completude de cada módulo ainda varia; o objetivo é deixá-los **completos e funcionais** (ver PLANO.md). Leads, contratos e billing dedicados são **planejados**.

## Rodar
```bash
npm install
npm run tauri dev     # app desktop
npm run build         # frontend
```

Plano em **[PLANO.md](PLANO.md)**.


> Este README e o PLANO.md foram reorganizados em 21/10/2026 a partir da visão do André. Itens marcados como **planejado** ainda não existem no código.
