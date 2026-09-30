<script setup lang="ts">
import { CheckCircle2, PlugZap, TriangleAlert, XCircle } from "lucide-vue-next";
import { computed, reactive, ref } from "vue";
import Modal from "@/components/ui/Modal.vue";
import Spinner from "@/components/ui/Spinner.vue";
import Toggle from "@/components/ui/Toggle.vue";
import { ApiError, api, withToast } from "@/lib/api";
import { num } from "@/lib/format";
import type { Mailbox } from "@/lib/types";

const props = defineProps<{ mailbox: Mailbox | null }>();
const emit = defineEmits<{ close: []; saved: [] }>();

const editing = computed(() => props.mailbox !== null);

const form = reactive({
  name: props.mailbox?.name ?? "",
  host: props.mailbox?.host ?? "",
  port: props.mailbox?.port ?? 993,
  secure: props.mailbox?.secure ?? true,
  username: props.mailbox?.username ?? "",
  password: "",
  folder: props.mailbox?.folder ?? "INBOX",
  afterAction: props.mailbox?.afterAction ?? ("move" as Mailbox["afterAction"]),
  processedFolder: props.mailbox?.processedFolder ?? "DMARC/Processed",
  failedFolder: props.mailbox?.failedFolder ?? "DMARC/Failed",
  onlyUnseen: props.mailbox?.onlyUnseen ?? true,
  tlsRejectUnauthorized: props.mailbox?.tlsRejectUnauthorized ?? true,
  pollMinutes: props.mailbox?.pollMinutes ?? 15,
  enabled: props.mailbox?.enabled ?? true,
});

const presets = [
  { name: "Gmail", host: "imap.gmail.com", note: "Gmail exige una contraseña de aplicación (requiere verificación en dos pasos) y tener IMAP habilitado." },
  { name: "Microsoft 365", host: "outlook.office365.com", note: "Microsoft puede haber deshabilitado la autenticación básica en su tenant; en ese caso use otro buzón o el receptor SMTP." },
  { name: "Yahoo", host: "imap.mail.yahoo.com", note: "Yahoo exige una contraseña de aplicación generada en la seguridad de la cuenta." },
  { name: "Zoho", host: "imap.zoho.com", note: "Habilite el acceso IMAP en Zoho Mail y use una contraseña de aplicación si tiene 2FA." },
  { name: "Fastmail", host: "imap.fastmail.com", note: "Use una contraseña de aplicación con permiso de acceso IMAP." },
];
const preset = ref<string | null>(null);
function applyPreset(p: (typeof presets)[number]) {
  form.host = p.host;
  form.port = 993;
  form.secure = true;
  preset.value = p.name;
  if (!form.name) form.name = p.name;
}

function body() {
  return {
    name: form.name,
    host: form.host,
    port: Number(form.port),
    secure: form.secure,
    username: form.username,
    password: form.password,
    folder: form.folder,
    afterAction: form.afterAction,
    processedFolder: form.processedFolder,
    failedFolder: form.failedFolder,
    onlyUnseen: form.onlyUnseen,
    tlsRejectUnauthorized: form.tlsRejectUnauthorized,
    enabled: form.enabled,
    pollMinutes: Number(form.pollMinutes),
  };
}

const saving = ref(false);
async function save() {
  saving.value = true;
  try {
    const ok = props.mailbox
      ? await withToast(() => api.put(`/mailboxes/${props.mailbox!.id}`, body()), "Buzón actualizado")
      : await withToast(() => api.post("/mailboxes", body()), "Buzón agregado");
    if (ok) emit("saved");
  } finally {
    saving.value = false;
  }
}

const testing = ref(false);
const testResult = ref<{ ok: true; folders: string[]; messages: number; unseen: number } | { ok: false; error: string } | null>(null);
async function test() {
  testing.value = true;
  testResult.value = null;
  try {
    const r = await api.post<{ folders: string[]; messages: number; unseen: number }>("/mailboxes/test", { ...body(), ...(props.mailbox ? { id: props.mailbox.id } : {}) });
    testResult.value = { ok: true, ...r };
  } catch (e) {
    const err = e as ApiError;
    const detail = err.issues?.map((i) => `${i.path}: ${i.message}`).join(" · ");
    testResult.value = { ok: false, error: detail ? `${err.message} — ${detail}` : err.message };
  } finally {
    testing.value = false;
  }
}

const canSave = computed(() => !!form.name && !!form.host && !!form.username && (editing.value || !!form.password));
</script>

<template>
  <Modal :title="editing ? 'Editar buzón' : 'Agregar buzón IMAP'" width="lg" @close="emit('close')">
    <form id="mailbox-form" class="space-y-5" @submit.prevent="save">
      <!-- Presets -->
      <div class="rounded-lg border border-line bg-subtle/60 p-3">
        <p class="text-xs font-medium text-muted">Proveedores comunes</p>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <button v-for="p in presets" :key="p.name" type="button" class="btn-secondary btn-sm" :class="preset === p.name && 'border-brand! text-brand'" @click="applyPreset(p)">
            {{ p.name }}
          </button>
        </div>
        <p class="mt-2 text-xs text-muted">
          {{ presets.find((p) => p.name === preset)?.note ?? "Elija un proveedor para rellenar servidor y puerto. Use un buzón dedicado (por ejemplo dmarc@sudominio.com) que reciba las direcciones rua." }}
        </p>
      </div>

      <div class="grid gap-4 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label class="label" for="mb-name">Nombre</label>
          <input id="mb-name" v-model="form.name" class="input" placeholder="Buzón DMARC" required maxlength="100" />
        </div>
        <div>
          <label class="label" for="mb-host">Servidor IMAP</label>
          <input id="mb-host" v-model="form.host" class="input" placeholder="imap.ejemplo.com" required autocomplete="off" />
        </div>
        <div class="grid grid-cols-2 items-end gap-3">
          <div>
            <label class="label" for="mb-port">Puerto</label>
            <input id="mb-port" v-model.number="form.port" type="number" min="1" max="65535" class="input" required />
          </div>
          <div class="pb-2"><Toggle v-model="form.secure" label="TLS" /></div>
        </div>
        <div>
          <label class="label" for="mb-user">Usuario</label>
          <input id="mb-user" v-model="form.username" class="input" placeholder="dmarc@ejemplo.com" required autocomplete="off" />
        </div>
        <div>
          <label class="label" for="mb-pass">Contraseña</label>
          <input id="mb-pass" v-model="form.password" type="password" class="input" :placeholder="editing ? 'sin cambios' : ''" :required="!editing" autocomplete="new-password" />
        </div>
        <div>
          <label class="label" for="mb-folder">Carpeta a leer</label>
          <input id="mb-folder" v-model="form.folder" class="input" placeholder="INBOX" required />
        </div>
        <div>
          <label class="label" for="mb-poll">Sincronizar cada (minutos)</label>
          <input id="mb-poll" v-model.number="form.pollMinutes" type="number" min="1" max="1440" class="input" required />
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="mb-after">Después de procesar cada mensaje</label>
          <select id="mb-after" v-model="form.afterAction" class="input">
            <option value="move">Mover a otra carpeta</option>
            <option value="seen">Marcar como leído</option>
            <option value="delete">Eliminar</option>
          </select>
        </div>
        <template v-if="form.afterAction === 'move'">
          <div>
            <label class="label" for="mb-processed">Carpeta de procesados</label>
            <input id="mb-processed" v-model="form.processedFolder" class="input" required />
          </div>
          <div>
            <label class="label" for="mb-failed">Carpeta de fallidos</label>
            <input id="mb-failed" v-model="form.failedFolder" class="input" required />
          </div>
        </template>
        <div v-if="form.afterAction === 'delete'" class="flex items-start gap-2 rounded-lg border border-misaligned/30 bg-misaligned-soft p-3 text-xs text-misaligned sm:col-span-2">
          <TriangleAlert class="mt-0.5 size-4 shrink-0" />
          <p>Los mensajes se eliminarán del buzón una vez procesados y no se podrán recuperar. Use esta opción solo con un buzón dedicado a reportes.</p>
        </div>
      </div>

      <div class="space-y-3.5 border-t border-line pt-4">
        <Toggle v-model="form.onlyUnseen" label="Solo mensajes sin leer" description="Ignora los mensajes ya leídos. Desactívelo para reprocesar un buzón existente (los duplicados se omiten)." />
        <Toggle v-model="form.tlsRejectUnauthorized" label="Verificar certificado TLS" description="Desactívelo solo con servidores propios que usen certificados autofirmados." />
        <Toggle v-model="form.enabled" label="Buzón activo" description="Si está desactivado no se sincroniza automáticamente, pero puede usar «Sincronizar ahora»." />
      </div>

      <div v-if="testResult" class="rounded-lg border p-3 text-sm" :class="testResult.ok ? 'border-pass/30 bg-pass-soft' : 'border-fail/30 bg-fail-soft'">
        <div v-if="testResult.ok" class="flex items-start gap-2 text-pass">
          <CheckCircle2 class="mt-0.5 size-4 shrink-0" />
          <p>
            Conexión correcta: {{ num(testResult.folders.length) }} carpetas · {{ num(testResult.messages) }} mensajes en «{{ form.folder }}» ({{ num(testResult.unseen) }} sin leer).
          </p>
        </div>
        <div v-else class="flex items-start gap-2 text-fail">
          <XCircle class="mt-0.5 size-4 shrink-0" />
          <p class="break-words">{{ testResult.error }}</p>
        </div>
      </div>
    </form>

    <template #footer>
      <button type="button" class="btn-secondary mr-auto" :disabled="testing || !form.host || !form.username || (!editing && !form.password)" @click="test">
        <Spinner v-if="testing" /><PlugZap v-else class="size-4" />Probar conexión
      </button>
      <button type="button" class="btn-secondary" @click="emit('close')">Cancelar</button>
      <button type="submit" form="mailbox-form" class="btn-primary" :disabled="saving || !canSave"><Spinner v-if="saving" />{{ editing ? "Guardar cambios" : "Agregar buzón" }}</button>
    </template>
  </Modal>
</template>
