import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CustomerStatus } from '@pool/shared';

/** Header title set by the current page (e.g. the pool's name); cleared on navigation. */
export const useUiStore = defineStore('ui', () => {
  const title = ref('');
  const subtitle = ref('');
  function setTitle(t: string, sub = '') {
    title.value = t;
    subtitle.value = sub;
  }
  /** Customers screen filter; kept while the app is open, so Back returns to the same list. */
  const customerFilter = ref<CustomerStatus | 'all'>('current');
  return { title, subtitle, setTitle, customerFilter };
});
