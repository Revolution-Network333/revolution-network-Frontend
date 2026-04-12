# Revolution Network — API Integration Guide

This repository contains the Revolution Network platform.

This README is intended to provide **only** the information required for developers to integrate with the API (authentication, endpoints, webhooks, SDK).

Copyright (c) Revolution Network. **All rights reserved.**

---

## API Overview

### Base URL

- Local: `http://localhost:3000/api/enterprise`
- Production: `https://revolution-backend-sal2.onrender.com/api/enterprise`

### OpenAPI / Swagger

- OpenAPI JSON: `GET /openapi.json`
- Swagger UI: `GET /docs`

### Authentication

There are 2 authentication layers:

#### 1) User session (JWT) for account endpoints

Use `Authorization: Bearer <token>` for:

- `GET /api/enterprise/me`
- `POST /api/enterprise/api-key` (regenerate and reveal the full key for copy)

Example:

```bash
curl -s "http://localhost:3000/api/enterprise/me" \
  -H "Authorization: Bearer $TOKEN"
```

To generate/copy your API key:

```bash
curl -s -X POST "http://localhost:3000/api/enterprise/api-key" \
  -H "Authorization: Bearer $TOKEN"
```

This returns `fullKey` once so you can store it securely.

#### 2) API key for /v1 endpoints

Use either header for all `/api/enterprise/v1/*` endpoints:

- `x-api-key: <your_api_key>`
- `Authorization: Bearer <your_api_key>`

Example:

```bash
curl -s -X POST "http://localhost:3000/api/enterprise/v1/jobs" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ENTERPRISE_API_KEY" \
  -d '{"type":"ping","params":{}}'
```

### Free tier limits

When you do not have an active subscription (Free tier):

- **3 GB compute / week** (auto-reset at the start of each week)
- **Max 0.2 GB per job**
- **30 requests / minute**
- **Video jobs disabled** (`type = video_transcode`)

You can query limits programmatically:

- `GET /api/enterprise/v1/limits`

### Main endpoints

- `POST /api/enterprise/v1/jobs`
  - Body: `{ "type": "ping", "params": { ... } }`
- `GET /api/enterprise/v1/jobs`
- `GET /api/enterprise/v1/jobs/:id`
- `GET /api/enterprise/v1/jobs/:id/result`

---

## Webhooks (job status notifications)

Webhooks are managed via API key auth on `/api/enterprise/v1/webhooks`.

### Endpoints

- `GET /api/enterprise/v1/webhooks`
- `POST /api/enterprise/v1/webhooks`
- `DELETE /api/enterprise/v1/webhooks/:id`

### Events

- `job.completed`
- `job.failed`

### Delivery & signature

Webhook POST requests include:

- `X-Revolution-Event`
- `X-Revolution-Timestamp`
- `X-Revolution-Signature`

The signature is an HMAC computed with your webhook `secret` (returned **only on creation**). You should:

- validate the signature
- reject timestamps that are too old

---

## Node.js SDK

An npm SDK is available in this repository under `revolution-sdk`.

### Features

- Create / list / get jobs
- Fetch limits
- Manage webhooks

### Example

```js
const { RevolutionAPI } = require('revolution-sdk');

const api = new RevolutionAPI({
  apiKey: process.env.REVOLUTION_API_KEY,
  baseUrl: 'https://revolution-backend-sal2.onrender.com',
  authMode: 'x-api-key'
});

async function main() {
  const job = await api.createJob('http_get', { url: 'https://example.com' });
  console.log('job', job);
}

main();
```

---

## Support

- Discord: https://discord.gg/eadE7uK6ss
