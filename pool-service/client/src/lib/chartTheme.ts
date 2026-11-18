/**
 * Chart colours and marks (Phase 7D), from the data-viz reference palette (light mode; the app has no
 * dark mode). Categorical slots are used in this fixed order, never cycled; text uses ink, not series colours.
 */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
export const INK = { primary: '#0b0b0b', secondary: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', surface: '#fcfcfb' };
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
/** Ordinal ramp (blue, step 250 → 650): owed by age, light = recent, dark = oldest. */
export const AGE_RAMP = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];

const font = { fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', color: INK.secondary, fontSize: 11 };

/** Shared pieces of every chart: recessive axes and grid, hover tooltips. */
export const base = {
  textStyle: font,
  animationDuration: 300,
  tooltip: { confine: true, backgroundColor: '#fff', borderColor: INK.axis, textStyle: { color: INK.primary, fontSize: 12 } },
};
export const valueAxis = (format: (v: number) => string) => ({
  type: 'value' as const,
  // Whole-dollar steps, so an empty chart doesn't repeat "$0, $0, $1".
  minInterval: 1,
  axisLabel: { color: INK.muted, formatter: format },
  splitLine: { lineStyle: { color: INK.grid, width: 1 } },
  axisLine: { show: false },
  axisTick: { show: false },
});
export const categoryAxis = (data: string[]) => ({
  type: 'category' as const,
  data,
  axisLabel: { color: INK.muted, hideOverlap: true },
  axisLine: { lineStyle: { color: INK.axis } },
  axisTick: { show: false },
});
/** Bars: 4px rounded ends on the value side. */
export const barEnd = (horizontal = false) => ({ borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] });
/** Axis labels: $850, $1.2k. */
export const compactMoney = (v: number) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 100) / 10}k` : `$${Math.round(v)}`);

/** Full screen: scroll-wheel/pinch zoom plus a slider under the chart to look at part of it. */
export const zoomFor = (on: boolean, horizontal = false) =>
  on
    ? {
        dataZoom: [
          { type: 'inside', ...(horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }) },
          horizontal
            ? { type: 'slider', yAxisIndex: 0, width: 16, right: 4, borderColor: INK.axis, fillerColor: 'rgba(42,120,214,0.12)' }
            : { type: 'slider', xAxisIndex: 0, height: 18, bottom: 4, borderColor: INK.axis, fillerColor: 'rgba(42,120,214,0.12)' },
        ],
      }
    : {};
