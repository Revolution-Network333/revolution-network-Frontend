class RevolutionAPI {
  constructor(config) {
    if (!config || !config.apiKey) throw new Error('apiKey is required');
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl || 'https://revolution-backend-sal2.onrender.com').replace(/\/$/, '');
    this.timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 30000;
    this.authMode = config.authMode || 'x-api-key';
  }

  async limits() {
    return this.request('GET', '/api/enterprise/v1/limits');
  }

  async createJob(type, params) {
    return this.request('POST', '/api/enterprise/v1/jobs', { type, params: params || {} });
  }

  async listJobs() {
    return this.request('GET', '/api/enterprise/v1/jobs');
  }

  async getJob(id) {
    return this.request('GET', `/api/enterprise/v1/jobs/${encodeURIComponent(String(id))}`);
  }

  async getJobResult(id) {
    return this.request('GET', `/api/enterprise/v1/jobs/${encodeURIComponent(String(id))}/result`);
  }

  async createWebhook(url, options) {
    const body = {
      url,
      events: options && Array.isArray(options.events) ? options.events : undefined,
      secret: options && typeof options.secret === 'string' ? options.secret : undefined,
    };
    return this.request('POST', '/api/enterprise/v1/webhooks', body);
  }

  async listWebhooks() {
    return this.request('GET', '/api/enterprise/v1/webhooks');
  }

  async deleteWebhook(id) {
    return this.request('DELETE', `/api/enterprise/v1/webhooks/${encodeURIComponent(String(id))}`);
  }

  async waitForJob(jobId, options) {
    const timeoutMs = (options && Number.isFinite(options.timeoutMs)) ? options.timeoutMs : 120000;
    const pollIntervalMs = (options && Number.isFinite(options.pollIntervalMs)) ? options.pollIntervalMs : 1000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const r = await this.getJob(jobId);
      const job = r && r.job ? r.job : null;
      if (job && job.status === 'completed') return r;
      if (job && job.status === 'failed') throw new JobFailedError(String(jobId));
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
    throw new JobTimeoutError(String(jobId));
  }

  async request(method, path, body) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.authMode === 'bearer') {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      } else {
        headers['x-api-key'] = this.apiKey;
      }

      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = { error: 'invalid_json', raw: text }; }
      if (!res.ok) throw new ApiError(res.status, json);
      return json;
    } finally {
      clearTimeout(t);
    }
  }
}

class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.message || body.error)) ? String(body.message || body.error) : `HTTP ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

class JobFailedError extends Error {
  constructor(jobId) {
    super(`Job failed: ${jobId}`);
    this.name = 'JobFailedError';
    this.jobId = jobId;
  }
}

class JobTimeoutError extends Error {
  constructor(jobId) {
    super(`Job timeout: ${jobId}`);
    this.name = 'JobTimeoutError';
    this.jobId = jobId;
  }
}

module.exports = {
  RevolutionAPI,
  ApiError,
  JobFailedError,
  JobTimeoutError,
};
