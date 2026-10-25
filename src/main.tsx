import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./app/App";
import "@fontsource-variable/public-sans";
import "@fontsource-variable/bricolage-grotesque";
import "./styles/globals.css";
import { applyTheme, getTheme } from "./lib/theme";
import { installFileDropGuard } from "./components/shared/useFileDrop";

applyTheme(getTheme());
// Arquivo solto fora de uma área de envio faria a webview do desktop abrir o arquivo no lugar do app (dragDropEnabled: false).
installFileDropGuard();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60 * 5,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
