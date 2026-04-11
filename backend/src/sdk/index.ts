// Package npm : revolution-sdk 
// src/sdk/index.ts 
  
type JobType = 'video_transcode' | 'audio_convert' | 'code_run_js' | 'svg_generate' | 'text_generate'; 
  
interface JobCreatedResponse { 
  job_id:       string; 
  status:       'pending'; 
  type:         JobType; 
  credits_used: number; 
  created_at:   string; 
} 
  
interface JobStatusResponse { 
  job_id:        string; 
  status:        'pending' | 'processing' | 'completed' | 'failed'; 
  type:          JobType; 
  output?:       Record<string, unknown>; 
  credits_used:  number; 
  created_at:    string; 
  completed_at?: string; 
  error_message?: string; 
} 
  
export class RevolutionAPI { 
  private apiKey:  string; 
  private baseUrl: string; 
  private timeout: number; 
  
  constructor(config: { 
    apiKey:   string; 
    baseUrl?: string; 
    timeout?: number; 
  }) { 
    this.apiKey  = config.apiKey; 
    this.baseUrl = config.baseUrl ?? 'https://api.revolution.run'; 
    this.timeout = config.timeout ?? 30_000; 
  } 
  
  async job(type: JobType, params: Record<string, unknown>): Promise<JobCreatedResponse> { 
    return this.request('POST', '/v1/job', { type, ...params }); 
  } 
  
  async waitForJob( 
    jobId: string, 
    options: { timeoutMs?: number; pollIntervalMs?: number } = {} 
  ): Promise<JobStatusResponse> { 
    const deadline    = Date.now() + (options.timeoutMs ?? 120_000); 
    let   interval    = options.pollIntervalMs ?? 1_000; 
    const maxInterval = 10_000; 
  
    while (Date.now() < deadline) { 
      const job = await this.request<JobStatusResponse>('GET', `/v1/job/${jobId}`); 
  
      if (job.status === 'completed') return job; 
      if (job.status === 'failed')    throw new JobFailedError(jobId, job.error_message); 
  
      await new Promise(resolve => setTimeout(resolve, interval)); 
      interval = Math.min(Math.floor(interval * 1.5), maxInterval); 
    } 
  
    throw new JobTimeoutError(jobId); 
  } 
  
  async credits(): Promise<{ balance: number; currency: string }> { 
    return this.request('GET', '/v1/me/credits'); 
  } 
  
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> { 
    const controller = new AbortController(); 
    const timeoutId  = setTimeout(() => controller.abort(), this.timeout); 
  
    try { 
      const res = await fetch(`${this.baseUrl}${path}`, { 
        method, 
        headers: { 
          'X-API-Key':    this.apiKey, 
          'Content-Type': 'application/json', 
          'X-SDK-Version':'1.0.0', 
        }, 
        body:   body ? JSON.stringify(body) : undefined, 
        signal: controller.signal, 
      }); 
  
      const data = await res.json() as Record<string, unknown>; 
      if (!res.ok) this.throwApiError(res.status, data); 
      return data as T; 
    } finally { 
      clearTimeout(timeoutId); 
    } 
  } 
  
  private throwApiError(status: number, data: Record<string, unknown>): never { 
    switch (status) { 
      case 401: throw new InvalidApiKeyError(); 
      case 402: throw new InsufficientCreditsError(data.balance as number, data.required as number); 
      case 400: throw new ValidationError(data.details); 
      case 404: throw new JobNotFoundError(); 
      case 403: throw new AccessDeniedError(); 
      case 503: throw new ServiceUnavailableError(data.retry_after as number); 
      default:  throw new ApiError(status, data.error as string, data.request_id as string); 
    } 
  } 
} 
  
// Exports des erreurs typées 
export class InvalidApiKeyError      extends Error { constructor() { super('Invalid API key'); } } 
export class InsufficientCreditsError extends Error { 
  constructor(public balance: number, public required: number) { 
    super(`Insufficient credits: have ${balance}, need ${required}`); 
  } 
} 
export class JobFailedError extends Error { 
  constructor(public jobId: string, public reason?: string) { 
    super(`Job ${jobId} failed: ${reason ?? 'unknown reason'}`); 
  } 
} 
export class JobTimeoutError extends Error { 
  constructor(public jobId: string) { super(`Job ${jobId} timed out`); } 
} 
export class ServiceUnavailableError extends Error { 
  constructor(public retryAfter?: number) { 
    super(`Service unavailable. Retry after ${retryAfter ?? 60}s`); 
  } 
} 
export class ValidationError  extends Error { constructor(public details: unknown) { super('Validation error'); } } 
export class JobNotFoundError  extends Error { constructor() { super('Job not found'); } } 
export class AccessDeniedError extends Error { constructor() { super('Access denied'); } } 
export class ApiError          extends Error { 
  constructor(public status: number, message: string, public requestId?: string) { super(message); } 
} 
