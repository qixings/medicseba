// Create or reset an admin login from the server terminal.
//   npx tsx src/scripts/create-admin.ts <username> "<Full name>" [OWNER|MANAGER|SUPPORT]
// The password is typed in (not shown, not saved in shell history).
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline';
import { db, pool, schema } from '../db.js';

const [username, name, role = 'OWNER'] = process.argv.slice(2);
if (!username || !name || !['OWNER', 'MANAGER', 'SUPPORT'].includes(role)) {
  console.log('Usage: npx tsx src/scripts/create-admin.ts <username> "<Full name>" [OWNER|MANAGER|SUPPORT]');
  process.exit(1);
}

function askHidden(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => { if (s.includes(q)) out.output.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

const pw = await askHidden('Password (8+ characters): ');
if (pw.length < 8) { console.log('Too short'); process.exit(1); }
if ((await askHidden('Type it again: ')) !== pw) { console.log('The two passwords do not match'); process.exit(1); }

await db.insert(schema.adminUsers).values({ username: username.toLowerCase(), name, role: role as 'OWNER', passwordHash: await bcrypt.hash(pw, 10) })
  .onConflictDoUpdate({ target: schema.adminUsers.username, set: { name, role: role as 'OWNER', passwordHash: await bcrypt.hash(pw, 10), active: true, passwordChangedAt: new Date() } });
console.log(`Admin "${username}" is ready (${role}).`);
await pool.end();
