<script setup lang="ts">
import { storeToRefs } from "pinia";
import { KeyRound, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-vue-next";
import { reactive, ref } from "vue";
import Badge from "@/components/ui/Badge.vue";
import Card from "@/components/ui/Card.vue";
import Confirm from "@/components/ui/Confirm.vue";
import Modal from "@/components/ui/Modal.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import { ago, date } from "@/lib/format";
import { useLoader } from "@/lib/useLoader";
import { useAuth } from "@/stores/auth";

interface AppUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "viewer";
  createdAt: number;
  lastLoginAt: number | null;
}

const { user } = storeToRefs(useAuth());
const { data: users, loading, error, reload } = useLoader(() => api.get<AppUser[]>("/users"));

// --- create
const creating = ref(false);
const saving = ref(false);
const form = reactive({ name: "", email: "", password: "", role: "viewer" as AppUser["role"] });
function openCreate() {
  Object.assign(form, { name: "", email: "", password: "", role: "viewer" });
  creating.value = true;
}
async function create() {
  saving.value = true;
  try {
    if (await withToast(() => api.post("/users", { ...form }), "Usuario creado")) {
      creating.value = false;
      reload();
    }
  } finally {
    saving.value = false;
  }
}

// --- role
const busy = ref<number | null>(null);
async function toggleRole(u: AppUser) {
  busy.value = u.id;
  try {
    const role = u.role === "admin" ? "viewer" : "admin";
    if (await withToast(() => api.patch(`/users/${u.id}`, { role }), `${u.name} ahora es ${role === "admin" ? "administrador" : "lector"}`)) reload();
  } finally {
    busy.value = null;
  }
}

// --- reset password
const resetting = ref<AppUser | null>(null);
const newPassword = ref("");
async function resetPassword() {
  const u = resetting.value;
  if (!u) return;
  saving.value = true;
  try {
    if (await withToast(() => api.patch(`/users/${u.id}`, { password: newPassword.value }), "Contraseña actualizada; se cerraron sus sesiones")) {
      resetting.value = null;
      newPassword.value = "";
    }
  } finally {
    saving.value = false;
  }
}

// --- delete
const removing = ref<AppUser | null>(null);
async function remove() {
  const u = removing.value;
  removing.value = null;
  if (u && (await withToast(() => api.del(`/users/${u.id}`), "Usuario eliminado"))) reload();
}
</script>

<template>
  <Card title="Usuarios" subtitle="Los administradores pueden cambiar la configuración; los lectores solo consultan datos." flush>
    <template #actions><button class="btn-primary btn-sm" @click="openCreate"><Plus class="size-4" />Agregar usuario</button></template>
    <div v-if="loading && !users" class="space-y-2 p-5"><Skeleton v-for="i in 3" :key="i" class="h-10" /></div>
    <p v-else-if="error" class="p-5 text-sm text-fail">{{ error }}</p>
    <div v-else-if="users" class="overflow-x-auto">
      <table class="table">
        <thead>
          <tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Último acceso</th><th class="text-right">Acciones</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td class="font-medium">
              {{ u.name }}<span v-if="u.id === user?.id" class="ml-2 text-xs font-normal text-muted">(usted)</span>
            </td>
            <td class="text-muted">{{ u.email }}</td>
            <td><Badge :tone="u.role === 'admin' ? 'brand' : 'neutral'">{{ u.role === "admin" ? "Administrador" : "Lector" }}</Badge></td>
            <td class="whitespace-nowrap text-muted" :title="date(u.lastLoginAt, true)">{{ ago(u.lastLoginAt) }}</td>
            <td>
              <div class="flex justify-end gap-1">
                <button class="btn-ghost btn-sm" :disabled="u.id === user?.id || busy === u.id" :title="u.id === user?.id ? 'No puede cambiar su propio rol' : ''" @click="toggleRole(u)">
                  <Spinner v-if="busy === u.id" class="size-3.5" /><ShieldCheck v-else class="size-3.5" />{{ u.role === "admin" ? "Hacer lector" : "Hacer admin" }}
                </button>
                <button class="btn-ghost btn-sm" @click="resetting = u"><KeyRound class="size-3.5" />Contraseña</button>
                <button class="btn-ghost btn-sm text-fail hover:text-fail" :disabled="u.id === user?.id" :title="u.id === user?.id ? 'No puede eliminar su propio usuario' : 'Eliminar'" @click="removing = u">
                  <Trash2 class="size-3.5" /><span class="sr-only">Eliminar</span>
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </Card>

  <Modal v-if="creating" title="Agregar usuario" @close="creating = false">
    <form id="user-form" class="grid gap-4 sm:grid-cols-2" @submit.prevent="create">
      <div class="sm:col-span-2">
        <label class="label" for="u-name">Nombre</label>
        <input id="u-name" v-model="form.name" class="input" required maxlength="100" />
      </div>
      <div class="sm:col-span-2">
        <label class="label" for="u-email">Correo electrónico</label>
        <input id="u-email" v-model="form.email" type="email" class="input" required autocomplete="off" />
      </div>
      <div>
        <label class="label" for="u-pass">Contraseña (mín. 8 caracteres)</label>
        <input id="u-pass" v-model="form.password" type="password" class="input" required minlength="8" maxlength="200" autocomplete="new-password" />
      </div>
      <div>
        <label class="label" for="u-role">Rol</label>
        <select id="u-role" v-model="form.role" class="input">
          <option value="viewer">Lector (solo consulta)</option>
          <option value="admin">Administrador</option>
        </select>
      </div>
    </form>
    <template #footer>
      <button class="btn-secondary" @click="creating = false">Cancelar</button>
      <button type="submit" form="user-form" class="btn-primary" :disabled="saving"><Spinner v-if="saving" /><UserPlus v-else class="size-4" />Crear usuario</button>
    </template>
  </Modal>

  <Modal v-if="resetting" :title="`Restablecer contraseña de ${resetting.name}`" width="sm" @close="resetting = null">
    <form id="reset-form" class="space-y-3" @submit.prevent="resetPassword">
      <div>
        <label class="label" for="r-pass">Nueva contraseña (mín. 8 caracteres)</label>
        <input id="r-pass" v-model="newPassword" type="password" class="input" required minlength="8" maxlength="200" autocomplete="new-password" />
      </div>
      <p class="text-xs text-muted">Se cerrarán todas las sesiones abiertas de este usuario.</p>
    </form>
    <template #footer>
      <button class="btn-secondary" @click="resetting = null">Cancelar</button>
      <button type="submit" form="reset-form" class="btn-primary" :disabled="saving || newPassword.length < 8"><Spinner v-if="saving" />Actualizar</button>
    </template>
  </Modal>

  <Confirm
    v-if="removing"
    danger
    title="Eliminar usuario"
    :message="`Se eliminará a ${removing.name} (${removing.email}) y perderá el acceso de inmediato.`"
    confirm-label="Eliminar"
    @confirm="remove"
    @close="removing = null"
  />
</template>
