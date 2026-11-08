<template>
  <div class="trend">
    <div class="row items-baseline justify-between">
      <span class="text-caption text-weight-medium">{{ label }}</span>
      <span class="text-caption text-grey-7">{{ points.length ? `latest ${fmtNumber(points[points.length - 1]!.v)}` : 'no data' }}</span>
    </div>
    <svg v-if="points.length > 1" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="full-width" :style="{ height: `${H}px` }" role="img" :aria-label="`${label} trend`">
      <rect v-if="band" :x="0" :width="W" :y="y(band.max)" :height="Math.max(0, y(band.min) - y(band.max))" fill="#e8f5e9" />
      <polyline :points="line" fill="none" stroke="#0277bd" stroke-width="2" vector-effect="non-scaling-stroke" />
      <circle v-for="(p, i) in points" :key="i" :cx="x(i)" :cy="y(p.v)" r="3" fill="#0277bd" />
    </svg>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { fmtNumber } from '@/lib/format';

/** Tiny dependency-free line chart; the green band is the ideal range. */
const props = defineProps<{ label: string; points: { v: number }[]; band?: { min: number; max: number } }>();

const W = 300;
const H = 64;
const PAD = 6;

const range = computed(() => {
  const vals = props.points.map((p) => p.v);
  if (props.band) vals.push(props.band.min, props.band.max);
  let min = Math.min(...vals);
  let max = Math.max(...vals);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return { min, max };
});

const x = (i: number) => (props.points.length <= 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (props.points.length - 1));
const y = (v: number) => H - PAD - ((v - range.value.min) * (H - 2 * PAD)) / (range.value.max - range.value.min);
const line = computed(() => props.points.map((p, i) => `${x(i)},${y(p.v)}`).join(' '));
</script>
