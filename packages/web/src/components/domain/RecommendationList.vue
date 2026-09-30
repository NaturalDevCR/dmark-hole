<script setup lang="ts">
import { AlertOctagon, AlertTriangle, CheckCircle2, Lightbulb } from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CopyButton from "@/components/ui/CopyButton.vue";
import type { Recommendation } from "@/lib/types";

defineProps<{ items: Recommendation[] }>();
const { t } = useI18n();
const meta = computed(() => ({
  critical: { icon: AlertOctagon, cls: "text-fail bg-fail-soft", label: t("dns.recommendations.critical") },
  warning: { icon: AlertTriangle, cls: "text-misaligned bg-misaligned-soft", label: t("dns.recommendations.warning") },
  info: { icon: Lightbulb, cls: "text-forwarded bg-forwarded-soft", label: t("dns.recommendations.info") },
  success: { icon: CheckCircle2, cls: "text-pass bg-pass-soft", label: t("dns.recommendations.success") },
}));
</script>

<template>
  <ul class="divide-y divide-line">
    <li v-for="r in items" :key="r.id" class="flex gap-3.5 px-5 py-4">
      <span class="grid size-8 shrink-0 place-items-center rounded-lg" :class="meta[r.severity].cls">
        <component :is="meta[r.severity].icon" class="size-4" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">{{ r.title }}</p>
        <p class="mt-0.5 text-sm text-muted">{{ r.detail }}</p>
        <div v-if="r.action" class="mt-2 flex items-center gap-1 rounded-lg border border-line bg-subtle px-3 py-2">
          <code class="mono min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{{ r.action }}</code>
          <CopyButton :text="r.action" />
        </div>
      </div>
    </li>
  </ul>
</template>
