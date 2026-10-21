# Company-Manager
Um gerenciador completo de empresas, com dashboard para a liderança acompanhar cada detalhe da operação.

App desktop local-first (Tauri 2 + React + SQLite). Também roda no navegador para preview, com dados de demonstração.

## Módulos

- **Dashboard** com indicadores (exportáveis em CSV)
- **CRM** (clientes) e **Oportunidades** (leads + funil de vendas com etapas, conversão de lead em oportunidade)
- **Suporte** (tickets, conversão em OS), **Ordens de Serviço**, **Projetos**
- **Estoque**, **Custódia**, **Financeiro** (a pagar / a receber), **Documentos**, **Auditoria**
- **Configurações** com backup completo (exportar/importar JSON)

Todo módulo tem **Importar** (CSV ou JSON, com mapeamento de colunas, prévia, validação e
detecção de duplicados) e **Exportar** (planilha CSV compatível com Excel pt-BR, JSON e modelo de importação).

## Rodando

```bash
npm ci
npm run dev          # preview no navegador: http://127.0.0.1:1420
npm run tauri dev    # app desktop
npm test             # testes
```

No navegador, use **Entrar com a conta demo** (`admin@companymanager.local` / `CompanyDemo2026!`).

## Para agentes de IA

Veja [AGENTS.md](./AGENTS.md): arquitetura, API de automação `window.companyManager` e seletores `data-testid`.
