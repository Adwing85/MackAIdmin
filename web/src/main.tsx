import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles.css";
import { api } from "./lib/api";
import { AppProvider, applyTheme, getStoredTheme, useUnauthorized } from "./lib/app";
import type { Me, Meta } from "./lib/types";
import { Layout } from "./components/Layout";
import { Loading } from "./components/ui";
import { LoginPage } from "./pages/Login";
import { DashboardPage } from "./pages/Dashboard";
import { InventoryPage } from "./pages/Inventory";
import { AssetDetailPage } from "./pages/AssetDetail";
import { AssetFormPage } from "./pages/AssetForm";
import { ApprovalsPage } from "./pages/Approvals";
import { SecurityPage } from "./pages/Security";
import { CostsPage } from "./pages/Costs";
import { LicensesPage } from "./pages/Licenses";
import { RedundancyPage } from "./pages/Redundancy";
import { DiscoveryPage } from "./pages/Discovery";
import { PoliciesPage } from "./pages/Policies";
import { OrganizationPage } from "./pages/Organization";
import { AuditPage } from "./pages/Audit";
import { AccountPage } from "./pages/Account";

applyTheme(getStoredTheme());

function Root() {
  const [session, setSession] = useState<{ me: Me; meta: Meta } | null | undefined>(undefined);

  const load = useCallback(() => {
    Promise.all([api.get<Me>("/auth/me"), api.get<Meta>("/meta")])
      .then(([me, meta]) => setSession({ me, meta }))
      .catch(() => setSession(null));
  }, []);
  useEffect(load, [load]);
  const onLogout = useCallback(() => setSession(null), []);
  useUnauthorized(onLogout);

  if (session === undefined) return <Loading />;
  if (session === null) return <LoginPage onLoggedIn={load} />;

  return (
    <AppProvider me={session.me} meta={session.meta} onLogout={onLogout}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="inventar" element={<InventoryPage />} />
          <Route path="inventar/neu" element={<AssetFormPage />} />
          <Route path="inventar/:id" element={<AssetDetailPage />} />
          <Route path="inventar/:id/bearbeiten" element={<AssetFormPage />} />
          <Route path="freigaben" element={<ApprovalsPage />} />
          <Route path="sicherheit" element={<SecurityPage />} />
          <Route path="kosten" element={<CostsPage />} />
          <Route path="lizenzen" element={<LicensesPage />} />
          <Route path="redundanzen" element={<RedundancyPage />} />
          <Route path="discovery" element={<DiscoveryPage />} />
          <Route path="richtlinien" element={<PoliciesPage />} />
          <Route path="organisation" element={<OrganizationPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="konto" element={<AccountPage />} />
          <Route path="*" element={<div className="empty">Seite nicht gefunden.</div>} />
        </Route>
      </Routes>
    </AppProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Root />
    </BrowserRouter>
  </StrictMode>,
);
