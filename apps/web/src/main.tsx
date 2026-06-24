import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient.ts";
import "./index.css";

// Placeholder root — real App (auth gate + Shell) lands in Plan 04.
function Placeholder() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        color: "#d6dbe4",
      }}
    >
      <span>
        Mor<strong style={{ color: "#a78bfa" }}>AI</strong>
      </span>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl === null) {
  throw new Error("No #root element found");
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Placeholder />
    </QueryClientProvider>
  </StrictMode>,
);
