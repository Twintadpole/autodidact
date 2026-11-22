import { translated } from '@/i18n';
/** Invoice status labels and colours (draft, sent, paid, overdue, void). */
export const STATE_LABEL = translated({ draft: 'Draft', sent: 'Sent', paid: 'Paid', overdue: 'Overdue', void: 'Void' });
export const STATE_COLOR = { draft: 'grey-6', sent: 'blue-7', paid: 'positive', overdue: 'negative', void: 'grey-5' } as const;
