import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "./context/SessionContext";
import { AuthProvider } from "./context/AuthContext";
import { SchoolBootstrapProvider } from "./context/SchoolBootstrapContext";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <SchoolBootstrapProvider>
          <SessionProvider>
            <App />
          </SessionProvider>
        </SchoolBootstrapProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
