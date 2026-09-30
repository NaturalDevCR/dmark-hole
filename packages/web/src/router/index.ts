import { createRouter, createWebHistory } from "vue-router";

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/pages/LoginPage.vue"),
      meta: { guest: true },
    },
    {
      path: "/register",
      name: "register",
      component: () => import("@/pages/RegisterPage.vue"),
      meta: { guest: true },
    },
    {
      path: "/",
      name: "dashboard",
      component: () => import("@/pages/DashboardPage.vue"),
      meta: { auth: true },
    },
    {
      path: "/domains",
      name: "domains",
      component: () => import("@/pages/DomainsPage.vue"),
      meta: { auth: true },
    },
    {
      path: "/domains/:id",
      name: "domainDetail",
      component: () => import("@/pages/DomainDetailPage.vue"),
      meta: { auth: true },
    },
    {
      path: "/mailboxes",
      name: "mailboxes",
      component: () => import("@/pages/MailboxesPage.vue"),
      meta: { auth: true },
    },
    {
      path: "/dns",
      name: "dns",
      component: () => import("@/pages/DnsPage.vue"),
      meta: { auth: true },
    },
    {
      path: "/alerts",
      name: "alerts",
      component: () => import("@/pages/AlertsPage.vue"),
      meta: { auth: true },
    },
    {
      path: "/reports",
      name: "reports",
      component: () => import("@/pages/ReportsPage.vue"),
      meta: { auth: true },
    },
    {
      path: "/integrations",
      name: "integrations",
      component: () => import("@/pages/IntegrationsPage.vue"),
      meta: { auth: true },
    },
    {
      path: "/settings",
      name: "settings",
      component: () => import("@/pages/SettingsPage.vue"),
      meta: { auth: true },
    },
  ],
});

router.beforeEach((to, _from, next) => {
  const token = localStorage.getItem("token");

  if (to.meta.auth && !token) {
    next("/login");
  } else if (to.meta.guest && token) {
    next("/");
  } else {
    next();
  }
});

export default router;
