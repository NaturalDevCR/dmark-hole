<script setup lang="ts">
import { Inbox, Pencil, Plus, RefreshCw, Trash2 } from "lucide-vue-next";
import { reactive, ref } from "vue";
import Badge from "@/components/ui/Badge.vue";
import Confirm from "@/components/ui/Confirm.vue";
import Empty from "@/components/ui/Empty.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import { ago, num } from "@/lib/format";
import type { Mailbox } from "@/lib/types";
import { useToasts } from "@/stores/toasts";
import MailboxForm from "./MailboxForm.vue";

defineProps<{ mailboxes: Mailbox[] | null; admin: boolean }>();
const emit = defineEmits<{ reload: [] }>();

interface RunResult {
  messages: number;
  reports: number;
  duplicates: number;
  errors: number;
  ignored: number;
}

const toasts = useToasts();
const formOpen = ref(false);
const editing = ref<Mailbox | null>(null);
const removing = ref<Mailbox | null>(null);
const running = reactive<Record<number, boolean>>({});

function openForm(m: Mailbox | null) {
  editing.value = m;
  formOpen.value = true;
}
function onSaved() {
  formOpen.value = false;
  emit("reload");
}

async function run(m: Mailbox) {
  running[m.id] = true;
  try {
    const r = await withToast(() => api.post<RunResult>(`/mailboxes/${m.id}/run`));
    if (r) {
      const extra = [r.duplicates ? `${r.duplicates} duplicados` : "", r.ignored ? `${r.ignored} ignorados` : "", r.errors ? `${r.errors} con error` : ""].filter(Boolean);
      toasts.push(r.errors ? "info" : "success", `${m.name}: ${num(r.messages)} mensajes, ${num(r.reports)} reportes nuevos${extra.length ? ` (${extra.join(", ")})` : ""}`);
    }
  } finally {
    running[m.id] = false;
    emit("reload");
  }
}

async function remove() {
  const m = removing.value;
  removing.value = null;
  if (!m) return;
  if (await withToast(() => api.del(`/mailboxes/${m.id}`), "Buzón eliminado")) emit("reload");
}

const afterLabel = (m: Mailbox) => (m.afterAction === "move" ? `Mover a ${m.processedFolder}` : m.afterAction === "seen" ? "Marcar como leído" : "Eliminar mensaje");
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p class="max-w-2xl text-sm text-muted">
        Un buzón IMAP recibe los reportes que los proveedores envían a su dirección <span class="mono">rua</span>. DMARK-Hole lo revisa periódicamente, extrae los adjuntos y archiva los mensajes.
      </p>
      <button v-if="admin && mailboxes?.length" class="btn-primary" @click="openForm(null)"><Plus class="size-4" />Agregar buzón</button>
    </div>

    <div v-if="!mailboxes" class="grid gap-4 lg:grid-cols-2"><Skeleton v-for="i in 2" :key="i" class="h-56" /></div>

    <div v-else-if="!mailboxes.length" class="card border-dashed">
      <Empty :icon="Inbox" title="Aún no hay buzones IMAP" description="Conecte el buzón donde llegan los reportes DMARC. También puede recibirlos por SMTP directo o subirlos manualmente.">
        <button v-if="admin" class="btn-primary" @click="openForm(null)"><Plus class="size-4" />Agregar buzón</button>
      </Empty>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-2">
      <section v-for="m in mailboxes" :key="m.id" class="card flex flex-col">
        <div class="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="truncate text-sm font-semibold">{{ m.name }}</h3>
              <Badge :tone="m.enabled ? 'pass' : 'neutral'" dot>{{ m.enabled ? "Activo" : "Pausado" }}</Badge>
              <Badge v-if="running[m.id] || m.running" tone="forwarded"><Spinner class="size-3" />Sincronizando</Badge>
            </div>
            <p class="mono mt-1 truncate text-muted">{{ m.username }}@{{ m.host }}:{{ m.port }}</p>
          </div>
          <Badge v-if="!m.secure" tone="misaligned">Sin TLS</Badge>
        </div>

        <dl class="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-sm">
          <div>
            <dt class="text-xs text-muted">Carpeta</dt>
            <dd class="mono truncate">{{ m.folder }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Frecuencia</dt>
            <dd>Cada {{ m.pollMinutes }} min</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Después de procesar</dt>
            <dd class="truncate" :title="afterLabel(m)">{{ afterLabel(m) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">Totales</dt>
            <dd class="tabular-nums">{{ num(m.totalMessages) }} mensajes · {{ num(m.totalReports) }} reportes</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-xs text-muted">Última sincronización</dt>
            <dd class="mt-0.5 flex flex-wrap items-center gap-2">
              <span>{{ ago(m.lastRunAt) }}</span>
              <Badge v-if="m.lastStatus" :tone="m.lastStatus === 'ok' ? 'pass' : 'fail'" dot>{{ m.lastStatus === "ok" ? "Correcta" : "Con error" }}</Badge>
            </dd>
            <p v-if="m.lastError" class="mt-2 break-words rounded-lg border border-fail/20 bg-fail-soft px-3 py-2 text-xs text-fail">{{ m.lastError }}</p>
          </div>
        </dl>

        <div v-if="admin" class="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <button class="btn-secondary btn-sm" :disabled="running[m.id] || m.running" @click="run(m)">
            <Spinner v-if="running[m.id]" class="size-3.5" /><RefreshCw v-else class="size-3.5" />Sincronizar ahora
          </button>
          <button class="btn-ghost btn-sm" @click="openForm(m)"><Pencil class="size-3.5" />Editar</button>
          <button class="btn-ghost btn-sm ml-auto text-fail hover:text-fail" @click="removing = m"><Trash2 class="size-3.5" />Eliminar</button>
        </div>
      </section>
    </div>

    <MailboxForm v-if="formOpen" :mailbox="editing" @close="formOpen = false" @saved="onSaved" />
    <Confirm
      v-if="removing"
      danger
      title="Eliminar buzón"
      :message="`Se eliminará la configuración de «${removing.name}». Los reportes ya importados se conservan y los mensajes del buzón no se modifican.`"
      confirm-label="Eliminar"
      @confirm="remove"
      @close="removing = null"
    />
  </div>
</template>
