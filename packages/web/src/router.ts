import { createRouter, createWebHistory } from "vue-router";
import { useAuth } from "@/stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  routes: [
    { path: "/login", component: () => import("@/pages/LoginPage.vue"), meta: { public: true } },
    { path: "/setup", component: () => import("@/pages/SetupPage.vue"), meta: { public: true } },
    { path: "/", component: () => import("@/pages/DashboardPage.vue") },
    { path: "/domains", component: () => import("@/pages/DomainsPage.vue") },
    { path: "/domains/:id", component: () => import("@/pages/DomainDetailPage.vue"), props: true },
    { path: "/sources", component: () => import("@/pages/SourcesPage.vue") },
    { path: "/sources/:ip", component: () => import("@/pages/SourceDetailPage.vue"), props: true },
    { path: "/reports", component: () => import("@/pages/ReportsPage.vue") },
    { path: "/reports/:id", component: () => import("@/pages/ReportDetailPage.vue"), props: true },
    { path: "/forensic", component: () => import("@/pages/ForensicPage.vue") },
    { path: "/alerts", component: () => import("@/pages/AlertsPage.vue") },
    { path: "/ingest", component: () => import("@/pages/IngestPage.vue") },
    { path: "/settings", component: () => import("@/pages/SettingsPage.vue") },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.loaded) await auth.refresh().catch(() => undefined);
  if (auth.setupRequired) return to.path === "/setup" ? true : "/setup";
  if (to.path === "/setup") return "/";
  if (!to.meta.public && !auth.user) return { path: "/login", query: to.fullPath !== "/" ? { next: to.fullPath } : {} };
  if (to.path === "/login" && auth.user) return "/";
  return true;
});
