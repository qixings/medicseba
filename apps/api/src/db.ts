import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import 'dotenv/config';
import * as schema from './schema.js';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const db = drizzle(pool, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export { schema };
