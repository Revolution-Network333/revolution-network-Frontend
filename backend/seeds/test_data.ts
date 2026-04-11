import { Knex } from "knex";
import crypto from "crypto";
import argon2 from "argon2";

export async function seed(knex: Knex): Promise<void> {
  // On ne vide pas system_config et job_types car ils sont gérés par la migration
  
  // 1. Créer un utilisateur de test (korn666)
  const userId = crypto.randomUUID();
  const rawApiKey = `rev_${crypto.randomBytes(24).toString('hex')}`;
  const apiKeyHash = await argon2.hash(rawApiKey);
  const apiKeyPrefix = rawApiKey.slice(0, 12);

  await knex("users").insert({
    id: userId,
    email: "admin@revolution.network",
    api_key_hash: apiKeyHash,
    api_key_prefix: apiKeyPrefix,
    credits_balance: 100.00000000,
    is_active: 1
  }).onConflict('email').ignore();

  // 2. Créer un node de test
  const nodeId = crypto.randomUUID();
  await knex("nodes").insert({
    id: nodeId,
    operator_email: "operator1@nodes.io",
    node_type: "ffmpeg",
    wallet_balance: 0,
    reputation_score: 100,
    is_active: 1,
    endpoint_url: "http://localhost:4000",
    total_jobs_completed: 0,
    total_jobs_failed: 0
  }).onConflict('id').ignore();

  console.log('--- TEST DATA GENERATED ---');
  console.log(`User ID: ${userId}`);
  console.log(`API Key: ${rawApiKey}`);
  console.log(`Node ID: ${nodeId}`);
  console.log('---------------------------');
}
