// src/components/analytics/chartSetup.ts — registers the Chart.js pieces the analytics page
// uses, exactly once. Legends and titles are rendered as HTML (accessible, themeable), so the
// Legend and Title plugins are not registered.

import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  LinearScale,
  Tooltip,
} from "chart.js";

let registered = false;

export function setupCharts(): void {
  if (registered) return;
  Chart.register(
    BarController,
    BarElement,
    DoughnutController,
    ArcElement,
    CategoryScale,
    LinearScale,
    Tooltip
  );
  registered = true;
}
