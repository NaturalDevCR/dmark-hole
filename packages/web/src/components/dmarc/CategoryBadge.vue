<script setup lang="ts">
import Badge from "@/components/ui/Badge.vue";
import { CATEGORY } from "@/lib/format";
import type { Category } from "@/lib/types";
defineProps<{ category: Category }>();
</script>

<template>
  <Badge :tone="category" dot :title="CATEGORY[category].hint">{{ CATEGORY[category].label }}</Badge>
</template>
