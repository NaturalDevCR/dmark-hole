<script setup lang="ts">
import { Database, DatabaseBackup } from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import Card from "@/components/ui/Card.vue";
import CopyButton from "@/components/ui/CopyButton.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import { api } from "@/lib/api";
import { bytes } from "@/lib/format";
import { useLoader } from "@/lib/useLoader";
import CodeLine from "@/components/ingest/CodeLine.vue";

const { t } = useI18n();

interface SystemInfo {
  version: string;
  node: string;
  uptime: number;
  dataDir: string;
  dbSizeBytes: number;
  smtpPort: number;
}

const { data, error } = useLoader(() => api.get<SystemInfo>("/system"));

const backupCmd = computed(() => `sqlite3 ${data.value?.dataDir ?? "/data"}/dmark-hole.db ".backup '${t("settings.system.backupPath")}'"`);

function humanUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} d ${h} h ${m} min`;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${sec} s`;
}
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-2">
    <Card :title="t('settings.system.infoTitle')">
      <p v-if="error" class="text-sm text-fail">{{ error }}</p>
      <Skeleton v-else-if="!data" class="h-56" />
      <dl v-else class="divide-y divide-line text-sm">
        <div class="flex items-center justify-between gap-4 py-2.5 first:pt-0"><dt class="text-muted">{{ t("settings.system.version") }}</dt><dd class="mono">{{ data.version }}</dd></div>
        <div class="flex items-center justify-between gap-4 py-2.5"><dt class="text-muted">Node.js</dt><dd class="mono">{{ data.node }}</dd></div>
        <div class="flex items-center justify-between gap-4 py-2.5"><dt class="text-muted">{{ t("settings.system.uptime") }}</dt><dd>{{ humanUptime(data.uptime) }}</dd></div>
        <div class="flex items-center justify-between gap-4 py-2.5">
          <dt class="text-muted">{{ t("settings.system.dataDir") }}</dt>
          <dd class="flex min-w-0 items-center gap-1"><span class="mono truncate">{{ data.dataDir }}</span><CopyButton :text="data.dataDir" /></dd>
        </div>
        <div class="flex items-center justify-between gap-4 py-2.5"><dt class="text-muted">{{ t("settings.system.dbSize") }}</dt><dd class="tabular-nums">{{ bytes(data.dbSizeBytes) }}</dd></div>
        <div class="flex items-center justify-between gap-4 py-2.5 last:pb-0"><dt class="text-muted">{{ t("settings.system.smtpPort") }}</dt><dd class="mono">{{ data.smtpPort }}</dd></div>
      </dl>
    </Card>

    <Card :title="t('settings.system.backupTitle')" :subtitle="t('settings.system.backupSubtitle')">
      <template #actions><span class="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand"><DatabaseBackup class="size-4" /></span></template>
      <div class="space-y-4 text-sm text-muted">
        <i18n-t keypath="settings.system.backupIntro" tag="p">
          <template #dir><span v-if="data" class="mono text-fg">{{ data.dataDir }}</span></template>
        </i18n-t>
        <p class="flex items-start gap-2"><Database class="mt-0.5 size-4 shrink-0 text-faint" />{{ t("settings.system.hotBackup") }}</p>
        <CodeLine :text="backupCmd" />
        <i18n-t keypath="settings.system.secretNote" tag="p">
          <template #secret><span class="mono">.secret</span></template>
        </i18n-t>
      </div>
    </Card>
  </div>
</template>
