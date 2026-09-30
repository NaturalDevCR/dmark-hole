<script setup lang="ts">
import { Send } from "lucide-vue-next";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import Toggle from "@/components/ui/Toggle.vue";
import { LOCALES } from "@/i18n";
import { api, withToast } from "@/lib/api";
import type { Settings } from "@/lib/types";
import SaveBar from "./SaveBar.vue";
import { useSettingsDraft } from "./useSettingsDraft";

const { t } = useI18n();

type Slice = Pick<Settings, "language" | "alerts" | "notifications">;

const { draft, loading, error, saving, dirty, save, reset } = useSettingsDraft<Slice>(
  (s) => ({ language: s.language, alerts: s.alerts, notifications: s.notifications }),
  (d) => ({
    language: d.language,
    alerts: { ...d.alerts, newSourceMinMessages: Math.max(1, Math.trunc(Number(d.alerts.newSourceMinMessages) || 1)), complianceThreshold: Math.min(100, Math.max(0, Number(d.alerts.complianceThreshold) || 0)) },
    notifications: { ...d.notifications, email: { ...d.notifications.email, port: Math.trunc(Number(d.notifications.email.port) || 587) } },
  }),
);

const testing = ref(false);
async function sendTest() {
  testing.value = true;
  try {
    await withToast(() => api.post("/settings/test-notification"), t("settings.alerts.testSent"));
  } finally {
    testing.value = false;
  }
}

const FORMATS = ["auto", "slack", "discord", "teams", "generic"] as const;
</script>

<template>
  <Skeleton v-if="loading" class="h-96" />
  <p v-else-if="error" class="text-sm text-fail">{{ error }}</p>
  <form v-else-if="draft" class="space-y-6" @submit.prevent="save">
    <section class="card">
      <header class="card-header"><h3 class="card-title">{{ t("settings.alerts.rulesTitle") }}</h3></header>
      <div class="card-body space-y-5">
        <Toggle v-model="draft.alerts.enabled" :label="t('settings.alerts.enabled')" :description="t('settings.alerts.enabledHint')" />
        <div class="grid gap-5 sm:grid-cols-3">
          <div>
            <label class="label" for="a-min">{{ t("settings.alerts.minMessages") }}</label>
            <input id="a-min" v-model.number="draft.alerts.newSourceMinMessages" type="number" min="1" class="input" :disabled="!draft.alerts.enabled" />
            <p class="mt-1.5 text-xs text-muted">{{ t("settings.alerts.minMessagesHint") }}</p>
          </div>
          <div>
            <label class="label" for="a-thr">{{ t("settings.alerts.threshold") }}</label>
            <input id="a-thr" v-model.number="draft.alerts.complianceThreshold" type="number" min="0" max="100" step="1" class="input" :disabled="!draft.alerts.enabled" />
            <p class="mt-1.5 text-xs text-muted">{{ t("settings.alerts.thresholdHint") }}</p>
          </div>
          <div>
            <label class="label" for="a-sev">{{ t("settings.alerts.minSeverity") }}</label>
            <select id="a-sev" v-model="draft.alerts.minSeverity" class="input" :disabled="!draft.alerts.enabled">
              <option value="info">{{ t("settings.alerts.sevInfo") }}</option>
              <option value="warning">{{ t("settings.alerts.sevWarning") }}</option>
              <option value="critical">{{ t("settings.alerts.sevCritical") }}</option>
            </select>
            <p class="mt-1.5 text-xs text-muted">{{ t("settings.alerts.minSeverityHint") }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <header class="card-header"><h3 class="card-title">{{ t("settings.alerts.webhookTitle") }}</h3></header>
      <div class="card-body grid gap-5 sm:grid-cols-3">
        <div class="sm:col-span-2">
          <label class="label" for="w-url">{{ t("settings.alerts.webhookUrl") }}</label>
          <input id="w-url" v-model="draft.notifications.webhookUrl" type="url" class="input" placeholder="https://hooks.slack.com/services/…" autocomplete="off" spellcheck="false" />
          <p class="mt-1.5 text-xs text-muted">{{ t("settings.alerts.webhookUrlHint") }}</p>
        </div>
        <div>
          <label class="label" for="w-fmt">{{ t("settings.alerts.webhookFormat") }}</label>
          <select id="w-fmt" v-model="draft.notifications.webhookFormat" class="input">
            <option v-for="f in FORMATS" :key="f" :value="f">{{ t(`settings.alerts.formats.${f}`) }}</option>
          </select>
          <p class="mt-1.5 text-xs text-muted">{{ t(`settings.alerts.formatHints.${draft.notifications.webhookFormat}`) }}</p>
        </div>
      </div>
    </section>

    <section class="card">
      <header class="card-header"><h3 class="card-title">{{ t("settings.alerts.emailTitle") }}</h3></header>
      <div class="card-body space-y-5">
        <Toggle v-model="draft.notifications.email.enabled" :label="t('settings.alerts.emailEnabled')" :description="t('settings.alerts.emailEnabledHint')" />
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="lg:col-span-2">
            <label class="label" for="e-host">{{ t("settings.alerts.smtpHost") }}</label>
            <input id="e-host" v-model="draft.notifications.email.host" class="input" :placeholder="t('settings.alerts.smtpHostPlaceholder')" :disabled="!draft.notifications.email.enabled" spellcheck="false" />
          </div>
          <div>
            <label class="label" for="e-port">{{ t("settings.alerts.port") }}</label>
            <input id="e-port" v-model.number="draft.notifications.email.port" type="number" min="1" max="65535" class="input" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="flex items-end pb-2">
            <Toggle v-model="draft.notifications.email.secure" :label="t('settings.alerts.secure')" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="lg:col-span-2">
            <label class="label" for="e-user">{{ t("settings.alerts.username") }}</label>
            <input id="e-user" v-model="draft.notifications.email.username" class="input" autocomplete="off" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="lg:col-span-2">
            <label class="label" for="e-pass">{{ t("settings.alerts.password") }}</label>
            <input id="e-pass" v-model="draft.notifications.email.password" type="password" class="input" autocomplete="new-password" :placeholder="t('settings.alerts.passwordUnchanged')" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="lg:col-span-2">
            <label class="label" for="e-from">{{ t("settings.alerts.from") }}</label>
            <input id="e-from" v-model="draft.notifications.email.from" type="email" class="input" :placeholder="t('settings.alerts.fromPlaceholder')" :disabled="!draft.notifications.email.enabled" />
          </div>
          <div class="lg:col-span-2">
            <label class="label" for="e-to">{{ t("settings.alerts.to") }}</label>
            <input id="e-to" v-model="draft.notifications.email.to" class="input" :placeholder="t('settings.alerts.toPlaceholder')" :disabled="!draft.notifications.email.enabled" />
          </div>
        </div>
        <p class="text-xs text-muted">{{ t("settings.alerts.tlsNote") }}</p>
      </div>
    </section>

    <section class="card">
      <div class="card-body max-w-md">
        <label class="label" for="n-lang">{{ t("settings.alerts.languageLabel") }}</label>
        <select id="n-lang" v-model="draft.language" class="input">
          <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
        </select>
        <p class="mt-1.5 text-xs text-muted">{{ t("settings.alerts.languageHint") }}</p>
      </div>
    </section>

    <section class="card">
      <div class="card-body">
        <Toggle v-model="draft.notifications.weeklyDigest" :label="t('settings.alerts.digest')" :description="t('settings.alerts.digestHint')" />
      </div>
    </section>

    <div class="card">
      <SaveBar :dirty="dirty" :saving="saving" class="border-t-0" @reset="reset">
        <span v-if="dirty" class="text-xs text-muted">{{ t("settings.alerts.saveFirst") }}</span>
        <button type="button" class="btn-secondary" :disabled="testing || dirty || saving" @click="sendTest"><Spinner v-if="testing" /><Send v-else class="size-4" />{{ t("settings.alerts.sendTest") }}</button>
      </SaveBar>
    </div>
  </form>
</template>
