<script setup lang="ts">
import { useRoute } from "vue-router";
import RangePicker from "@/components/dmarc/RangePicker.vue";
import SourcesExplorer from "@/components/sources/SourcesExplorer.vue";
import PageHeader from "@/components/ui/PageHeader.vue";
import type { SourceStatus } from "@/lib/types";

const route = useRoute();
const initial = (typeof route.query.status === "string" ? route.query.status : null) as SourceStatus | null;
</script>

<template>
  <PageHeader :title="$t('sources.title')" :subtitle="$t('sources.subtitle')">
    <RangePicker />
  </PageHeader>
  <SourcesExplorer :initial-status="initial" />
</template>
