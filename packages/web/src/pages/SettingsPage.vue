<script setup lang="ts">
import { Bell, Server, SlidersHorizontal, User, Users } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed, ref, watch, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import AccountPanel from "@/components/settings/AccountPanel.vue";
import AlertsSettingsPanel from "@/components/settings/AlertsSettingsPanel.vue";
import GeneralPanel from "@/components/settings/GeneralPanel.vue";
import SystemPanel from "@/components/settings/SystemPanel.vue";
import UsersPanel from "@/components/settings/UsersPanel.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Tabs from "@/components/ui/Tabs.vue";
import { useAuth } from "@/stores/auth";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { isAdmin } = storeToRefs(useAuth());

const tabs = computed<{ id: string; label: string; icon: Component }[]>(() => [
  ...(isAdmin.value
    ? [
        { id: "general", label: t("settings.tabs.general"), icon: SlidersHorizontal },
        { id: "alerts", label: t("settings.tabs.alerts"), icon: Bell },
        { id: "users", label: t("settings.tabs.users"), icon: Users },
      ]
    : []),
  { id: "account", label: t("settings.tabs.account"), icon: User },
  { id: "system", label: t("settings.tabs.system"), icon: Server },
]);

const requested = String(route.query.tab ?? "");
const tab = ref(tabs.value.some((x) => x.id === requested) ? requested : tabs.value[0]!.id);
watch(tab, (v) => router.replace({ query: { ...route.query, tab: v === tabs.value[0]!.id ? undefined : v } }));
</script>

<template>
  <PageHeader :title="t('settings.title')" :subtitle="t('settings.subtitle')" />
  <Tabs v-model="tab" :tabs="tabs" />
  <div class="pt-6">
    <GeneralPanel v-if="tab === 'general'" />
    <AlertsSettingsPanel v-else-if="tab === 'alerts'" />
    <UsersPanel v-else-if="tab === 'users'" />
    <AccountPanel v-else-if="tab === 'account'" />
    <SystemPanel v-else />
  </div>
</template>
