import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { storeToRefs } from "pinia";
import { computed } from "vue";
import { useTheme } from "@/stores/theme";
import type { Category } from "./types";

use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, SVGRenderer]);

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Resolved design tokens for ECharts (it cannot read CSS variables itself). */
export function useChartTokens() {
  const { dark } = storeToRefs(useTheme());
  return computed(() => {
    void dark.value; // re-evaluate on theme change
    return {
      fg: cssVar("--c-fg"),
      muted: cssVar("--c-muted"),
      faint: cssVar("--c-faint"),
      line: cssVar("--c-line"),
      surface: cssVar("--c-surface"),
      raised: cssVar("--c-raised"),
      brand: cssVar("--c-brand"),
      series: {
        pass: cssVar("--c-series-pass"),
        forwarded: cssVar("--c-series-forwarded"),
        misaligned: cssVar("--c-series-misaligned"),
        fail: cssVar("--c-series-fail"),
      } as Record<Category, string>,
    };
  });
}

export function tooltipBase(t: ReturnType<typeof useChartTokens>["value"]) {
  return {
    backgroundColor: t.raised,
    borderColor: t.line,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: t.fg, fontSize: 12 },
    extraCssText: "border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);",
  };
}
