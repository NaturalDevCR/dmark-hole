<template>
  <aside class="fixed left-0 top-0 z-40 h-screen w-64 border-r bg-card">
    <div class="flex h-14 items-center border-b px-4">
      <div class="flex items-center gap-2">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Mail class="h-4 w-4 text-primary-foreground" />
        </div>
        <span class="font-semibold tracking-tight">DMARK-Hole</span>
      </div>
    </div>
    <nav class="flex flex-col gap-1 p-3">
      <router-link
        v-for="item in navItems"
        :key="item.href"
        :to="item.href"
        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
        :class="$route.path === item.href ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'"
      >
        <component :is="item.icon" class="h-4 w-4" />
        <span>{{ item.label }}</span>
        <span v-if="item.badge" class="ml-auto rounded-full bg-destructive px-1.5 py-0.5 text-xs text-destructive-foreground">
          {{ item.badge }}
        </span>
      </router-link>

      <div class="my-2 border-t" />

      <router-link
        to="/settings"
        class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Settings class="h-4 w-4" />
        <span>Settings</span>
      </router-link>
    </nav>

    <div class="absolute bottom-0 left-0 right-0 border-t p-3">
      <div class="flex items-center gap-3 rounded-md px-3 py-2">
        <div class="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-xs font-medium">
          {{ auth.user?.name?.[0] || "U" }}
        </div>
        <div class="flex-1 truncate">
          <p class="text-sm font-medium">{{ auth.user?.name }}</p>
          <p class="text-xs text-muted-foreground">{{ auth.user?.role }}</p>
        </div>
        <button @click="auth.logout()" class="rounded-md p-1 text-muted-foreground hover:text-foreground">
          <LogOut class="h-4 w-4" />
        </button>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useAuthStore } from "@/stores/auth";
import { LayoutDashboard, Globe, Mail, Server, Bell, FileText, Link, Settings, LogOut } from "lucide-vue-next";

const auth = useAuthStore();

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/domains", label: "Domains", icon: Globe },
  { href: "/mailboxes", label: "Mailboxes", icon: Mail },
  { href: "/dns", label: "DNS Health", icon: Server },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/integrations", label: "Integrations", icon: Link },
];
</script>
