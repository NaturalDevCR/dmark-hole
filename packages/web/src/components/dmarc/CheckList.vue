<script setup lang="ts">
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-vue-next";
import type { Check } from "@/lib/types";

defineProps<{ checks: Check[] }>();
const icon = { ok: CheckCircle2, info: Info, warning: AlertTriangle, error: XCircle };
const color = { ok: "text-pass", info: "text-forwarded", warning: "text-misaligned", error: "text-fail" };
</script>

<template>
  <ul class="space-y-2.5">
    <li v-for="(c, i) in checks" :key="i" class="flex gap-2.5">
      <component :is="icon[c.status]" class="mt-0.5 size-4 shrink-0" :class="color[c.status]" />
      <div class="min-w-0 text-sm">
        <p class="font-medium">{{ c.title }}</p>
        <p v-if="c.detail" class="mt-0.5 text-muted break-words">{{ c.detail }}</p>
      </div>
    </li>
  </ul>
</template>
