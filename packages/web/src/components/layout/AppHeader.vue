<template>
  <header class="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 backdrop-blur px-6">
    <div>
      <h1 class="text-sm font-medium text-muted-foreground">
        {{ pageTitle }}
      </h1>
    </div>
    <div class="flex items-center gap-3">
      <button class="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent">
        <RefreshCw class="mr-1 inline h-3 w-3" />
        Refresh Data
      </button>
      <button
        @click="toggleTheme"
        class="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Sun v-if="isDark" class="h-4 w-4" />
        <Moon v-else class="h-4 w-4" />
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import { Sun, Moon, RefreshCw } from "lucide-vue-next";

const route = useRoute();
const isDark = ref(true);

const pageTitles: Record<string, string> = {
  dashboard: "Dashboard",
  domains: "Domains",
  domainDetail: "Domain Details",
  mailboxes: "Mailbox Management",
  dns: "DNS Health",
  alerts: "Alerts & Notifications",
  reports: "Reports & Exports",
  integrations: "Integrations",
  settings: "Settings",
};

const pageTitle = computed(() => pageTitles[route.name as string] || "DMARK-Hole");

function toggleTheme() {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle("dark", isDark.value);
}
</script>
