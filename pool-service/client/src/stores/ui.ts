import { defineStore } from 'pinia';
import { ref } from 'vue';

/** Header title set by the current page (e.g. the pool's name); cleared on navigation. */
export const useUiStore = defineStore('ui', () => {
  const title = ref('');
  const subtitle = ref('');
  function setTitle(t: string, sub = '') {
    title.value = t;
    subtitle.value = sub;
  }
  return { title, subtitle, setTitle };
});
