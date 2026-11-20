/**
 * Logins from the command line (GPF item 3), for deploy/set-password.sh and gpf/tenant.sh.
 * Never prints a password.
 *
 *   node server/dist/cli/users.js list                          JSON: email, name, role, active, months
 *   node server/dist/cli/users.js techs <YYYY-MM>               active techs that month (billing)
 *   echo 'pw' | node server/dist/cli/users.js set-password [<email>]
 *        new password for that login (default: the first owner); signs out its devices
 *   echo 'pw' | node server/dist/cli/users.js ensure-owner <email> <name>
 *        first start of a new tenant: the owner login, if there is none yet
 */
import mongoose from 'mongoose';
import { loadConfig } from '../config.js';
import { ensureCollections, SessionDoc, User } from '../models/index.js';
import { hashPassword } from '../services/users.js';
import { newId } from '../util.js';

async function stdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}
function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const config = loadConfig();
await mongoose.connect(config.mongoUrl);
await ensureCollections();
try {
  const [cmd, a, b] = process.argv.slice(2);
  if (cmd === 'list') {
    const users = await User.find({}).sort({ role: 1, name: 1 }).lean<Record<string, any>[]>();
    console.log(JSON.stringify(users.map((u) => ({ email: u.email, name: u.name, role: u.role, active: u.active, activeMonths: u.activeMonths ?? [] }))));
  } else if (cmd === 'techs') {
    const month = a ?? new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d\d$/.test(month)) fail('Month as YYYY-MM');
    console.log(await User.countDocuments({ role: 'tech', activeMonths: month }));
  } else if (cmd === 'set-password') {
    const user = a
      ? await User.findOne({ email: a.toLowerCase() }).lean<{ _id: string }>()
      : await User.findOne({ role: 'owner', active: true }).sort({ createdAt: 1 }).lean<{ _id: string }>();
    if (!user) fail('No such login');
    const pw = await stdin();
    if (pw.length < 8) fail('Use at least 8 characters');
    await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(pw), mustChangePassword: false, failedLogins: 0, lockedUntil: null, updatedAt: new Date() } });
    const out = await SessionDoc.deleteMany({ 'session.userId': user._id });
    console.log(`Password changed; ${out.deletedCount} device(s) signed out`);
  } else if (cmd === 'ensure-owner') {
    if (!a || !b) fail('ensure-owner <email> <name>');
    const pw = await stdin();
    if (pw.length < 8) fail('Use at least 8 characters');
    if (await User.exists({ role: 'owner' })) {
      console.log('An owner login exists already; nothing changed');
    } else {
      const now = new Date();
      await User.create({ _id: newId(), email: a.toLowerCase(), name: b, role: 'owner', passwordHash: await hashPassword(pw), mustChangePassword: true, createdAt: now, updatedAt: now });
      console.log(`Owner login made for ${a.toLowerCase()}`);
    }
  } else {
    fail('Commands: list | techs <YYYY-MM> | set-password [<email>] | ensure-owner <email> <name>');
  }
} finally {
  await mongoose.disconnect();
}
