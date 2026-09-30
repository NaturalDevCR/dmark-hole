<script setup lang="ts">
import { ShieldAlert, ShieldCheck, ShieldOff } from "lucide-vue-next";
import { computed } from "vue";
import Badge from "@/components/ui/Badge.vue";
import { POLICY_LABEL } from "@/lib/format";

const props = defineProps<{ policy: string | null | undefined; pct?: number | null }>();
const tone = computed(() => (props.policy === "reject" ? "pass" : props.policy === "quarantine" ? "forwarded" : props.policy === "none" ? "misaligned" : "neutral"));
const icon = computed(() => (props.policy === "reject" ? ShieldCheck : props.policy === "quarantine" ? ShieldAlert : ShieldOff));
</script>

<template>
  <Badge :tone="tone">
    <component :is="icon" class="size-3.5" />
    <template v-if="policy">p={{ policy }}<span v-if="pct !== null && pct !== undefined && pct < 100">·{{ pct }}%</span></template>
    <template v-else>sin DMARC</template>
    <span class="sr-only">{{ policy ? POLICY_LABEL[policy] : "" }}</span>
  </Badge>
</template>
