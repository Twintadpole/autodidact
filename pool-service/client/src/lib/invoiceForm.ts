import { newId } from './format';

export { localDate } from './money';

/** A blank invoice line for the form. */
export const newIdLine = () => ({ _id: newId(), description: '', amount: '' as string | number });
