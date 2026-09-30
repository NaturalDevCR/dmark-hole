<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import Spinner from "@/components/ui/Spinner.vue";
import { useAuth } from "@/stores/auth";
import AuthLayout from "./AuthLayout.vue";

const auth = useAuth();
const router = useRouter();
const route = useRoute();
const email = ref("");
const password = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = "";
  try {
    await auth.login(email.value, password.value);
    const next = typeof route.query.next === "string" && route.query.next.startsWith("/") ? route.query.next : "/";
    router.replace(next);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthLayout title="DMARK-Hole" :subtitle="$t('auth.login.subtitle')">
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="label" for="email">{{ $t("auth.fields.email") }}</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="username" required autofocus />
      </div>
      <div>
        <label class="label" for="password">{{ $t("auth.fields.password") }}</label>
        <input id="password" v-model="password" class="input" type="password" autocomplete="current-password" required />
      </div>
      <p v-if="error" class="rounded-lg bg-fail-soft px-3 py-2 text-sm text-fail">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy"><Spinner v-if="busy" />{{ $t("auth.login.submit") }}</button>
    </form>
  </AuthLayout>
</template>
