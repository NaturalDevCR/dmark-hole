<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p class="text-sm text-muted-foreground">Email authentication health overview</p>
      </div>
      <select v-model="period" class="rounded-md border bg-background px-3 py-1.5 text-sm">
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
        <option value="90d">Last 90 days</option>
        <option value="1y">Last year</option>
      </select>
    </div>

    <!-- Stats Grid -->
    <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard title="DMARC Pass Rate" :value="overview?.dmarcPassRate || 0" suffix="%" trend="up" color="primary" />
      <StatCard title="SPF Pass Rate" :value="overview?.spfPassRate || 0" suffix="%" trend="up" color="success" />
      <StatCard title="DKIM Pass Rate" :value="overview?.dkimPassRate || 0" suffix="%" trend="up" color="warning" />
      <StatCard title="Open Alerts" :value="overview?.alertsOpen || 0" suffix="" :trend="(overview?.alertsCritical || 0) > 0 ? 'down' : 'stable'" color="destructive" />
    </div>

    <!-- Main Charts -->
    <div class="grid gap-4 lg:grid-cols-3">
      <!-- Auth Trend Chart -->
      <div class="chart-container lg:col-span-2">
        <h3 class="mb-4 text-sm font-semibold">Authentication Trends</h3>
        <div ref="trendChartRef" class="h-80"></div>
      </div>

      <!-- Domain Health -->
      <div class="chart-container">
        <h3 class="mb-4 text-sm font-semibold">Domain Health</h3>
        <div class="space-y-3">
          <div v-for="domain in domainHealth" :key="domain.domain" class="flex items-center gap-3">
            <div class="flex-1 truncate">
              <p class="text-sm font-medium truncate">{{ domain.domain }}</p>
              <div class="mt-1 h-1.5 w-full rounded-full bg-muted">
                <div
                  class="h-1.5 rounded-full transition-all"
                  :class="scoreColor(domain.overallScore)"
                  :style="{ width: `${domain.overallScore}%` }"
                />
              </div>
            </div>
            <span class="text-sm font-mono font-medium" :class="scoreColor(domain.overallScore)">{{ Math.round(domain.overallScore) }}%</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Secondary Grid -->
    <div class="grid gap-4 lg:grid-cols-2">
      <!-- Top Senders -->
      <div class="chart-container">
        <h3 class="mb-4 text-sm font-semibold">Top Sending Sources</h3>
        <div class="space-y-2">
          <div v-for="sender in topSenders?.slice(0, 8)" :key="sender.sourceIp" class="flex items-center justify-between text-sm">
            <div class="flex items-center gap-2 truncate">
              <div class="h-2 w-2 rounded-full bg-primary" />
              <span class="font-mono text-xs">{{ sender.sourceIp }}</span>
              <span v-if="sender.sourceOrg" class="text-xs text-muted-foreground">{{ sender.sourceOrg }}</span>
            </div>
            <span class="text-xs text-muted-foreground">{{ sender.totalCount.toLocaleString() }}</span>
          </div>
        </div>
      </div>

      <!-- Geographic Distribution -->
      <div class="chart-container">
        <h3 class="mb-4 text-sm font-semibold">Geographic Distribution</h3>
        <div ref="geoChartRef" class="h-80"></div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="rounded-lg border bg-card p-4">
      <h3 class="mb-3 text-sm font-semibold">Quick Setup Guide</h3>
      <div class="grid gap-3 md:grid-cols-3">
        <div class="rounded-md border p-3">
          <span class="text-xs text-muted-foreground">Step 1</span>
          <p class="text-sm font-medium">Add Your Domain</p>
          <p class="text-xs text-muted-foreground">Register your domain to start monitoring DMARC reports</p>
        </div>
        <div class="rounded-md border p-3">
          <span class="text-xs text-muted-foreground">Step 2</span>
          <p class="text-sm font-medium">Connect Mailbox</p>
          <p class="text-xs text-muted-foreground">Link IMAP or webhook to receive DMARC aggregate reports</p>
        </div>
        <div class="rounded-md border p-3">
          <span class="text-xs text-muted-foreground">Step 3</span>
          <p class="text-sm font-medium">Configure Alerts</p>
          <p class="text-xs text-muted-foreground">Set up notifications for authentication failures</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from "vue";
import * as echarts from "echarts";
import { useApi } from "@/composables/useApi";
import StatCard from "@/components/dashboard/StatCard.vue";

const api = useApi();
const period = ref("30d");

interface Overview {
  dmarcPassRate: number;
  spfPassRate: number;
  dkimPassRate: number;
  alertsOpen: number;
  alertsCritical: number;
}

interface DomainHealthItem {
  domain: string;
  overallScore: number;
}

interface SenderItem {
  sourceIp: string;
  sourceOrg?: string;
  totalCount: number;
}

const overview = ref<Overview | null>(null);
const domainHealth = ref<DomainHealthItem[]>([]);
const topSenders = ref<SenderItem[]>([]);
const trendChartRef = ref<HTMLElement | null>(null);
const geoChartRef = ref<HTMLElement | null>(null);

let trendChart: echarts.ECharts | null = null;
let geoChart: echarts.ECharts | null = null;

function scoreColor(score: number) {
  if (score >= 80) return "text-green-500";
  if (score >= 60) return "text-yellow-500";
  return "text-red-500";
}

async function loadData() {
  const [ov, health, senders, timeseries] = await Promise.all([
    api.get<{ data: Overview }>(`/dashboard/overview?period=${period.value}`),
    api.get<{ data: DomainHealthItem[] }>("/dashboard/domain-health"),
    api.get<{ data: SenderItem[] }>("/dashboard/top-senders"),
    api.get<{ data: Array<{ date: string; dmarcPass: number; dmarcFail: number; spfPass: number; spfFail: number; dkimPass: number; dkimFail: number }> }>(`/dashboard/timeseries?period=${period.value}`),
  ]);

  if (ov) overview.value = ov.data;
  if (health) domainHealth.value = health.data;
  if (senders) topSenders.value = senders.data;

  if (timeseries?.data && trendChartRef.value) {
    renderTrendChart(timeseries.data);
  }
}

function renderTrendChart(data: Array<{ date: string; dmarcPass: number; dmarcFail: number; spfPass: number; spfFail: number; dkimPass: number; dkimFail: number }>) {
  if (!trendChartRef.value) return;

  if (!trendChart) {
    trendChart = echarts.init(trendChartRef.value, "dark");
  }

  trendChart.setOption({
    tooltip: { trigger: "axis" },
    legend: { data: ["DMARC Pass", "SPF Pass", "DKIM Pass"], bottom: 0, textStyle: { fontSize: 12 } },
    grid: { left: 40, right: 20, top: 20, bottom: 40 },
    xAxis: { type: "category", data: data.map((d) => d.date.slice(5)), axisLabel: { fontSize: 11 } },
    yAxis: { type: "value", axisLabel: { fontSize: 11 } },
    series: [
      { name: "DMARC Pass", type: "line", data: data.map((d) => d.dmarcPass), smooth: true, lineStyle: { color: "#3b82f6" }, itemStyle: { color: "#3b82f6" }, areaStyle: { color: "rgba(59,130,246,0.1)" } },
      { name: "SPF Pass", type: "line", data: data.map((d) => d.spfPass), smooth: true, lineStyle: { color: "#22c55e" }, itemStyle: { color: "#22c55e" }, areaStyle: { color: "rgba(34,197,94,0.1)" } },
      { name: "DKIM Pass", type: "line", data: data.map((d) => d.dkimPass), smooth: true, lineStyle: { color: "#eab308" }, itemStyle: { color: "#eab308" }, areaStyle: { color: "rgba(234,179,8,0.1)" } },
    ],
  });
}

watch(period, () => loadData());
onMounted(() => loadData());
</script>
