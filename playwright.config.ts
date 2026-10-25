import { defineConfig, devices } from "@playwright/test";

// E2E contra o app no navegador (banco demo em localStorage; cada teste começa com um banco novo).
// Porta padrão do `npm run dev` (1420). Se ela já estiver ocupada por outro servidor (de outra cópia ou desatualizado:
// o Vite não observa src-tauri/, então uma migration nova só entra no demo depois de reiniciar), rode com outra porta:
// `E2E_PORT=1431 npx playwright test`.
const port = Number(process.env.E2E_PORT ?? 1420);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
