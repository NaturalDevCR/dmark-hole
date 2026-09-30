<script setup lang="ts">
import { Eye, EyeOff, KeyRound, RefreshCw } from "lucide-vue-next";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import Card from "@/components/ui/Card.vue";
import Confirm from "@/components/ui/Confirm.vue";
import CopyButton from "@/components/ui/CopyButton.vue";
import Spinner from "@/components/ui/Spinner.vue";
import { api, withToast } from "@/lib/api";
import type { IngestStatus } from "@/lib/types";
import CodeLine from "./CodeLine.vue";

const { t } = useI18n();
const props = defineProps<{ status: IngestStatus | null; admin: boolean }>();
const emit = defineEmits<{ reload: [] }>();

const token = computed(() => props.status?.ingestToken ?? null);
const revealed = ref(false);
const confirming = ref(false);
const rotating = ref(false);
const MASKED = "••••••••••••••••••••••••••••••••";

const base = typeof window !== "undefined" ? `${window.location.protocol}//${window.location.host}` : "https://dmarc.example.com";
const curl = (t: string) => `curl -X POST \\\n  -H "Authorization: Bearer ${t}" \\\n  -H "Content-Type: application/gzip" \\\n  --data-binary @report.xml.gz \\\n  ${base}/api/ingest/raw`;
const curlReal = computed(() => curl(token.value ?? "<token>"));
const curlShown = computed(() => curl(token.value && revealed.value ? token.value : token.value ? "••••••••" : "<token>"));

async function rotate() {
  confirming.value = false;
  rotating.value = true;
  try {
    if (await withToast(() => api.post<{ token: string }>("/settings/ingest-token/rotate"), t("ingest.api.rotated"))) {
      revealed.value = true;
      emit("reload");
    }
  } finally {
    rotating.value = false;
  }
}
</script>

<template>
  <div class="grid gap-6 xl:grid-cols-2">
    <Card :title="t('ingest.api.tokenTitle')" :subtitle="t('ingest.api.tokenSubtitle')">
      <div v-if="admin && token" class="space-y-4">
        <div>
          <label class="label" for="ingest-token">{{ t("ingest.api.token") }}</label>
          <div class="flex items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 py-1.5">
            <KeyRound class="size-4 shrink-0 text-faint" />
            <input id="ingest-token" class="mono min-w-0 flex-1 bg-transparent px-2 py-1 text-fg outline-none" readonly :value="revealed ? token : MASKED" />
            <button type="button" class="btn-ghost btn-sm p-1.5" :title="revealed ? t('ingest.api.hide') : t('ingest.api.show')" @click="revealed = !revealed">
              <EyeOff v-if="revealed" class="size-3.5" /><Eye v-else class="size-3.5" />
            </button>
            <CopyButton :text="token" />
          </div>
        </div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="max-w-md text-xs text-muted">{{ t("ingest.api.tokenWarning") }}</p>
          <button class="btn-secondary btn-sm" :disabled="rotating" @click="confirming = true"><Spinner v-if="rotating" class="size-3.5" /><RefreshCw v-else class="size-3.5" />{{ t("ingest.api.regenerate") }}</button>
        </div>
      </div>
      <p v-else class="text-sm text-muted">{{ t("ingest.api.adminOnly") }}</p>
    </Card>

    <Card :title="t('ingest.api.httpTitle')" :subtitle="t('ingest.api.httpSubtitle')">
      <div class="space-y-4 text-sm">
        <CodeLine :text="curlReal" :display="curlShown" :label="t('ingest.api.curlExample')" />
        <ul class="list-disc space-y-1.5 pl-5 text-muted">
          <i18n-t keypath="ingest.api.tip1" tag="li">
            <template #gz><span class="mono">.gz</span></template>
            <template #zip><span class="mono">.zip</span></template>
            <template #eml><span class="mono">.eml</span></template>
            <template #contentType><span class="mono">Content-Type</span></template>
          </i18n-t>
          <i18n-t keypath="ingest.api.tip2" tag="li">
            <template #xFilename><span class="mono">X-Filename</span></template>
          </i18n-t>
          <li>{{ t("ingest.api.tip3") }}</li>
        </ul>
      </div>
    </Card>

    <Confirm
      v-if="confirming"
      danger
      :title="t('ingest.api.confirmTitle')"
      :message="t('ingest.api.confirmMessage')"
      :confirm-label="t('ingest.api.regenerate')"
      @confirm="rotate"
      @close="confirming = false"
    />
  </div>
</template>
