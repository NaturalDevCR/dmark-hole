<script setup lang="ts">
import { RefreshCw, ScrollText } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import Badge from "@/components/ui/Badge.vue";
import Card from "@/components/ui/Card.vue";
import Empty from "@/components/ui/Empty.vue";
import Pagination from "@/components/ui/Pagination.vue";
import Skeleton from "@/components/ui/Skeleton.vue";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import type { IngestLogItem, Paged } from "@/lib/types";
import { useLoader } from "@/lib/useLoader";
import { kindLabel, LOG_STATUS, type LogStatus } from "./status";

const { t } = useI18n();
const props = defineProps<{ refreshKey?: number }>();

const PAGE_SIZE = 25;
const page = ref(1);
const status = ref<LogStatus | "">("");
const chips = computed<{ id: LogStatus | ""; label: string }[]>(() => [{ id: "", label: t("ingest.log.all") }, ...(Object.keys(LOG_STATUS) as LogStatus[]).map((id) => ({ id, label: LOG_STATUS[id].label }))]);

const { data, loading, error, reload } = useLoader(
  () => api.get<Paged<IngestLogItem>>("/ingest/log", { page: page.value, pageSize: PAGE_SIZE, status: status.value || undefined }),
  [page, status],
);
watch(status, () => (page.value = 1));
watch(() => props.refreshKey, reload);
</script>

<template>
  <Card flush>
    <template #header>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="c in chips"
          :key="c.id"
          class="rounded-full border px-3 py-1 text-xs font-medium transition"
          :class="status === c.id ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong bg-surface text-muted hover:bg-subtle hover:text-fg'"
          @click="status = c.id"
        >
          {{ c.label }}
        </button>
      </div>
    </template>
    <template #actions>
      <button class="btn-ghost btn-sm" :disabled="loading" @click="reload"><RefreshCw class="size-3.5" :class="loading && 'animate-spin'" />{{ t("ingest.log.refresh") }}</button>
    </template>

    <div v-if="!data && loading" class="space-y-2 p-5"><Skeleton v-for="i in 6" :key="i" class="h-9" /></div>
    <p v-else-if="error" class="p-5 text-sm text-fail">{{ error }}</p>
    <Empty v-else-if="data && !data.items.length" :icon="ScrollText" :title="t('ingest.log.emptyTitle')" :description="status ? t('ingest.log.emptyFiltered') : t('ingest.log.emptyDefault')" />
    <template v-else-if="data">
      <div class="overflow-x-auto">
        <table class="table">
          <thead>
            <tr><th>{{ t("ingest.log.cols.date") }}</th><th>{{ t("ingest.log.cols.source") }}</th><th>{{ t("ingest.log.cols.status") }}</th><th>{{ t("ingest.log.cols.kind") }}</th><th>{{ t("ingest.log.cols.domain") }}</th><th>{{ t("ingest.log.cols.detail") }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="it in data.items" :key="it.id">
              <td class="whitespace-nowrap text-muted">{{ date(it.ts, true) }}</td>
              <td class="mono max-w-56 truncate text-muted" :title="it.source">{{ it.source }}</td>
              <td><Badge :tone="LOG_STATUS[it.status].tone" dot>{{ LOG_STATUS[it.status].label }}</Badge></td>
              <td class="text-muted">{{ it.kind ? kindLabel(it.kind) : "—" }}</td>
              <td class="font-medium">{{ it.domain ?? "—" }}</td>
              <td class="max-w-md">
                <RouterLink v-if="it.kind === 'aggregate' && it.reportRef" :to="`/reports/${it.reportRef}`" class="block truncate text-brand hover:underline" :title="it.message ?? ''">{{ it.message ?? t("ingest.viewReport") }}</RouterLink>
                <p v-else class="truncate" :title="it.message ?? ''">{{ it.message ?? "—" }}</p>
                <p v-if="it.subject" class="truncate text-xs text-muted" :title="it.subject">{{ it.subject }}</p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <Pagination v-model="page" :total="data.total" :page-size="PAGE_SIZE" />
    </template>
  </Card>
</template>
