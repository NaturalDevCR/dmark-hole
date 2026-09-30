<script setup lang="ts">
import type { SpfNode } from "@/lib/types";
defineOptions({ name: "SpfTree" });
defineProps<{ node: SpfNode; depth?: number }>();
const qual: Record<string, string> = { "+": "", "-": "-", "~": "~", "?": "?" };
</script>

<template>
  <div :class="(depth ?? 0) > 0 && 'ml-4 border-l border-line pl-3'">
    <div class="flex items-center gap-2 py-1 text-sm">
      <span class="mono font-medium">{{ node.domain }}</span>
      <span v-if="node.lookups" class="rounded bg-subtle px-1.5 text-[11px] text-muted">{{ node.lookups }} consulta{{ node.lookups > 1 ? "s" : "" }}</span>
      <span v-if="node.error" class="text-xs text-fail">{{ node.error }}</span>
    </div>
    <div v-if="node.mechanisms.length" class="mb-1 flex flex-wrap gap-1">
      <span
        v-for="(m, i) in node.mechanisms.filter((m) => !['include', 'redirect'].includes(m.type))"
        :key="i"
        class="mono rounded border border-line px-1.5 py-px text-[11px]"
        :class="m.type === 'all' ? (m.qualifier === '-' || m.qualifier === '~' ? 'text-pass' : 'text-fail') : 'text-muted'"
      >{{ qual[m.qualifier] }}{{ m.type }}{{ m.value ? `:${m.value}` : "" }}</span>
    </div>
    <SpfTree v-for="c in node.children" :key="c.domain" :node="c" :depth="(depth ?? 0) + 1" />
  </div>
</template>
