<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import Spinner from "@/components/ui/Spinner.vue";
import { useI18n } from "vue-i18n";
import { useAuth } from "@/stores/auth";
import AuthLayout from "./AuthLayout.vue";

const auth = useAuth();
const { t } = useI18n();
const router = useRouter();
const name = ref("");
const email = ref("");
const password = ref("");
const confirm = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  error.value = "";
  if (password.value.length < 8) return (error.value = t("auth.setup.passwordTooShort"));
  if (password.value !== confirm.value) return (error.value = t("auth.setup.passwordMismatch"));
  busy.value = true;
  try {
    await auth.setup(name.value, email.value, password.value);
    router.replace("/");
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout :title="$t('auth.setup.title')" :subtitle="$t('auth.setup.subtitle')">
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="label" for="name">{{ $t("auth.fields.name") }}</label>
        <input id="name" v-model="name" class="input" required autofocus />
      </div>
      <div>
        <label class="label" for="email">{{ $t("auth.fields.email") }}</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="pw">{{ $t("auth.fields.password") }}</label>
          <input id="pw" v-model="password" class="input" type="password" autocomplete="new-password" required />
        </div>
        <div>
          <label class="label" for="pw2">{{ $t("auth.fields.confirm") }}</label>
          <input id="pw2" v-model="confirm" class="input" type="password" autocomplete="new-password" required />
        </div>
      </div>
      <p v-if="error" class="rounded-lg bg-fail-soft px-3 py-2 text-sm text-fail">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy"><Spinner v-if="busy" />{{ $t("auth.setup.submit") }}</button>
    </form>
  </AuthLayout>
</template>
