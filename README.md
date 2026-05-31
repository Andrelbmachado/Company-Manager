# Company-Manager
Um gerenciador completo de empresas, com dashboard para a liderança acompanhar cada detalhe da operação. O projeto inclui funcionalidades integradas para CRM, Help Desk (Tickets e OS), Controle de Estoque, Gestão de Projetos e Assistente IA integrado.

## Funcionalidades Principais

- **Dashboard**: Acompanhamento de KPIs em tempo real (Oportunidades, Tickets, OS, Projetos, Estoque, Financeiro).
- **Projetos**: Gestão de projetos, tarefas, cronogramas e controle de orçamentos.
- **Estoque**: Controle de itens, inventário, fornecedores, alertas de saldo e fluxo de custódia.
- **Suporte e Help Desk**: Abertura e resolução de tickets por clientes/áreas, com conversão em Ordens de Serviço (OS).
- **Assistente IA**: Chat corporativo restrito de acordo com o cargo e nível de acesso, suporte para anexos e configuração de modelo próprio de LLM.
- **Controle de Acessos**: Login com contas demonstrativas (Admin, Gerente, Comercial, Técnico, Atendimento, Estoquista, etc.) e limites de acesso à aplicação.

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
  - `/projects` - Painel de controle de projetos e orçamentos (`ProjectsPage.tsx`).
  - `/settings` - Telas de autenticação, configurações globais e integração de IA (`LoginPage.tsx`, `SettingsPage.tsx`).
  - `/support` - Módulo de atendimento técnico, tickets e OS (`SupportPage.tsx`).
- `/src/types` - Tipagens e interfaces globais base do sistema.
