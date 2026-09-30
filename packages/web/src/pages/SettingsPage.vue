<script setup lang="ts">
import { Bell, Server, SlidersHorizontal, User, Users } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed, ref, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import AccountPanel from "@/components/settings/AccountPanel.vue";
import AlertsSettingsPanel from "@/components/settings/AlertsSettingsPanel.vue";
import GeneralPanel from "@/components/settings/GeneralPanel.vue";
import SystemPanel from "@/components/settings/SystemPanel.vue";
import UsersPanel from "@/components/settings/UsersPanel.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Tabs from "@/components/ui/Tabs.vue";
import { useAuth } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const { isAdmin } = storeToRefs(useAuth());

const tabs = computed<{ id: string; label: string; icon: Component }[]>(() => [
  ...(isAdmin.value
    ? [
        { id: "general", label: "General", icon: SlidersHorizontal },
        { id: "alerts", label: "Alertas y notificaciones", icon: Bell },
        { id: "users", label: "Usuarios", icon: Users },
      ]
    : []),
  { id: "account", label: "Mi cuenta", icon: User },
  { id: "system", label: "Sistema", icon: Server },
]);

const requested = String(route.query.tab ?? "");
const tab = ref(tabs.value.some((t) => t.id === requested) ? requested : tabs.value[0]!.id);
watch(tab, (t) => router.replace({ query: { ...route.query, tab: t === tabs.value[0]!.id ? undefined : t } }));
</script>

<template>
  <PageHeader title="Configuración" subtitle="Ajustes del análisis, las alertas, los usuarios y el sistema" />
  <Tabs v-model="tab" :tabs="tabs" />
  <div class="pt-6">
    <GeneralPanel v-if="tab === 'general'" />
    <AlertsSettingsPanel v-else-if="tab === 'alerts'" />
    <UsersPanel v-else-if="tab === 'users'" />
    <AccountPanel v-else-if="tab === 'account'" />
    <SystemPanel v-else />
  </div>
</template>
