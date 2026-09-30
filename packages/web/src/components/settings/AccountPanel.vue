<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, reactive, ref } from "vue";
import Badge from "@/components/ui/Badge.vue";
import Card from "@/components/ui/Card.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import { useAuth } from "@/stores/auth";

const { user } = storeToRefs(useAuth());
const form = reactive({ current: "", next: "", confirm: "" });
const saving = ref(false);

const mismatch = computed(() => form.confirm.length > 0 && form.next !== form.confirm);
const valid = computed(() => !!form.current && form.next.length >= 8 && form.next === form.confirm);

async function submit() {
  if (!valid.value) return;
  saving.value = true;
  try {
    if (await withToast(() => api.post("/auth/password", { current: form.current, next: form.next }), "Contraseña actualizada")) {
      Object.assign(form, { current: "", next: "", confirm: "" });
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6 lg:grid-cols-3">
    <Card title="Mi cuenta">
      <dl v-if="user" class="space-y-3 text-sm">
        <div><dt class="text-xs text-muted">Nombre</dt><dd class="font-medium">{{ user.name }}</dd></div>
        <div><dt class="text-xs text-muted">Correo</dt><dd class="break-all">{{ user.email }}</dd></div>
        <div>
          <dt class="text-xs text-muted">Rol</dt>
          <dd class="mt-0.5"><Badge :tone="user.role === 'admin' ? 'brand' : 'neutral'">{{ user.role === "admin" ? "Administrador" : "Lector" }}</Badge></dd>
        </div>
      </dl>
    </Card>

    <Card title="Cambiar contraseña" subtitle="Al cambiarla se cierran sus otras sesiones abiertas." class="lg:col-span-2">
      <form class="grid max-w-xl gap-4" @submit.prevent="submit">
        <div>
          <label class="label" for="p-cur">Contraseña actual</label>
          <input id="p-cur" v-model="form.current" type="password" class="input" autocomplete="current-password" required />
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="p-new">Nueva contraseña</label>
            <input id="p-new" v-model="form.next" type="password" class="input" autocomplete="new-password" minlength="8" maxlength="200" required />
            <p class="mt-1.5 text-xs text-muted">Mínimo 8 caracteres.</p>
          </div>
          <div>
            <label class="label" for="p-conf">Confirmar contraseña</label>
            <input id="p-conf" v-model="form.confirm" type="password" class="input" :class="mismatch && 'border-fail!'" autocomplete="new-password" required />
            <p v-if="mismatch" class="mt-1.5 text-xs text-fail">Las contraseñas no coinciden.</p>
          </div>
        </div>
        <div><button type="submit" class="btn-primary" :disabled="!valid || saving"><Spinner v-if="saving" />Cambiar contraseña</button></div>
      </form>
    </Card>
  </div>
</template>
