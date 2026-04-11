export type AuthMode = 'x-api-key' | 'bearer';

export type JobType =
  | 'http_get'
  | 'http_post'
  | 'ping'
  | 'dns_lookup'
  | 'content_check'
  | 'csv_stats'
  | 'image_svg_generate'
  | 'audio_convert'
  | 'video_transcode'
  | 'text_transform'
  | 'text_generate_template'
  | 'code_run_js'
  | 'ocr_pdf'
  | 'data_job';

export interface RevolutionApiConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  authMode?: AuthMode;
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  [k: string]: unknown;
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody | null;
  constructor(status: number, body: ApiErrorBody | null);
}

export class JobFailedError extends Error {
  jobId: string;
  constructor(jobId: string);
}

export class JobTimeoutError extends Error {
  jobId: string;
  constructor(jobId: string);
}

export interface CreateJobResponse {
  id: number;
  status: string;
}

export interface JobRecord {
  id: number;
  type: string;
  status: string;
  created_at?: string;
  updated_at?: string;
  params_json?: string;
}

export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  active?: boolean;
  createdAt?: string;
}

export class RevolutionAPI {
  constructor(config: RevolutionApiConfig);

  limits(): Promise<any>;
  createJob(type: JobType, params?: Record<string, unknown>): Promise<CreateJobResponse>;
  listJobs(): Promise<any>;
  getJob(id: string | number): Promise<{ job: JobRecord } | any>;
  getJobResult(id: string | number): Promise<any>;

  createWebhook(url: string, options?: { events?: string[]; secret?: string }): Promise<{ id: string; url: string; events: string[]; secret: string } | any>;
  listWebhooks(): Promise<{ webhooks: WebhookRecord[] } | any>;
  deleteWebhook(id: string): Promise<{ ok: true } | any>;

  waitForJob(jobId: string | number, options?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<any>;
}
