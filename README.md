# Company Manager 🏢

**Gestão da empresa inteira num só app desktop — CRM, suporte, ordens de serviço, projetos, estoque, custódia, financeiro e documentos.**

Local-first: roda no seu computador com banco SQLite próprio, sem servidor e sem mensalidade. Feito com **Tauri 2 + React 18 + TypeScript + SQLite**.

> 🚧 **Status: v0.1.0 — protótipo funcional.** O esqueleto de todos os módulos existe e lê dados reais do SQLite, mas a maioria das telas ainda é só listagem. Veja abaixo o que já funciona e o que é **planejado** — e o roteiro completo em **[PLANO.md](PLANO.md)**.

---

## ✨ O que já funciona hoje

- **Setup inicial**: assistente cria a empresa e o usuário administrador no primeiro uso.
- **Login** com conta demo pronta (veja abaixo).
- **Multiempresa no schema**: toda tabela tem `company_id`, soft delete (`deleted_at`) e timestamps.
- **Permissões por papel (RBAC)**: 8 papéis (`admin`, `gerente`, `tecnico`, `estoquista`, `financeiro`, `comercial`, `atendimento`, `auditor`); o menu lateral mostra só os módulos que o papel pode ver.
- **Menu de comandos** com `Ctrl/⌘ + K` para navegar entre módulos.
- **Registro de atividades**: criar cliente, ticket, OS ou item grava um evento na tabela `activities`.

## 🧩 Módulos

| Módulo | O que faz hoje | Planejado |
|---|---|---|
| **Dashboard** | 8 KPIs com contagens reais (clientes, tickets, OS, projetos, estoque abaixo do mínimo, custódias, contas a pagar/receber) | Gráfico semanal com dados reais (hoje é **ilustrativo/fixo**), receita, MRR, inadimplência, funil |
| **CRM — Clientes** | Listar, buscar e **cadastrar** clientes (PF/PJ) | Editar, contatos, histórico de interações |
| **CRM — Oportunidades** | Quadro por estágio (novo → ganho/perdido), somente leitura | Criar/editar, arrastar entre estágios, propostas |
| **Suporte** | Listar, filtrar e **abrir tickets**; **gerar OS** a partir de um ticket | SLA, comentários, anexos |
| **Ordens de Serviço** | Listagem | Criar/editar, checklist, custos, fechamento |
| **Projetos** | Listagem | Tarefas, horas, custos, margem |
| **Estoque** | Listar e **cadastrar itens** (SKU, categoria, mínimo, custo) | Locais, movimentações, saldos |
| **Custódia** | Listagem de itens em posse de colaboradores | Retirada/devolução, prazos |
| **Financeiro** | Listagem de contas a pagar e a receber | Lançar, baixar, aprovar, fluxo de caixa |
| **Documentos** | Listagem | Upload, versões, vínculo com entidades |
| **Auditoria** | Tela que lê `audit_logs` | Gravação dos logs (hoje **nada escreve** nessa tabela) |
| **Configurações** | Dados da empresa/usuário e logout | Usuários, papéis, preferências |
| **Leads** | Tabela `leads` existe no banco, **sem tela** | Funil, origem, conversão |
| **Contratos / Billing** | — | **Planejado** (sem tabela nem tela) |

## 🚀 Rodar localmente

**Pré-requisitos:** Node 20+, Rust stable e as [dependências do Tauri 2](https://tauri.app/start/prerequisites/) para seu sistema.

```bash
npm install
npm run tauri dev     # app desktop completo (com SQLite)
```

Outros comandos:

```bash
npm run dev           # só o frontend no navegador (http://127.0.0.1:1420)
npm run build         # checagem TypeScript + build do frontend
npm run tauri build   # gera o instalador local
```

> ℹ️ No navegador (`npm run dev`) só o **login demo** funciona; as telas de dados dependem do SQLite do Tauri e não carregam fora do app desktop.

### 🔑 Conta demo

| E-mail | Senha |
|---|---|
| `admin@companymanager.local` | `CompanyDemo2026!` |

> ⚠️ **Segurança:** nesta versão as senhas ficam salvas **em texto puro** no SQLite (prefixo `plain:`). Não use senhas reais. Hash com Argon2 está no PLANO (Fase 1).

## 🗂️ Estrutura

```
src/
  app/            rotas, layout (sidebar, menu de comandos)
  modules/<mod>/  páginas de cada módulo
  components/     componentes compartilhados (KPI, badges, estados vazios)
  lib/            db (SQLite), auth, permissões (RBAC), eventos
src-tauri/
  migrations/     schema SQL (0001_init.sql)
  src/            app Tauri (Rust)
.github/workflows ci.yml (tsc + cargo check) · release.yml (instaladores por tag)
```

## 📦 Releases

Ao publicar uma tag `v*`, o `release.yml` gera um **rascunho de release** com instaladores para macOS (Apple Silicon e Intel), Windows e Linux. Os binários **não são assinados** — o sistema pode exibir aviso de "desenvolvedor não identificado" na primeira execução.

## 🗺️ Roteiro

Fases, tarefas e critérios de pronto em **[PLANO.md](PLANO.md)**.

---

> Itens marcados como **planejado** ainda não existem no código. README revisado em 21/10/2026 contra o código da v0.1.0.
