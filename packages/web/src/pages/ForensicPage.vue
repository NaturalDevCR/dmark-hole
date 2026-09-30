<script setup lang="ts">
import { ShieldQuestion, Trash2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
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
const { t } = useI18n();
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
  const ok = await withToast(() => api.del(`/forensic/${id}`), t("forensic.deleted"));
  confirmDelete.value = false;
  if (ok === undefined) return;
  close();
  if (data.value && data.value.items.length === 1 && page.value > 1) page.value--;
  else await reload();
}

const FIELDS: { key: string; ts?: boolean; mono?: boolean }[] = [
  { key: "domain" },
  { key: "received_at", ts: true },
  { key: "arrival_ts", ts: true },
  { key: "reporter" },
  { key: "feedback_type" },
  { key: "auth_failure" },
  { key: "delivery_result" },
  { key: "source_ip", mono: true },
  { key: "reported_domain" },
  { key: "header_from" },
  { key: "original_mail_from" },
  { key: "original_rcpt_to" },
  { key: "subject" },
  { key: "message_id", mono: true },
  { key: "dkim_domain" },
  { key: "dkim_selector", mono: true },
  { key: "spf_dns", mono: true },
  { key: "source" },
];
const fields = computed(() =>
  detail.value
    ? FIELDS.map((f) => ({ ...f, label: t(`forensic.fields.${f.key}`), value: detail.value![f.key] })).filter((f) => f.value !== null && f.value !== undefined && f.value !== "")
    : [],
);

const failTone = (v: string | null) => (v === "dmarc" ? "fail" : v ? "misaligned" : "neutral");
const deliveryTone = (v: string | null) => (v === "reject" ? "fail" : v === "delivered" ? "pass" : v ? "misaligned" : "neutral");
</script>

<template>
  <PageHeader
    :title="$t('forensic.title')"
    :subtitle="$t('forensic.subtitle')"
  >
    <div class="w-full sm:w-64">
      <select v-model="domainId" class="input" :aria-label="$t('forensic.domain')">
        <option value="">{{ $t("forensic.allDomains") }}</option>
        <option v-for="d in domains ?? []" :key="d.id" :value="String(d.id)">{{ d.name }}</option>
      </select>
    </div>
  </PageHeader>

  <section class="card overflow-hidden">
    <div v-if="error" class="px-5 py-4 text-sm text-fail">{{ $t("forensic.loadError", { error }) }}</div>
    <div v-if="!data" class="space-y-2 p-4">
      <Skeleton v-for="i in 6" :key="i" class="h-12" />
    </div>
    <Empty
      v-else-if="!data.items.length"
      :icon="ShieldQuestion"
      :title="$t('forensic.empty.title')"
      :description="$t('forensic.empty.description')"
    >
      <RouterLink to="/domains" class="btn-secondary">{{ $t("forensic.empty.reviewDomains") }}</RouterLink>
    </Empty>
    <template v-else>
      <div class="overflow-x-auto" :class="loading && 'opacity-60 transition'">
        <table class="table">
          <thead>
            <tr>
              <th>{{ $t("forensic.table.received") }}</th>
              <th>{{ $t("forensic.table.domain") }}</th>
              <th>{{ $t("forensic.table.source") }}</th>
              <th>{{ $t("forensic.table.from") }}</th>
              <th>{{ $t("forensic.table.to") }}</th>
              <th>{{ $t("forensic.table.subject") }}</th>
              <th>{{ $t("forensic.table.failure") }}</th>
              <th>{{ $t("forensic.table.delivery") }}</th>
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

  <Modal v-if="openId !== null" :title="$t('forensic.modal.title')" width="xl" @close="close">
    <div v-if="detailLoading" class="flex items-center justify-center gap-2 py-12 text-sm text-muted"><Spinner />{{ $t("forensic.modal.loading") }}</div>
    <p v-else-if="detailError" class="py-6 text-center text-sm text-fail">{{ detailError }}</p>
    <div v-else-if="detail" class="space-y-5">
      <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div v-for="f in fields" :key="f.key" class="min-w-0">
          <dt class="text-xs font-medium text-muted">{{ f.label }}</dt>
          <dd class="mt-0.5 text-sm break-words" :class="f.mono && 'mono'">{{ f.ts ? date(Number(f.value), true) : f.value }}</dd>
        </div>
      </dl>
      <div>
        <p class="label">{{ $t("forensic.modal.originalHeaders") }}</p>
        <pre v-if="detail.headers" class="mono max-h-72 overflow-auto rounded-lg border border-line bg-subtle p-3 whitespace-pre-wrap break-all">{{ detail.headers }}</pre>
        <p v-else class="text-sm text-muted">{{ $t("forensic.modal.noHeaders") }}</p>
      </div>
    </div>
    <template #footer>
      <button v-if="auth.isAdmin && detail" class="btn-danger mr-auto" @click="confirmDelete = true"><Trash2 class="size-4" />{{ $t("common.actions.delete") }}</button>
      <button class="btn-secondary" @click="close">{{ $t("common.actions.close") }}</button>
    </template>
  </Modal>

  <Confirm
    v-if="confirmDelete"
    :title="$t('forensic.delete.title')"
    :message="$t('forensic.delete.message')"
    :confirm-label="$t('common.actions.delete')"
    danger
    @confirm="remove"
    @close="confirmDelete = false"
  />
</template>
