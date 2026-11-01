/**
 * Prints an argon2 hash for ADMIN_PASSWORD_HASH.
 *   npm run hash-password -- 'my password'
 * or run without an argument to type it (not echoed).
 */
import argon2 from 'argon2';
import readline from 'node:readline';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Hide typed characters.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
    if (s.includes(question)) process.stdout.write(s);
  };
  const answer = await new Promise<string>((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const password = process.argv[2] ?? (await prompt('Password: '));
if (!password || password.length < 8) {
  console.error('Use a password of at least 8 characters.');
  process.exit(1);
}
const hash = await argon2.hash(password, { type: argon2.argon2id });
console.log(hash);
console.error("\nPut it in .env as ADMIN_PASSWORD_HASH='<hash>' (single quotes: the hash contains $).");
