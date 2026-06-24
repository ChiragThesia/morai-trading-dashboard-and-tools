import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.ts";
import { App } from "./App.tsx";
import "./index.css";

// App composition root — <App> is the auth gate (Supabase session → Login or Shell).
// QueryClientProvider wraps the entire app so all hooks can use TanStack Query.

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("No #root element found");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
