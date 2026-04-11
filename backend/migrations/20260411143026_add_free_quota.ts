import { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
    await knex.raw(`
        -- 1. Ajout des colonnes pour le quota gratuit
        ALTER TABLE users 
        ADD COLUMN free_credits_balance DECIMAL(14,8) NOT NULL DEFAULT 3.00000000,
        ADD COLUMN free_credits_last_reset DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);

        -- 2. Configuration globale du quota (Single Source of Truth)
        INSERT INTO system_config VALUES 
        ('free_quota_gb_weekly', '3', 'Quota gratuit hebdomadaire en GB', NOW(6))
        ON DUPLICATE KEY UPDATE value = '3';
    `);
}

export async function down(knex: Knex): Promise<void> {
    await knex.raw(`
        ALTER TABLE users 
        DROP COLUMN free_credits_balance,
        DROP COLUMN free_credits_last_reset;
        
        DELETE FROM system_config WHERE \`key\` = 'free_quota_gb_weekly';
    `);
}
