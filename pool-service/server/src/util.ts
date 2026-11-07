import { v7 as uuidv7 } from 'uuid';
import { z } from 'zod';

/** Query-string boolean: "true"/"1" → true, "false"/"0" → false. */
export const queryBool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** UUID v7: time-ordered, same format the phone generates. */
export function newId(): string {
  return uuidv7();
}

/** Error with an HTTP status, thrown from services and mapped by the error handler. */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
