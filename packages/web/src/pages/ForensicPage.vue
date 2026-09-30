<script setup lang="ts">
import { ShieldQuestion, Trash2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import IpCell from "@/components/dmarc/IpCell.vue";
import Badge from "@/components/ui/Badge.vue";
import Confirm from "@/components/ui/Confirm.vue";
import Empty from "@/components/ui/Empty.vue";
import Modal from "@/components/ui/Modal.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Pagination from "@/components/ui/Pagination.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import { ago, date } from "@/lib/format";
import type { DomainSummary, ForensicItem, Paged } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useAuth } from "@/stores/auth";

const PAGE_SIZE = 50;
const auth = useAuth();
const page = ref(1);
const domainId = ref("");

const { data: domains } = useLoader(() => api.get<DomainSummary[]>("/domains", { days: 365 }));
const { data, loading, error, reload } = useLoader(
  () => api.get<Paged<ForensicItem>>("/forensic", { domainId: domainId.value, page: page.value, pageSize: PAGE_SIZE }),
  [domainId, page],
);
watch(domainId, () => (page.value = 1));

/** Raw row of GET /forensic/:id (snake_case columns). */
type ForensicRow = Record<string, string | number | null> & { id: number; headers: string | null };

const openId = ref<number | null>(null);
const detail = ref<ForensicRow | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);
const confirmDelete = ref(false);

async function open(id: number) {
  openId.value = id;
  detail.value = null;
  detailError.value = null;
  detailLoading.value = true;
  try {
    const row = await api.get<ForensicRow>(`/forensic/${id}`);
    if (openId.value === id) detail.value = row;
  } catch (e) {
    if (openId.value === id) detailError.value = (e as Error).message;
  } finally {
    if (openId.value === id) detailLoading.value = false;
  }
}
function close() {
  openId.value = null;
  confirmDelete.value = false;
}

async function remove() {
  const id = openId.value;
  if (id === null) return;
  const ok = await withToast(() => api.del(`/forensic/${id}`), "Reporte forense eliminado");
  confirmDelete.value = false;
  if (ok === undefined) return;
  close();
  if (data.value && data.value.items.length === 1 && page.value > 1) page.value--;
  else await reload();
}

const FIELDS: { key: string; label: string; ts?: boolean; mono?: boolean }[] = [
  { key: "domain", label: "Dominio" },
  { key: "received_at", label: "Recibido", ts: true },
  { key: "arrival_ts", label: "Llegada del mensaje", ts: true },
  { key: "reporter", label: "Reportador" },
  { key: "feedback_type", label: "Tipo de feedback" },
  { key: "auth_failure", label: "Fallo de autenticación" },
  { key: "delivery_result", label: "Resultado de entrega" },
  { key: "source_ip", label: "IP de origen", mono: true },
  { key: "reported_domain", label: "Dominio reportado" },
  { key: "header_from", label: "Header From" },
  { key: "original_mail_from", label: "Mail From original" },
  { key: "original_rcpt_to", label: "Rcpt To original" },
  { key: "subject", label: "Asunto" },
  { key: "message_id", label: "Message-ID", mono: true },
  { key: "dkim_domain", label: "Dominio DKIM" },
  { key: "dkim_selector", label: "Selector DKIM", mono: true },
  { key: "spf_dns", label: "SPF DNS", mono: true },
  { key: "source", label: "Fuente de ingesta" },
];
const fields = computed(() =>
  detail.value
    ? FIELDS.map((f) => ({ ...f, value: detail.value![f.key] })).filter((f) => f.value !== null && f.value !== undefined && f.value !== "")
    : [],
);

const failTone = (v: string | null) => (v === "dmarc" ? "fail" : v ? "misaligned" : "neutral");
const deliveryTone = (v: string | null) => (v === "reject" ? "fail" : v === "delivered" ? "pass" : v ? "misaligned" : "neutral");
</script>

<template>
  <PageHeader
    title="Reportes forenses (RUF)"
    subtitle="Muestras individuales de mensajes que fallaron la autenticación. Pueden contener datos personales (direcciones, asuntos y cabeceras); la retención se configura en Configuración."
  >
    <div class="w-full sm:w-64">
      <select v-model="domainId" class="input" aria-label="Dominio">
        <option value="">Todos los dominios</option>
        <option v-for="d in domains ?? []" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
      </select>
    </div>
  </PageHeader>

  <section class="card overflow-hidden">
    <div v-if="error" class="px-5 py-4 text-sm text-fail">No se pudieron cargar los reportes: {{ error }}</div>
    <div v-if="!data" class="space-y-2 p-4">
      <Skeleton v-for="i in 6" :key="i" class="h-12" />
    </div>
    <Empty
      v-else-if="!data.items.length"
      :icon="ShieldQuestion"
      title="Aún no hay reportes forenses"
      description="Los reportes RUF solo llegan si el registro DMARC del dominio incluye la etiqueta ruf=mailto:... y el receptor los soporta. La mayoría de los grandes proveedores (Google, Microsoft, Yahoo) no los envían por razones de privacidad, por lo que es normal ver esta sección vacía."
    >
      <RouterLink to="/domains" class="btn-secondary">Revisar configuración de dominios</RouterLink>
    </Empty>
    <template v-else>
      <div class="overflow-x-auto" :class="loading && 'opacity-60 transition'">
        <table class="table">
          <thead>
            <tr>
              <th>Recibido</th>
              <th>Dominio</th>
              <th>Origen</th>
              <th>De</th>
              <th>Para</th>
              <th>Asunto</th>
              <th>Fallo</th>
              <th>Entrega</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="f in data.items" :key="f.id" class="row-link" @click="open(f.id)">
              <td class="whitespace-nowrap text-sm text-muted" :title="date(f.receivedAt, true)">{{ ago(f.receivedAt) }}</td>
              <td class="whitespace-nowrap">{{ f.domain ?? "—" }}</td>
              <td class="max-w-56">
                <IpCell v-if="f.sourceIp" :ip="f.sourceIp" :ptr="f.ptr" :provider="f.provider" :country="f.country" />
                <span v-else class="text-muted">—</span>
              </td>
              <td class="max-w-48">
                <p class="truncate">{{ f.headerFrom ?? "—" }}</p>
                <p v-if="f.originalMailFrom" class="truncate text-xs text-muted" :title="f.originalMailFrom">{{ f.originalMailFrom }}</p>
              </td>
              <td class="max-w-48 truncate" :title="f.originalRcptTo ?? ''">{{ f.originalRcptTo ?? "—" }}</td>
              <td class="max-w-64 truncate" :title="f.subject ?? ''">{{ f.subject ?? "—" }}</td>
              <td><Badge v-if="f.authFailure" :tone="failTone(f.authFailure)" dot>{{ f.authFailure }}</Badge><span v-else class="text-muted">—</span></td>
              <td><Badge v-if="f.deliveryResult" :tone="deliveryTone(f.deliveryResult)">{{ f.deliveryResult }}</Badge><span v-else class="text-muted">—</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination v-model="page" :total="data.total" :page-size="PAGE_SIZE" />
    </template>
  </section>

  <Modal v-if="openId !== null" title="Reporte forense" width="xl" @close="close">
    <div v-if="detailLoading" class="flex items-center justify-center gap-2 py-12 text-sm text-muted"><Spinner />Cargando…</div>
    <p v-else-if="detailError" class="py-6 text-center text-sm text-fail">{{ detailError }}</p>
    <div v-else-if="detail" class="space-y-5">
      <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div v-for="f in fields" :key="f.key" class="min-w-0">
          <dt class="text-xs font-medium text-muted">{{ f.label }}</dt>
          <dd class="mt-0.5 text-sm break-words" :class="f.mono && 'mono'">{{ f.ts ? date(Number(f.value), true) : f.value }}</dd>
        </div>
      </dl>
      <div>
        <p class="label">Cabeceras originales</p>
        <pre v-if="detail.headers" class="mono max-h-72 overflow-auto rounded-lg border border-line bg-subtle p-3 whitespace-pre-wrap break-all">{{ detail.headers }}</pre>
        <p v-else class="text-sm text-muted">El reporte no incluye cabeceras.</p>
      </div>
    </div>
    <template #footer>
      <button v-if="auth.isAdmin && detail" class="btn-danger mr-auto" @click="confirmDelete = true"><Trash2 class="size-4" />Eliminar</button>
      <button class="btn-secondary" @click="close">Cerrar</button>
    </template>
  </Modal>

  <Confirm
    v-if="confirmDelete"
    title="Eliminar reporte forense"
    message="Se eliminará permanentemente esta muestra y sus cabeceras. Esta acción no se puede deshacer."
    confirm-label="Eliminar"
    danger
    @confirm="remove"
    @close="confirmDelete = false"
  />
</template>
