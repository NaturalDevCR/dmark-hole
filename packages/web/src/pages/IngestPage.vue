<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";
import { Cpu, FileText, Globe, Inbox, Radio, ScrollText, Upload } from "lucide-vue-next";
import { storeToRefs } from "pinia";
import { computed, ref, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import ApiPanel from "@/components/ingest/ApiPanel.vue";
import LogPanel from "@/components/ingest/LogPanel.vue";
import MailboxesPanel from "@/components/ingest/MailboxesPanel.vue";
import SmtpPanel from "@/components/ingest/SmtpPanel.vue";
import UploadPanel from "@/components/ingest/UploadPanel.vue";
import Badge from "@/components/ui/Badge.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import Tabs from "@/components/ui/Tabs.vue";
import { api } from "@/lib/api";
import { ago, num } from "@/lib/format";
import type { IngestStatus, Mailbox } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { useAuth } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const { isAdmin } = storeToRefs(useAuth());

const { data: status, reload: reloadStatus } = useLoader(() => api.get<IngestStatus>("/ingest/status"));
const { data: mailboxes, reload: reloadMailboxes } = useLoader(() => api.get<Mailbox[]>("/mailboxes"));
useIntervalFn(() => {
  reloadStatus();
  reloadMailboxes();
}, 20_000);

const logKey = ref(0);
function refreshAll() {
  reloadStatus();
  reloadMailboxes();
  logKey.value++;
}

const tabs = computed<{ id: string; label: string; icon: Component; count?: number | null }[]>(() => [
  { id: "mailboxes", label: "Buzones IMAP", icon: Inbox, count: mailboxes.value?.length ?? null },
  ...(isAdmin.value ? [{ id: "upload", label: "Subir archivos", icon: Upload }] : []),
  { id: "smtp", label: "Receptor SMTP", icon: Radio },
  { id: "api", label: "API / HTTP", icon: Globe },
  { id: "log", label: "Registro", icon: ScrollText },
]);
const initial = String(route.query.tab ?? "");
const tab = ref(tabs.value.some((t) => t.id === initial) ? initial : "mailboxes");
watch(tab, (t) => router.replace({ query: { ...route.query, tab: t === "mailboxes" ? undefined : t } }));

const activeMailboxes = computed(() => mailboxes.value?.filter((m) => m.enabled).length ?? 0);
const mailboxErrors = computed(() => mailboxes.value?.filter((m) => m.lastStatus === "error").length ?? 0);
</script>

<template>
  <PageHeader title="Ingesta de reportes" subtitle="Reciba reportes DMARC por buzón IMAP, SMTP directo, HTTP o carga manual" />

  <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    <template v-if="status">
      <div class="card p-4">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium text-muted">Reportes recibidos</p>
          <span class="grid size-7 place-items-center rounded-lg bg-brand-soft text-brand"><FileText class="size-3.5" /></span>
        </div>
        <p class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{{ num(status.counts.reports) }}</p>
        <p class="mt-1 truncate text-xs text-muted">{{ num(status.counts.forensic) }} forenses · último {{ ago(status.counts.last) }}</p>
      </div>

      <div class="card p-4">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium text-muted">Receptor SMTP</p>
          <Badge :tone="status.smtp.running ? 'pass' : 'neutral'" dot>{{ status.smtp.running ? "Activo" : "Detenido" }}</Badge>
        </div>
        <p class="mono mt-2 text-lg font-semibold">:{{ status.smtp.port }}</p>
        <p v-if="status.smtp.lastError" class="mt-1 truncate text-xs text-fail" :title="status.smtp.lastError">{{ status.smtp.lastError }}</p>
        <p v-else class="mt-1 truncate text-xs text-muted">{{ num(status.smtp.received) }} mensajes recibidos{{ status.smtp.tls ? " · TLS" : "" }}</p>
      </div>

      <div class="card p-4">
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-medium text-muted">Cola de enriquecimiento</p>
          <span class="grid size-7 place-items-center rounded-lg bg-forwarded-soft text-forwarded"><Cpu class="size-3.5" /></span>
        </div>
        <p class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{{ num(status.enrichment.pending) }}</p>
        <p class="mt-1 truncate text-xs text-muted">pendientes · {{ num(status.enrichment.active) }} en proceso</p>
      </div>
    </template>
    <template v-else><Skeleton v-for="i in 3" :key="i" class="h-[104px]" /></template>

    <div v-if="mailboxes" class="card p-4">
      <div class="flex items-center justify-between gap-2">
        <p class="text-xs font-medium text-muted">Buzones IMAP</p>
        <span class="grid size-7 place-items-center rounded-lg bg-brand-soft text-brand"><Inbox class="size-3.5" /></span>
      </div>
      <p class="mt-1.5 text-2xl font-semibold tracking-tight tabular-nums">{{ num(mailboxes.length) }}</p>
      <p class="mt-1 truncate text-xs" :class="mailboxErrors ? 'text-fail' : 'text-muted'">{{ num(activeMailboxes) }} activos{{ mailboxErrors ? ` · ${mailboxErrors} con error` : "" }}</p>
    </div>
    <Skeleton v-else class="h-[104px]" />
  </div>

  <div class="mt-6">
    <Tabs v-model="tab" :tabs="tabs" />
    <div class="pt-6">
      <MailboxesPanel v-if="tab === 'mailboxes'" :mailboxes="mailboxes" :admin="isAdmin" @reload="refreshAll" />
      <UploadPanel v-else-if="tab === 'upload'" @uploaded="refreshAll" />
      <SmtpPanel v-else-if="tab === 'smtp'" :status="status" :admin="isAdmin" @reload="reloadStatus" />
      <ApiPanel v-else-if="tab === 'api'" :status="status" :admin="isAdmin" @reload="reloadStatus" />
      <LogPanel v-else :refresh-key="logKey" />
    </div>
  </div>
</template>
