<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";
import {
  Bell,
  FileText,
  Globe,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Network,
  Settings,
  ShieldAlert,
  Sun,
  X,
} from "lucide-vue-next";
import { onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import LanguageSwitcher from "@/components/LanguageSwitcher.vue";
import { api } from "@/lib/api";
import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";

const auth = useAuth();
const theme = useTheme();
const router = useRouter();
const route = useRoute();
const open = ref(false);
const unread = ref(0);

const nav = [
  { to: "/", key: "dashboard", icon: LayoutDashboard, exact: true },
  { to: "/domains", key: "domains", icon: Globe },
  { to: "/sources", key: "sources", icon: Network },
  { to: "/reports", key: "reports", icon: FileText },
  { to: "/forensic", key: "forensic", icon: ShieldAlert },
  { to: "/alerts", key: "alerts", icon: Bell, badge: true },
  { to: "/ingest", key: "ingest", icon: Inbox },
  { to: "/settings", key: "settings", icon: Settings },
];

const isActive = (to: string, exact?: boolean) => (exact ? route.path === to : route.path === to || route.path.startsWith(`${to}/`));

async function loadUnread() {
  try {
    unread.value = (await api.get<{ unread: number }>("/alerts", { pageSize: 1 })).unread;
  } catch {
    /* ignore */
  }
}
onMounted(loadUnread);
useIntervalFn(loadUnread, 60_000);
watch(() => route.path, () => {
  open.value = false;
  if (route.path === "/alerts") setTimeout(loadUnread, 1500);
});

async function logout() {
  await auth.logout();
  router.push("/login");
}
</script>

<template>
  <div class="min-h-screen lg:pl-64">
    <!-- Mobile top bar -->
    <header class="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur lg:hidden">
      <button class="btn-ghost -ml-2 p-2" :aria-label="$t('common.nav.menu')" @click="open = true"><Menu class="size-5" /></button>
      <span class="font-semibold">DMARK-Hole</span>
      <button class="btn-ghost -mr-2 p-2" :aria-label="$t('common.theme.toggle')" @click="theme.toggle()"><Sun v-if="theme.dark" class="size-5" /><Moon v-else class="size-5" /></button>
    </header>

    <div v-if="open" class="fixed inset-0 z-40 bg-black/40 lg:hidden" @click="open = false" />
    <aside
      class="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface transition-transform lg:translate-x-0"
      :class="open ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-16 items-center justify-between px-5">
        <RouterLink to="/" class="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" class="size-8" />
          <div class="leading-tight">
            <p class="font-semibold tracking-tight">DMARK-Hole</p>
            <p class="text-[11px] text-faint">{{ $t("common.appTagline") }}</p>
          </div>
        </RouterLink>
        <button class="btn-ghost p-1.5 lg:hidden" :aria-label="$t('common.nav.closeMenu')" @click="open = false"><X class="size-4" /></button>
      </div>

      <nav class="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition"
          :class="isActive(item.to, item.exact) ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-subtle hover:text-fg'"
        >
          <component :is="item.icon" class="size-4.5" />
          <span class="flex-1">{{ $t(`common.nav.${item.key}`) }}</span>
          <span v-if="item.badge && unread" class="rounded-full bg-fail px-1.5 py-px text-[11px] font-semibold text-white tabular-nums">{{ unread > 99 ? "99+" : unread }}</span>
        </RouterLink>
      </nav>

      <div class="border-t border-line p-3">
        <div class="flex items-center gap-3 rounded-lg px-2 py-2">
          <span class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-sm font-semibold text-brand uppercase">{{ auth.user?.name?.[0] ?? "?" }}</span>
          <div class="min-w-0 flex-1 leading-tight">
            <p class="truncate text-sm font-medium">{{ auth.user?.name }}</p>
            <p class="truncate text-xs text-faint">{{ $t(auth.user?.role === "admin" ? "common.role.admin" : "common.role.viewer") }}</p>
          </div>
          <button class="btn-ghost hidden p-1.5 lg:inline-flex" :title="$t(theme.dark ? 'common.theme.light' : 'common.theme.dark')" @click="theme.toggle()">
            <Sun v-if="theme.dark" class="size-4" /><Moon v-else class="size-4" />
          </button>
          <button class="btn-ghost p-1.5" :title="$t('common.nav.logout')" @click="logout"><LogOut class="size-4" /></button>
        </div>
        <div class="mt-1 flex items-center justify-between px-1">
          <span class="px-1 text-[11px] text-faint">v{{ auth.version }}</span>
          <LanguageSwitcher />
        </div>
      </div>
    </aside>

    <main class="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <slot />
    </main>
  </div>
</template>
