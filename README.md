# 🔗 sst-webhook-service

[![NPM version](https://img.shields.io/npm/v/@queuebar/sst-webhook-service.svg)](https://npmjs.org/package/@queuebar/sst-webhook-service) ![npm bundle size](https://img.shields.io/bundlephobia/minzip/@queuebar/sst-webhook-service)

Host your own multi-tenant webhook service on AWS with [SST](https://github.com/sst/sst) and deliver events reliably across tenants!
This is a very basic webhook service built in house for a few projects, PRs are welcome, this is a fork of the sst-url-shortener component.

- 🏢 **Multi-tenant**: Isolate webhooks by tenant ID for secure multi-tenancy
- 🎯 **Event-driven**: Subscribe to specific events or use wildcards (*) for all events
- 🔄 **Reliable delivery**: Automatic retries with exponential backoff
- 📊 **Monitoring**: Track failures and redrive as needed
- 🚀 **Serverless**: Fully within AWS Free Tier, zero upfront cost
- 🔑 **API**: Create listeners to events and trigger events using the API or SDK
- 📚 **OpenAPI docs**: Built-in Swagger UI for easy API exploration

# Pre-requisites

If this is your first time using SST or deploying to AWS, make sure you have the [AWS credentials](https://sst.dev/docs/iam-credentials/) properly setup

# Quickstart

## Standalone SST app

This is for cases when you can't or don't want to integrate the `WebhookService` component into your existing SST app.

- Create a new project:
```bash
mkdir my-webhook-service && cd my-webhook-service
npm init -y
```

- Init SST and install the `WebhookService` component:
```bash
npx sst@latest init
npm install @queuebar/sst-webhook-service
```

- Declare the webhook service component in `sst.config.ts`:
```typescript
/// <reference path="./.sst/platform/config.d.ts" />
import { WebhookService } from "@queuebar/sst-webhook-service";

export default $config({
  app(input) {
    return {
      name: "webhook-service",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
    };
  },
  async run() {
    const webhookService = new WebhookService({})

    return {
      api: webhookService.api.url,
    }
  },
});
```

- Deploy the app to your personal stage via SST dev mode:
```bash
npx sst dev
```

Notice that our app once deployed returns a URL of an API endpoint.
By default the API doesn't require authentication and has Swagger UI enabled.
We can visit `{api}/ui` to access the swagger UI and test our API.

## Add as a component to an existing SST app

Install the component:
```bash
npm install @queuebar/sst-webhook-service
```

Modify `sst.config.ts` to include the component:
```typescript
import { WebhookService } from "@queuebar/sst-webhook-service";

async run() {
  // ...your existing components
  const webhookService = new WebhookService({});

  // link webhook service to another component e.g. a lambda function
  const example = new sst.aws.Function("Example", {
    link: [...webhookService.link],
    handler: "example.handler",
    url: true,
  })
}
```

Inside the `example.ts` Lambda handler:
```typescript
import { Webhook } from "@queuebar/sst-webhook-service"

export const handler = async () => {
  // Create a webhook that listens for specific events
  const webhook = await Webhook.create({
    tenantId: "tenant-123",
    url: "https://example.com/webhook",
    eventType: ["user.created"] // or "*" for all events.
  })
  console.log("new webhook", webhook)

  // Trigger an event that will be delivered to subscribed webhooks
  const event = await Webhook.event.create({
    tenantId: "tenant-123",
    eventType: "user.created",
    payload: {
      userId: "user-456",
      email: "user@example.com"
    }
  })

// List all webhooks for a tenant
const { webhooks: tenantWebhooks } = await Webhook.list({
  tenantId: "tenant-123"
})

// Get a specific webhook
const webhook = await Webhook.get({ webhookId: "webhook-123" })

// Get failed events from Dead Letter Queue for a tenant
const { failedEvents, hasMore } = await Webhook.failed({
  tenantId: "tenant-123",
  limit: 20,
  deleteProcessed: false // Set to true to remove from DLQ after reading
})

// Retry specific failed events (moves them back to main queue)
const retryResult = await Webhook.event.retryFailed({
  eventIds: ["event-123", "event-456"] // Required: specific event IDs to retry
})

// Delete a webhook
await Webhook.remove({ webhookId: "webhook-123" })
```

# Hono Usage

For those using hono you can automatically handle all webhook related routes with the `Webhook.handler` function and
handle auth and tenant isolation yourself.

```typescript
import { Hono } from "hono"
import { Webhook } from "@queuebar/sst-webhook-service"

const app = new Hono()
```

```typescript
//do auth here like app.use(epicAuth())
app.on(["POST", "GET", "PUT", "PATCH", "DELETE"], "/webhook/*", 
  Webhook.handler({ tenantId: "tenant-123" })
);
```

## Supported Routes

The handler automatically supports the following routes:

```bash
# Webhook management
POST   /webhook/           # Create webhook
GET    /webhook/           # List webhooks  
GET    /webhook/{id}       # Get specific webhook
PUT    /webhook/{id}       # Update webhook
DELETE /webhook/{id}       # Delete webhook

# Event management
POST   /webhook/events     # Create event
GET    /webhook/failed     # Get failed events
POST   /webhook/events/retry # Retry failed events
```

## Advanced Authentication

Extract tenant ID from JWT or other auth middleware:

```typescript
import { jwt } from "hono/jwt"

app.use("/webhook/*", jwt({ secret: "your-secret" }))

app.on(["POST", "GET", "PUT", "PATCH", "DELETE"], "/webhook/*", async (c) => {
  const payload = c.get("jwtPayload")
  const tenantId = payload.tenantId
  
  return Webhook.handler({ tenantId })(c)
})
```

## Example Usage

```typescript
// Create a webhook via the handler
const response = await app.request('/webhook/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://example.com/webhook',
    eventType: ['user.created', 'user.updated']
  })
})

// Trigger an event
await app.request('/webhook/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    eventType: 'user.created',
    payload: { userId: '123', email: 'user@example.com' }
  })
})
```

# API Usage

## Core Concepts

### Tenants
All webhooks are scoped to a `tenantId`.

### Webhooks
Webhooks are HTTP endpoints that receive event notifications. Each webhook belongs to a tenant and has:
- A unique URL to receive events
- A secret for HMAC signature verification
- Event type(s) it listens to (specific types or "*" for all events)

### Queue-based Processing
Events are processed asynchronously through SQS queues:
- **Main Queue**: Processes webhook deliveries with automatic retries (3 attempts)
- **Dead Letter Queue (DLQ)**: Stores failed events after max retries for analysis and manual retry
- **Batch Processing**: Multiple events can be processed in parallel for better performance
- **Failed Event Recovery**: Use `Webhook.failed()` to inspect DLQ and `Webhook.event.retryFailed()` to reprocess

### Events
Events are lightweight messages sent to the queue for processing. They contain:
- Event type and payload
- Tenant isolation
- Metadata for tracing
- No persistent storage (processed through queues only)

## API Endpoints

### Webhooks

```bash
# Create a webhook
POST /api/webhooks
{
  "tenantId": "tenant-123",
  "name": "My Webhook",
  "url": "https://example.com/webhook",
  "secret": "optional-custom-secret"
}

# List webhooks for a tenant
GET /api/webhooks?tenantId=tenant-123

# Get a specific webhook
GET /api/webhooks/{webhookId}

# Update a webhook
PUT /api/webhooks/{webhookId}
{
  "name": "Updated Webhook",
  "isActive": false
}

# Delete a webhook
DELETE /api/webhooks/{webhookId}
```

### Listeners

```bash
# Create a listener for a specific event
POST /api/webhooks/{webhookId}/listeners
{
  "eventType": "user.created"
}

# Create a listener for all events
POST /api/webhooks/{webhookId}/listeners
{
  "eventType": "*"
}

# List listeners for a webhook
GET /api/webhooks/{webhookId}/listeners

# Update a listener
PUT /api/listeners/{listenerId}
{
  "isActive": false
}

# Delete a listener
DELETE /api/listeners/{listenerId}
```

### Events

```bash
# Create and trigger an event
POST /api/events
{
  "tenantId": "tenant-123",
  "eventType": "user.created",
  "payload": {
    "userId": "user-456",
    "email": "user@example.com"
  },
  "metadata": {
    "source": "user-service",
    "correlationId": "req-789"
  }
}

# List events for a tenant
GET /api/events?tenantId=tenant-123&eventType=user.created

# Get a specific event
GET /api/events/{eventId}
```

## Webhook Payload Format

When your webhook endpoint receives an event, it will include these headers:

```
Content-Type: application/json
X-Webhook-Signature: <hmac-sha256-signature>
X-Event-Type: user.created
X-Event-Id: evt_123
X-Tenant-Id: tenant-123
```

The payload will be:

```json
{
  "eventId": "evt_123",
  "eventType": "user.created",
  "tenantId": "tenant-123",
  "payload": {
    "userId": "user-456",
    "email": "user@example.com"
  },
  "metadata": {
    "source": "user-service",
    "correlationId": "req-789",
    "timestamp": "2023-12-01T10:00:00Z"
  },
  "timestamp": "2023-12-01T10:00:00Z"
}
```

## Signature Verification

Verify webhook authenticity by checking the HMAC-SHA256 signature:

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  
  return signature === expectedSignature;
}

// In your webhook handler
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature'];
  const payload = JSON.stringify(req.body);
  const secret = 'your-webhook-secret';
  
  if (!verifySignature(payload, signature, secret)) {
    return res.status(401).send('Invalid signature');
  }
  
  // Process the event
  console.log('Received event:', req.body);
  res.status(200).send('OK');
});
```

# Component Configuration

## Authentication

API bearer authentication is disabled by default and can be enabled via setting `enableApiAuth` to `true` on the component.

```typescript
const webhookService = new WebhookService({
  enableApiAuth: true,
})
```

The Bearer token can be set via `WebhookServiceApiAuthKey` SST [Secret](https://sst.dev/docs/component/secret/) and defaults to `your_secret`

```bash
# set the secret
npx sst secret set WebhookServiceApiAuthKey "YOUR_TOKEN"
```

## Swagger UI

Swagger UI is enabled by default and can be disabled via settings `enableOpenApiDocs` to `false` on the component.

```typescript
const webhookService = new WebhookService({
  enableOpenApiDocs: false,
})
```

# Features

## Retry Logic

Failed webhook deliveries are automatically retried by SQS with the following defaults:

- **3 retry attempts** before moving to Dead Letter Queue
- **Exponential backoff** handled by SQS redrive policy
- **Visibility timeout**: 30 seconds per attempt

To customize retry behavior, configure the SQS queue settings in your `sst.config.ts`:

```typescript
const webhookService = new WebhookService({
  transform: {
    queue: (args) => {
      // Customize main queue settings
      args.dlq = {
        queue: deadLetterQueue.arn,
        retry: 5, // Increase retry attempts to 5
      }
      args.visibilityTimeout = "60 seconds" // Increase timeout
    },
    dlq: (args) => {
      // Customize dead letter queue settings
      args.visibilityTimeout = "300 seconds" // 5 minutes for manual processing
    }
  }
})
```