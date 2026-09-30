<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import Spinner from "@/components/ui/Spinner.vue";
import { useAuth } from "@/stores/auth";
import AuthLayout from "./AuthLayout.vue";

const auth = useAuth();
const router = useRouter();
const name = ref("");
const email = ref("");
const password = ref("");
const confirm = ref("");
const error = ref("");
const busy = ref(false);

async function submit() {
  error.value = "";
  if (password.value.length < 8) return (error.value = "La contraseña debe tener al menos 8 caracteres");
  if (password.value !== confirm.value) return (error.value = "Las contraseñas no coinciden");
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
  <AuthLayout title="Bienvenido a DMARK-Hole" subtitle="Cree la cuenta de administrador para empezar">
    <form class="space-y-4" @submit.prevent="submit">
      <div>
        <label class="label" for="name">Nombre</label>
        <input id="name" v-model="name" class="input" required autofocus />
      </div>
      <div>
        <label class="label" for="email">Email</label>
        <input id="email" v-model="email" class="input" type="email" autocomplete="username" required />
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="pw">Contraseña</label>
          <input id="pw" v-model="password" class="input" type="password" autocomplete="new-password" required />
        </div>
        <div>
          <label class="label" for="pw2">Confirmar</label>
          <input id="pw2" v-model="confirm" class="input" type="password" autocomplete="new-password" required />
        </div>
      </div>
      <p v-if="error" class="rounded-lg bg-fail-soft px-3 py-2 text-sm text-fail">{{ error }}</p>
      <button class="btn-primary w-full" :disabled="busy"><Spinner v-if="busy" />Crear cuenta</button>
    </form>
  </AuthLayout>
</template>
