// src/db/client.ts 
import knex, { Knex } from 'knex'; 
 
export const db = knex({ 
  client: 'mysql2', 
  connection: { 
    host:     process.env.DB_HOST     ?? 'localhost', 
    port:     parseInt(process.env.DB_PORT ?? '3306'), 
    user:     process.env.DB_USER     ?? 'root', 
    password: process.env.DB_PASSWORD ?? '', 
    database: process.env.DB_NAME     ?? 'revolution', 
    timezone: '+00:00',    // toujours UTC 
    charset:  'utf8mb4', 
  }, 
  pool: { min: 2, max: 20 }, 
  acquireConnectionTimeout: 10_000, 
}); 
 
export type { Knex }; 
