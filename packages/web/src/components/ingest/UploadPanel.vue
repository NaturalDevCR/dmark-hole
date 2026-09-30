<script setup lang="ts">
import { CheckCircle2, CircleSlash, Copy, TriangleAlert, UploadCloud, XCircle } from "lucide-vue-next";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import Badge from "@/components/ui/Badge.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import { LOG_STATUS, logStatusCount, type LogStatus } from "./status";

const { t } = useI18n();
const emit = defineEmits<{ uploaded: [] }>();

interface UploadItem {
  kind: "aggregate" | "forensic" | "unknown";
  status: LogStatus;
  name: string;
  domain?: string;
  reportId?: number;
  message?: string;
}
interface UploadResult {
  file: string;
  items: UploadItem[];
  warnings: string[];
  counts: Record<LogStatus, number>;
}

const input = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
const uploading = ref(false);
const results = ref<UploadResult[]>([]);
const ACCEPT = ".xml,.gz,.zip,.eml,.xml.gz";

const icons = { ok: CheckCircle2, duplicate: Copy, error: XCircle, ignored: CircleSlash } as const;
const iconColor: Record<LogStatus, string> = { ok: "text-pass", duplicate: "text-faint", error: "text-fail", ignored: "text-misaligned" };

async function upload(files: File[]) {
  if (!files.length || uploading.value) return;
  const form = new FormData();
  for (const f of files) form.append("files", f, f.name);
  uploading.value = true;
  try {
    const r = await withToast(() => api.upload<UploadResult[]>("/ingest/upload", form));
    if (r) {
      results.value = r;
      emit("uploaded");
    }
  } finally {
    uploading.value = false;
    if (input.value) input.value.value = "";
  }
}

function onPick(e: Event) {
  upload(Array.from((e.target as HTMLInputElement).files ?? []));
}
function onDrop(e: DragEvent) {
  dragging.value = false;
  upload(Array.from(e.dataTransfer?.files ?? []));
}
const total = (r: UploadResult, s: LogStatus) => r.counts?.[s] ?? 0;
</script>

<template>
  <div class="space-y-6">
    <div
      class="card flex cursor-pointer flex-col items-center justify-center border-2 border-dashed px-6 py-12 text-center transition"
      :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong hover:bg-subtle/60'"
      role="button"
      tabindex="0"
      @click="input?.click()"
      @keydown.enter.prevent="input?.click()"
      @keydown.space.prevent="input?.click()"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <span class="grid size-12 place-items-center rounded-xl bg-brand-soft text-brand">
        <Spinner v-if="uploading" class="size-5" /><UploadCloud v-else class="size-6" />
      </span>
      <p class="mt-3 text-sm font-medium">{{ uploading ? t("ingest.upload.processing") : t("ingest.upload.drop") }}</p>
      <i18n-t keypath="ingest.upload.accepts" tag="p" class="mt-1 max-w-md text-sm text-muted">
        <template #xml><span class="mono">.xml</span></template>
        <template #gz><span class="mono">.gz</span></template>
        <template #zip><span class="mono">.zip</span></template>
        <template #eml><span class="mono">.eml</span></template>
      </i18n-t>
      <input ref="input" type="file" multiple :accept="ACCEPT" class="hidden" @change="onPick" />
    </div>

    <div v-if="results.length" class="space-y-3">
      <h3 class="text-sm font-semibold">{{ t("ingest.upload.result") }}</h3>
      <section v-for="(r, i) in results" :key="i" class="card">
        <header class="card-header">
          <p class="mono min-w-0 truncate font-medium">{{ r.file }}</p>
          <div class="flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge v-for="s in (['ok', 'duplicate', 'error', 'ignored'] as LogStatus[])" v-show="total(r, s) > 0" :key="s" :tone="LOG_STATUS[s].tone">{{ logStatusCount(s, total(r, s)) }}</Badge>
          </div>
        </header>
        <ul v-if="r.items.length" class="divide-y divide-line">
          <li v-for="(it, j) in r.items" :key="j" class="flex items-start gap-3 px-5 py-3 text-sm">
            <component :is="icons[it.status]" class="mt-0.5 size-4 shrink-0" :class="iconColor[it.status]" />
            <div class="min-w-0 flex-1">
              <p class="mono truncate">{{ it.name }}</p>
              <p class="mt-0.5 break-words text-xs" :class="it.status === 'error' ? 'text-fail' : it.status === 'ignored' ? 'text-misaligned' : 'text-muted'">
                <span v-if="it.domain" class="font-medium text-fg">{{ it.domain }} · </span>{{ it.message ?? LOG_STATUS[it.status].label }}
              </p>
            </div>
            <RouterLink v-if="it.kind === 'aggregate' && it.reportId && it.status === 'ok'" :to="`/reports/${it.reportId}`" class="btn-ghost btn-sm shrink-0">{{ t("ingest.viewReport") }}</RouterLink>
          </li>
        </ul>
        <p v-else class="px-5 py-4 text-sm text-muted">{{ t("ingest.upload.none") }}</p>
        <ul v-if="r.warnings.length" class="space-y-1 border-t border-line bg-misaligned-soft px-5 py-3">
          <li v-for="(w, k) in r.warnings" :key="k" class="flex items-start gap-2 text-xs text-misaligned">
            <TriangleAlert class="mt-0.5 size-3.5 shrink-0" /><span class="break-words">{{ w }}</span>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
