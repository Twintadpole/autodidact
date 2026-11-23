/**
 * Prints an argon2id hash for ADMIN_PASSWORD_HASH.
 *
 *   npm run hash-password                 # prompts (input hidden)
 *   echo 'pw' | node dist/cli/hash-password.js -   # reads the password from stdin
 *
 * In the production image: docker compose run --rm --no-deps -T api node server/dist/cli/hash-password.js -
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

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

const arg = process.argv[2];
const password = arg === '-' ? await readStdin() : (arg ?? (await prompt('Password: ')));
if (!password || password.length < 8) {
  console.error('Use a password of at least 8 characters.');
  process.exit(1);
}
const hash = await argon2.hash(password, { type: argon2.argon2id });
console.log(hash);
if (arg !== '-') {
  console.error("\nPut it in .env as ADMIN_PASSWORD_HASH='<hash>' (single quotes: the hash contains $).");
}
