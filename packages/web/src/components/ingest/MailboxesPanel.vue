<script setup lang="ts">
import { Inbox, Pencil, Plus, RefreshCw, Trash2 } from "lucide-vue-next";
import { reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
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
import { logStatusCount } from "./status";

defineProps<{ mailboxes: Mailbox[] | null; admin: boolean }>();
const emit = defineEmits<{ reload: [] }>();

interface RunResult {
  messages: number;
  reports: number;
  duplicates: number;
  errors: number;
  ignored: number;
}

const { t } = useI18n();
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
      const extra = [r.duplicates ? logStatusCount("duplicate", r.duplicates) : "", r.ignored ? logStatusCount("ignored", r.ignored) : "", r.errors ? logStatusCount("error", r.errors) : ""].filter(Boolean);
      const params = { name: m.name, messages: t("ingest.mailboxes.messagesCount", { n: num(r.messages) }, r.messages), reports: t("ingest.mailboxes.newReportsCount", { n: num(r.reports) }, r.reports) };
      toasts.push(r.errors ? "info" : "success", extra.length ? t("ingest.mailboxes.runResultExtra", { ...params, extra: extra.join(", ") }) : t("ingest.mailboxes.runResult", params));
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
  if (await withToast(() => api.del(`/mailboxes/${m.id}`), t("ingest.mailboxes.removed"))) emit("reload");
}

const afterLabel = (m: Mailbox) => (m.afterAction === "move" ? t("ingest.mailboxes.afterMove", { folder: m.processedFolder }) : m.afterAction === "seen" ? t("ingest.mailboxes.afterSeen") : t("ingest.mailboxes.afterDelete"));
</script>

<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <i18n-t keypath="ingest.mailboxes.intro" tag="p" class="max-w-2xl text-sm text-muted">
        <template #rua><span class="mono">rua</span></template>
      </i18n-t>
      <button v-if="admin && mailboxes?.length" class="btn-primary" @click="openForm(null)"><Plus class="size-4" />{{ t("ingest.mailboxes.add") }}</button>
    </div>

    <div v-if="!mailboxes" class="grid gap-4 lg:grid-cols-2"><Skeleton v-for="i in 2" :key="i" class="h-56" /></div>

    <div v-else-if="!mailboxes.length" class="card border-dashed">
      <Empty :icon="Inbox" :title="t('ingest.mailboxes.emptyTitle')" :description="t('ingest.mailboxes.emptyDescription')">
        <button v-if="admin" class="btn-primary" @click="openForm(null)"><Plus class="size-4" />{{ t("ingest.mailboxes.add") }}</button>
      </Empty>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-2">
      <section v-for="m in mailboxes" :key="m.id" class="card flex flex-col">
        <div class="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h3 class="truncate text-sm font-semibold">{{ m.name }}</h3>
              <Badge :tone="m.enabled ? 'pass' : 'neutral'" dot>{{ m.enabled ? t("ingest.mailboxes.active") : t("ingest.mailboxes.paused") }}</Badge>
              <Badge v-if="running[m.id] || m.running" tone="forwarded"><Spinner class="size-3" />{{ t("ingest.mailboxes.syncing") }}</Badge>
            </div>
            <p class="mono mt-1 truncate text-muted">{{ m.username }}@{{ m.host }}:{{ m.port }}</p>
          </div>
          <Badge v-if="!m.secure" tone="misaligned">{{ t("ingest.mailboxes.noTls") }}</Badge>
        </div>

        <dl class="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 px-5 py-4 text-sm">
          <div>
            <dt class="text-xs text-muted">{{ t("ingest.mailboxes.folder") }}</dt>
            <dd class="mono truncate">{{ m.folder }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ t("ingest.mailboxes.frequency") }}</dt>
            <dd>{{ t("ingest.mailboxes.everyMinutes", { n: m.pollMinutes }) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ t("ingest.mailboxes.afterProcess") }}</dt>
            <dd class="truncate" :title="afterLabel(m)">{{ afterLabel(m) }}</dd>
          </div>
          <div>
            <dt class="text-xs text-muted">{{ t("ingest.mailboxes.totals") }}</dt>
            <dd class="tabular-nums">{{ t("ingest.mailboxes.totalsValue", { messages: t("ingest.mailboxes.messagesCount", { n: num(m.totalMessages) }, m.totalMessages), reports: t("ingest.mailboxes.reportsCount", { n: num(m.totalReports) }, m.totalReports) }) }}</dd>
          </div>
          <div class="col-span-2">
            <dt class="text-xs text-muted">{{ t("ingest.mailboxes.lastSync") }}</dt>
            <dd class="mt-0.5 flex flex-wrap items-center gap-2">
              <span>{{ ago(m.lastRunAt) }}</span>
              <Badge v-if="m.lastStatus" :tone="m.lastStatus === 'ok' ? 'pass' : 'fail'" dot>{{ m.lastStatus === "ok" ? t("ingest.mailboxes.lastOk") : t("ingest.mailboxes.lastError") }}</Badge>
            </dd>
            <p v-if="m.lastError" class="mt-2 break-words rounded-lg border border-fail/20 bg-fail-soft px-3 py-2 text-xs text-fail">{{ m.lastError }}</p>
          </div>
        </dl>

        <div v-if="admin" class="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <button class="btn-secondary btn-sm" :disabled="running[m.id] || m.running" @click="run(m)">
            <Spinner v-if="running[m.id]" class="size-3.5" /><RefreshCw v-else class="size-3.5" />{{ t("ingest.mailboxes.syncNow") }}
          </button>
          <button class="btn-ghost btn-sm" @click="openForm(m)"><Pencil class="size-3.5" />{{ t("common.actions.edit") }}</button>
          <button class="btn-ghost btn-sm ml-auto text-fail hover:text-fail" @click="removing = m"><Trash2 class="size-3.5" />{{ t("common.actions.delete") }}</button>
        </div>
      </section>
    </div>

    <MailboxForm v-if="formOpen" :mailbox="editing" @close="formOpen = false" @saved="onSaved" />
    <Confirm
      v-if="removing"
      danger
      :title="t('ingest.mailboxes.confirmRemoveTitle')"
      :message="t('ingest.mailboxes.confirmRemoveMessage', { name: removing.name })"
      :confirm-label="t('common.actions.delete')"
      @confirm="remove"
      @close="removing = null"
    />
  </div>
</template>
