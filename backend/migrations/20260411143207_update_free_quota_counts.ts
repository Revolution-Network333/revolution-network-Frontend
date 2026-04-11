import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        -- 1. Mise à jour de la table users pour suivre les quotas spécifiques
        ALTER TABLE users 
        DROP COLUMN free_credits_balance,
        ADD COLUMN free_text_jobs_remaining INT NOT NULL DEFAULT 100,
        ADD COLUMN free_code_runs_remaining INT NOT NULL DEFAULT 20,
        ADD COLUMN free_media_jobs_remaining INT NOT NULL DEFAULT 1;

        -- 2. Configuration globale des nouveaux quotas par semaine
        DELETE FROM system_config WHERE \`key\` = 'free_quota_gb_weekly';
        
        INSERT INTO system_config VALUES 
        ('free_quota_text_weekly', '100', 'Nombre de jobs texte gratuits par semaine', NOW(6)),
        ('free_quota_code_weekly', '20', 'Nombre de code runs gratuits par semaine', NOW(6)),
        ('free_quota_media_weekly', '1', 'Nombre de jobs média légers gratuits par semaine', NOW(6))
        ON DUPLICATE KEY UPDATE value = value;
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE users 
        DROP COLUMN free_text_jobs_remaining,
        DROP COLUMN free_code_runs_remaining,
        DROP COLUMN free_media_jobs_remaining,
        ADD COLUMN free_credits_balance DECIMAL(14,8) NOT NULL DEFAULT 3.00000000;
        
        DELETE FROM system_config WHERE \`key\` IN ('free_quota_text_weekly', 'free_quota_code_weekly', 'free_quota_media_weekly');
        INSERT INTO system_config VALUES ('free_quota_gb_weekly', '3', 'Quota gratuit hebdomadaire en GB', NOW(6));
    `);
}
