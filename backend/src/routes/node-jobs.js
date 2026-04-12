const express = require('express');
const db = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

function nowPlusSecondsIso(seconds) {
  const d = new Date(Date.now() + seconds * 1000);
  return d.toISOString();
}

async function assertSessionOwnership(userId, sessionId) {
  if (!sessionId) throw new Error('sessionId required');
  const r = await db.query('SELECT id, user_id FROM sessions WHERE id = $1', [sessionId]);
  if (r.rows.length === 0) throw new Error('session_not_found');
  if (Number(r.rows[0].user_id) !== Number(userId)) throw new Error('forbidden');
}

// Worker polls for a job. Uses existing JWT auth + sessionId.
router.post('/v1/jobs/poll', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { sessionId, capabilities } = req.body || {};
    await assertSessionOwnership(userId, sessionId);

    const leaseSecs = 120;

    // Release expired leases (best-effort)
    try {
      if (db.isSQLite) {
        await db.query(
          "UPDATE jobs SET status = 'queued_node', worker_user_id = NULL, worker_session_id = NULL, assigned_at = NULL, lease_expires_at = NULL, worker_meta_json = NULL WHERE status = 'running_node' AND lease_expires_at IS NOT NULL AND lease_expires_at < datetime('now')"
        );
      } else if (db.isMySQL) {
        await db.query(
          "UPDATE jobs SET status = 'queued_node', worker_user_id = NULL, worker_session_id = NULL, assigned_at = NULL, lease_expires_at = NULL, worker_meta_json = NULL WHERE status = 'running_node' AND lease_expires_at IS NOT NULL AND lease_expires_at < NOW()"
        );
      } else {
        await db.query(
          "UPDATE jobs SET status = 'queued_node', worker_user_id = NULL, worker_session_id = NULL, assigned_at = NULL, lease_expires_at = NULL, worker_meta_json = NULL WHERE status = 'running_node' AND lease_expires_at IS NOT NULL AND lease_expires_at < CURRENT_TIMESTAMP"
        );
      }
    } catch (_) {}

    let jobRow = null;

    // Assign one job atomically-ish depending on DB
    if (db.isSQLite) {
      const upd = await db.query(
        `UPDATE jobs
         SET status = 'running_node',
             worker_user_id = $1,
             worker_session_id = $2,
             assigned_at = datetime('now'),
             lease_expires_at = datetime('now', '+${leaseSecs} seconds'),
             worker_meta_json = $3,
             updated_at = datetime('now')
         WHERE id = (
           SELECT id FROM jobs
           WHERE status = 'queued_node'
             AND (lease_expires_at IS NULL OR lease_expires_at < datetime('now'))
           ORDER BY created_at ASC
           LIMIT 1
         )
         RETURNING id, user_id, type, params_json` ,
        [userId, sessionId, JSON.stringify({ capabilities: capabilities || null })]
      );
      jobRow = upd.rows && upd.rows[0] ? upd.rows[0] : null;
    } else if (db.isMySQL) {
      // MySQL doesn't support RETURNING reliably in older versions; select then conditional update.
      const cand = await db.query(
        `SELECT id, user_id, type, params_json
         FROM jobs
         WHERE status = 'queued_node'
           AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
         ORDER BY created_at ASC
         LIMIT 1`
      );
      const row = cand.rows[0];
      if (row) {
        const u = await db.query(
          `UPDATE jobs
           SET status = 'running_node', worker_user_id = $1, worker_session_id = $2,
               assigned_at = NOW(), lease_expires_at = DATE_ADD(NOW(), INTERVAL ${leaseSecs} SECOND),
               worker_meta_json = $3, updated_at = NOW()
           WHERE id = $4 AND status = 'queued_node'`,
          [userId, sessionId, JSON.stringify({ capabilities: capabilities || null }), row.id]
        );
        if (u.affectedRows > 0 || u.rowCount > 0) jobRow = row;
      }
    } else {
      const cand = await db.query(
        `SELECT id, user_id, type, params_json
         FROM jobs
         WHERE status = 'queued_node'
           AND (lease_expires_at IS NULL OR lease_expires_at < CURRENT_TIMESTAMP)
         ORDER BY created_at ASC
         LIMIT 1`
      );
      const row = cand.rows[0];
      if (row) {
        const u = await db.query(
          `UPDATE jobs
           SET status = 'running_node', worker_user_id = $1, worker_session_id = $2,
               assigned_at = CURRENT_TIMESTAMP, lease_expires_at = CURRENT_TIMESTAMP + INTERVAL '120 seconds',
               worker_meta_json = $3, updated_at = CURRENT_TIMESTAMP
           WHERE id = $4 AND status = 'queued_node'`,
          [userId, sessionId, JSON.stringify({ capabilities: capabilities || null }), row.id]
        );
        if (u.rowCount > 0) jobRow = row;
      }
    }

    if (!jobRow) return res.json({ job: null });

    const params = jobRow.params_json ? JSON.parse(jobRow.params_json) : {};
    return res.json({
      job: {
        id: jobRow.id,
        type: jobRow.type,
        params,
        lease_expires_at: nowPlusSecondsIso(leaseSecs),
      }
    });
  } catch (e) {
    const msg = String(e.message || e);
    if (msg === 'forbidden') return res.status(403).json({ error: 'forbidden' });
    if (msg === 'session_not_found') return res.status(404).json({ error: 'session_not_found' });
    return res.status(500).json({ error: 'server_error' });
  }
});

// Worker submits result
router.post('/v1/jobs/:id/complete', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const jobId = parseInt(req.params.id);
    const { sessionId, result, error } = req.body || {};
    await assertSessionOwnership(userId, sessionId);

    const job = await db.query(
      `SELECT id, user_id, status, worker_user_id, worker_session_id, type
       FROM jobs WHERE id = $1`,
      [jobId]
    );
    if (job.rows.length === 0) return res.status(404).json({ error: 'not_found' });

    const jr = job.rows[0];
    if (String(jr.status) !== 'running_node') return res.status(409).json({ error: 'not_running' });
    if (Number(jr.worker_user_id) !== Number(userId) || Number(jr.worker_session_id) !== Number(sessionId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const isOk = !error;
    const newStatus = isOk ? 'completed' : 'failed';

    if (db.isSQLite) {
      await db.query(
        `UPDATE jobs
         SET status = $1, updated_at = datetime('now')
         WHERE id = $2`,
        [newStatus, jobId]
      );
      await db.query(
        `INSERT OR REPLACE INTO job_results (job_id, result_json, error_text)
         VALUES ($1, $2, $3)`,
        [jobId, isOk ? JSON.stringify(result ?? null) : null, isOk ? null : String(error)]
      );
    } else {
      await db.query(
        `UPDATE jobs SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [newStatus, jobId]
      );
      await db.query(
        `INSERT INTO job_results (job_id, result_json, error_text)
         VALUES ($1, $2, $3)
         ON CONFLICT (job_id) DO UPDATE SET result_json = EXCLUDED.result_json, error_text = EXCLUDED.error_text`,
        [jobId, isOk ? JSON.stringify(result ?? null) : null, isOk ? null : String(error)]
      );
    }

    return res.json({ success: true, status: newStatus });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
