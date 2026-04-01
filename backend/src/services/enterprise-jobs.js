const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

class EnterpriseJobsService {
  constructor(db) {
    this.db = db;
    this.timer = null;
    this.batch = parseInt(process.env.ENTERPRISE_WORKERS || '3', 10);
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 1000);
    console.log('💼 Enterprise Jobs service started');
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  async tick() {
    try {
      // Allow dynamic change of workers via env without restart
      const dyn = parseInt(process.env.ENTERPRISE_WORKERS || String(this.batch || 3), 10);
      if (Number.isFinite(dyn) && dyn > 0 && dyn !== this.batch) this.batch = dyn;
      const res = await this.db.query("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT $1", [this.batch]);
      if (res.rows.length === 0) return;
      const jobs = res.rows;
      const runOne = async (job) => {
        const upd = await this.db.query("UPDATE jobs SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND status = 'queued'", [job.id]);
        if (upd.rowCount === 0) return; // already picked by another worker
        const params = job.params_json ? JSON.parse(job.params_json) : {};
        try {
          const out = await this.execute(job.type, params);
          if (this.db.isSQLite) {
            await this.db.query("INSERT OR REPLACE INTO job_results (job_id, result_json, error_text) VALUES ($1, $2, NULL)", [job.id, JSON.stringify(out)]);
          } else {
            await this.db.query(
              "INSERT INTO job_results (job_id, result_json, error_text) VALUES ($1, $2, NULL) ON CONFLICT (job_id) DO UPDATE SET result_json = EXCLUDED.result_json, error_text = EXCLUDED.error_text",
              [job.id, JSON.stringify(out)]
            );
          }
          await this.db.query("UPDATE jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [job.id]);
        } catch (err) {
          if (this.db.isSQLite) {
            await this.db.query("INSERT OR REPLACE INTO job_results (job_id, result_json, error_text) VALUES ($1, NULL, $2)", [job.id, String(err.message || err)]);
          } else {
            await this.db.query(
              "INSERT INTO job_results (job_id, result_json, error_text) VALUES ($1, NULL, $2) ON CONFLICT (job_id) DO UPDATE SET error_text = EXCLUDED.error_text, result_json = NULL",
              [job.id, String(err.message || err)]
            );
          }
          await this.db.query("UPDATE jobs SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [job.id]);
          const cost = this.costFor(job.type, params);
          try {
            const owner = await this.db.query('SELECT user_id FROM jobs WHERE id = $1', [job.id]);
            const userId = owner.rows[0]?.user_id;
            if (userId) {
              await this.db.query('UPDATE enterprise_credits SET credits_balance = credits_balance + $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [cost, userId]);
              await this.db.query('INSERT INTO credit_ledger (user_id, amount, reason, job_id) VALUES ($1, $2, $3, $4)', [userId, cost, 'job_refund', job.id]);
            }
          } catch (_) {}
        }
      };
      await Promise.allSettled(jobs.map(runOne));
    } catch (e) {
      // swallow
    }
  }
  costFor(type, params) {
    switch (type) {
      case 'http_get': return 5;
      case 'content_check': return 20;
      case 'csv_stats': return 30;
      case 'image_svg_generate': return 10; // Compression image
      case 'audio_convert': return 200; // Conversion audio (per minute)
      case 'video_transcode': return 500; // Encodage vidéo (per minute)
      case 'ocr_pdf': return 300; // OCR / PDF
      case 'data_job': return 1000; // Data job
      case 'text_transform': return 5;
      case 'text_generate_template': return 10;
      case 'code_run_js': return 50;
      default: return 0;
    }
  }
  async execute(type, params) {
    switch (type) {
      case 'http_get': return await this.httpGet(params);
      case 'content_check': return await this.contentCheck(params);
      case 'csv_stats': return await this.csvStats(params);
      case 'image_svg_generate': return await this.imageSvgGenerate(params);
      case 'video_transcode': return await this.videoTranscode(params);
      case 'audio_convert': return await this.audioConvert(params);
      case 'text_transform': return await this.textTransform(params);
      case 'text_generate_template': return await this.textGenerateTemplate(params);
      case 'code_run_js': return await this.codeRunJs(params);
      default:
        throw new Error(`Unknown job type: ${type}`);
    }
  }
  httpGet({ url, method = 'GET', timeoutMs = 8000, insecure = false }) {
    return new Promise((resolve, reject) => {
      if (!url) return reject(new Error('Missing url'));
      const mod = url.startsWith('https') ? https : http;
      const start = Date.now();
      const opts = { method, timeout: timeoutMs };
      if (insecure && mod === https) {
        opts.agent = new https.Agent({ rejectUnauthorized: false });
      }
      const req = mod.request(url, opts, (res) => {
        let bytes = 0;
        res.on('data', (chunk) => { bytes += chunk.length; });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            contentLength: bytes,
            elapsedMs: Date.now() - start,
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('Timeout')); });
      req.end();
    });
  }
  async contentCheck({ url, pattern, flags = 'i', timeoutMs = 8000, insecure = false }) {
    if (!url || !pattern) throw new Error('Missing url or pattern');
    const mod = url.startsWith('https') ? https : http;
    const regex = new RegExp(pattern, flags);
    return new Promise((resolve, reject) => {
      const opts = { timeout: timeoutMs };
      if (insecure && mod === https) {
        opts.agent = new https.Agent({ rejectUnauthorized: false });
      }
      const req = mod.get(url, opts, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk.toString('utf8'); if (body.length > 2_000_000) res.destroy(); });
        res.on('end', () => {
          resolve({ matched: regex.test(body), length: body.length, statusCode: res.statusCode });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(new Error('Timeout')); });
    });
  }
  async csvStats({ csvText, url, insecure = false, timeoutMs = 10000 }) {
    let text = csvText;
    if (!text && url) {
      text = await new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const opts = { timeout: timeoutMs };
        if (insecure && mod === https) {
          opts.agent = new https.Agent({ rejectUnauthorized: false });
        }
        const req = mod.get(url, opts, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk.toString('utf8'); if (body.length > 5_000_000) res.destroy(); });
          res.on('end', () => resolve(body));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(new Error('Timeout')); });
      });
    }
    if (!text) throw new Error('No CSV provided');
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(',');
    const rowCount = Math.max(0, lines.length - 1);
    return { columns: headers.length, headers, rows: rowCount };
  }
  ensureDir(p) {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  }
  async downloadToFile(url, dest) {
    const mod = url.startsWith('https') ? https : http;
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const req = mod.get(url, (res) => {
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      });
      req.on('error', reject);
    });
  }
  runCmd(cmd, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
      let out = ''; let err = '';
      p.stdout.on('data', d => out += d.toString());
      p.stderr.on('data', d => err += d.toString());
      p.on('error', reject);
      p.on('close', code => {
        if (code === 0) resolve({ out, err });
        else reject(new Error(err || `exit ${code}`));
      });
    });
  }
  async imageSvgGenerate({ text = 'Hello', width = 800, height = 400, bg = '#0b0f14', color = '#22c55e' }) {
    const dir = path.join(__dirname, '..', '..', 'public', 'jobs');
    this.ensureDir(dir);
    const fileName = `img_${Date.now()}.svg`;
    const filePath = path.join(dir, fileName);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="50%" fill="${color}" font-size="36" font-family="Arial" dominant-baseline="middle" text-anchor="middle">${String(text).slice(0,200)}</text></svg>`;
    fs.writeFileSync(filePath, svg, 'utf8');
    return { url: `/public/jobs/${fileName}`, format: 'svg', size: fs.statSync(filePath).size };
  }
  async videoTranscode({ inputUrl, outputFormat = 'mp4' }) {
    if (!inputUrl) throw new Error('inputUrl required');
    const tmpDir = path.join(__dirname, '..', '..', 'public', 'jobs');
    this.ensureDir(tmpDir);
    const src = path.join(tmpDir, `src_${Date.now()}.input`);
    await this.downloadToFile(inputUrl, src);
    const outFile = path.join(tmpDir, `video_${Date.now()}.${outputFormat}`);
    try {
      await this.runCmd('ffmpeg', ['-y', '-i', src, outFile]);
      return { url: `/public/jobs/${path.basename(outFile)}`, format: outputFormat };
    } catch (e) {
      return { supported: false, reason: 'ffmpeg not available', error: String(e.message || e) };
    } finally {
      try { fs.unlinkSync(src); } catch {}
    }
  }
  async audioConvert({ inputUrl, outputFormat = 'mp3' }) {
    if (!inputUrl) throw new Error('inputUrl required');
    const tmpDir = path.join(__dirname, '..', '..', 'public', 'jobs');
    this.ensureDir(tmpDir);
    const src = path.join(tmpDir, `src_${Date.now()}.input`);
    await this.downloadToFile(inputUrl, src);
    const outFile = path.join(tmpDir, `audio_${Date.now()}.${outputFormat}`);
    try {
      await this.runCmd('ffmpeg', ['-y', '-i', src, outFile]);
      return { url: `/public/jobs/${path.basename(outFile)}`, format: outputFormat };
    } catch (e) {
      return { supported: false, reason: 'ffmpeg not available', error: String(e.message || e) };
    } finally {
      try { fs.unlinkSync(src); } catch {}
    }
  }
  async textTransform({ operation = 'upper', text = '' }) {
    const t = String(text);
    if (operation === 'upper') return { result: t.toUpperCase() };
    if (operation === 'lower') return { result: t.toLowerCase() };
    if (operation === 'reverse') return { result: t.split('').reverse().join('') };
    return { result: t };
  }
  async textGenerateTemplate({ prompt = '' }) {
    const ts = new Date().toISOString();
    return { result: `Generated: ${prompt} | ${ts}` };
  }
  async codeRunJs({ code = '' }) {
    const vm = require('vm');
    const sandbox = { console: { log: () => {} } };
    const script = new vm.Script(String(code));
    const ctx = vm.createContext(sandbox);
    let result = null;
    try {
      result = script.runInContext(ctx, { timeout: 1000 });
    } catch (e) {
      return { error: String(e.message || e) };
    }
    return { result };
  }
}

module.exports = EnterpriseJobsService;
