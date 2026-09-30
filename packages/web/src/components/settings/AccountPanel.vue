<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import Badge from "@/components/ui/Badge.vue";
import Card from "@/components/ui/Card.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { LOCALES, setLocale, type Locale } from "@/i18n";
import { api, withToast } from "@/lib/api";
import { useAuth } from "@/stores/auth";

const { t, locale } = useI18n();
const { user } = storeToRefs(useAuth());
const form = reactive({ current: "", next: "", confirm: "" });
const saving = ref(false);

const mismatch = computed(() => form.confirm.length > 0 && form.next !== form.confirm);
const valid = computed(() => !!form.current && form.next.length >= 8 && form.next === form.confirm);

async function submit() {
  if (!valid.value) return;
  saving.value = true;
  try {
    if (await withToast(() => api.post("/auth/password", { current: form.current, next: form.next }), t("settings.account.updated"))) {
      Object.assign(form, { current: "", next: "", confirm: "" });
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-3">
    <Card :title="t('settings.account.title')">
      <dl v-if="user" class="space-y-3 text-sm">
        <div><dt class="text-xs text-muted">{{ t("settings.account.name") }}</dt><dd class="font-medium">{{ user.name }}</dd></div>
        <div><dt class="text-xs text-muted">{{ t("settings.account.email") }}</dt><dd class="break-all">{{ user.email }}</dd></div>
        <div>
          <dt class="text-xs text-muted">{{ t("settings.account.role") }}</dt>
          <dd class="mt-0.5"><Badge :tone="user.role === 'admin' ? 'brand' : 'neutral'">{{ user.role === "admin" ? t("settings.roles.admin") : t("settings.roles.viewer") }}</Badge></dd>
        </div>
        <div>
          <label class="text-xs text-muted" for="ui-lang">{{ t("common.language") }}</label>
          <select id="ui-lang" class="input mt-0.5" :value="locale" @change="setLocale(($event.target as HTMLSelectElement).value as Locale)">
            <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ l.label }}</option>
          </select>
        </div>
      </dl>
    </Card>

    <Card :title="t('settings.account.changePasswordTitle')" :subtitle="t('settings.account.changePasswordSubtitle')" class="lg:col-span-2">
      <form class="grid max-w-xl gap-4" @submit.prevent="submit">
        <div>
          <label class="label" for="p-cur">{{ t("settings.account.currentPassword") }}</label>
          <input id="p-cur" v-model="form.current" type="password" class="input" autocomplete="current-password" required />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="p-new">{{ t("settings.account.newPassword") }}</label>
            <input id="p-new" v-model="form.next" type="password" class="input" autocomplete="new-password" minlength="8" maxlength="200" required />
            <p class="mt-1.5 text-xs text-muted">{{ t("settings.account.minChars") }}</p>
          </div>
          <div>
            <label class="label" for="p-conf">{{ t("settings.account.confirmPassword") }}</label>
            <input id="p-conf" v-model="form.confirm" type="password" class="input" :class="mismatch && 'border-fail!'" autocomplete="new-password" required />
            <p v-if="mismatch" class="mt-1.5 text-xs text-fail">{{ t("settings.account.mismatch") }}</p>
          </div>
        </div>
        <div><button type="submit" class="btn-primary" :disabled="!valid || saving"><Spinner v-if="saving" />{{ t("settings.account.submit") }}</button></div>
      </form>
    </Card>
  </div>
</template>
