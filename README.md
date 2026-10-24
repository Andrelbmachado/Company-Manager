# Company-Manager
Um gerenciador completo de empresas, com dashboard para a liderança acompanhar cada detalhe da operação. O projeto inclui funcionalidades integradas para CRM, Help Desk (Tickets e OS), Controle de Estoque, Gestão de Projetos e Assistente IA integrado.

## Funcionalidades Principais

- **Dashboard**: Acompanhamento de KPIs em tempo real (Oportunidades, Tickets, OS, Projetos, Estoque, Financeiro).
- **Project Manager (Projetos)**: projetos com plano em etapas, fluxo visual (concluídas, em andamento e a seguir), tarefas, quadro kanban e orçamentos. É o módulo do app Project Manager embutido aqui.
- **Prospecção**: leads de sites, pacotes Básico/Essencial/Premium com preços por segmento, cronograma de abordagem, previsão de receita e Programa de Indicação.
- **RH**: Meu RH para todo colaborador (férias, solicitações, comunicados, pendências) e Gestão de RH para o setor de RH e a diretoria.
- **Folha de pagamento**: remuneração dos colaboradores, só para CEO e Administração.
- **Estoque**: Controle de itens, inventário, fornecedores, alertas de saldo e fluxo de custódia.
- **Suporte e Help Desk**: Abertura e resolução de tickets por clientes/áreas, com conversão em Ordens de Serviço (OS).
- **Assistente IA**: Chat corporativo restrito de acordo com o cargo e nível de acesso, suporte para anexos e configuração de modelo próprio de LLM.
- **Controle de Acessos**: tela de login única; o papel da conta (CEO, Administração, Gerência, RH, Comercial, Financeiro, TI, Estoque, Atendimento, Produtos, Auditoria) define as telas que cada pessoa vê. Contas demo e regras em [AGENTS.md](AGENTS.md).

## Mapa do Projeto

Abaixo há uma visão geral da arquitetura de diretórios principal baseada em React (Tauri-ready):

- `/src/components` - Componentes de interface (UI).
  - `/shared` - Componentes reutilizáveis compartilhados como `PageHeader`, `CrudDialog`, `DetailDrawer`, `EmptyState`, `KpiCard`, etc.
- `/src/hooks` - Hooks customizados (`useSession`, `usePermission`).
- `/src/lib` - Lógica de negócios e integrações utilitárias.
  - `/assistant` - Integração e configurações da IA.
  - `/auth` - Autenticação e credenciais.
  - `/db` - Camada mock de banco de dados (`demo.ts`) e o client.
  - `/events` - Barramento de eventos (Event Bus) local para os módulos.
  - `/permissions` - Verificações de Controle de Acesso Baseado em Papéis (RBAC).
- `/src/modules` - Agrupamento por domínio/módulos da aplicação, com suas respectivas páginas.
  - `/assistant` - Página de chat do assistente IA (`AssistantPage.tsx`).
  - `/dashboard` - Visão macro e gráficos de performance (`DashboardPage.tsx`).
  - `/inventory` - Gestão do estoque e saldos (`InventoryPage.tsx`).
  - `/projects` - Entrada do Project Manager embutido (`ProjectsPage.tsx`); o código do módulo fica em `/project-manager` (cópia, não editar).
  - `/leads` - Prospecção de sites (`LeadsPage.tsx`).
  - `/hr` - Meu RH e Gestão de RH.
  - `/payroll` - Folha de pagamento.
  - `/settings` - Telas de autenticação, configurações globais e integração de IA (`LoginPage.tsx`, `SettingsPage.tsx`).
  - `/support` - Módulo de atendimento técnico, tickets e OS (`SupportPage.tsx`).
- `/src/types` - Tipagens e interfaces globais base do sistema.

## Comandos

`npm install`, `npm run dev` (navegador, banco demo), `npm run tauri dev` (desktop, SQLite), `npm run typecheck`, `npm test`, `npm run build`, `npm run dmg` (instalador macOS em `dist-installers/`), `npm run install:app` (instala no próprio Mac), `npm run sync:project-manager`. Detalhes, convenções e cuidados: [AGENTS.md](AGENTS.md).
