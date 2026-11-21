import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db, pool } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
await migrate(db, { migrationsFolder: path.resolve(here, '../drizzle') });
console.log('Migrations applied');
await pool.end();
