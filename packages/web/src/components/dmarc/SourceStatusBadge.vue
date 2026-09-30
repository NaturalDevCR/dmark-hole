<script setup lang="ts">
import Badge from "@/components/ui/Badge.vue";
import { SOURCE_STATUS } from "@/lib/format";
import type { SourceStatus } from "@/lib/types";
defineProps<{ status: SourceStatus }>();
</script>

<template>
  <Badge :tone="SOURCE_STATUS[status].tone" dot>{{ SOURCE_STATUS[status].label }}</Badge>
</template>
