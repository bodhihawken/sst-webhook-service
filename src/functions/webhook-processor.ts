import { SQSEvent, SQSRecord, SQSBatchResponse } from "aws-lambda";
import { webhookEntity } from "../core/webhook/webhook.entity";
import crypto from "crypto";

// Type for webhook delivery message
interface WebhookDeliveryMessage {
  eventId: string;
  tenantId: string;
  eventType: string;
  payload: Record<string, any>;
  metadata?: {
    source?: string;
    correlationId?: string;
    timestamp?: string;
  };
  timestamp: string;
}

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log(`Processing ${event.Records.length} webhook delivery messages`);
  
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      await processWebhookDelivery(record);
    } catch (error) {
      console.error(`Failed to process message ${record.messageId}:`, error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return {
    batchItemFailures,
  };
};

async function processWebhookDelivery(record: SQSRecord): Promise<void> {
  const message: WebhookDeliveryMessage = JSON.parse(record.body);
  
  console.log(`Processing webhook delivery for event ${message.eventId}, type: ${message.eventType}, tenant: ${message.tenantId}`);

  // Find all active webhooks for this event type and tenant (both specific and wildcard)
  const [specificWebhooks, wildcardWebhooks] = await Promise.all([
    webhookEntity.query
      .byTenantAndEventType({ tenantId: message.tenantId, eventType: message.eventType })
      .where(({ isActive }, { eq }) => `${eq(isActive, true)}`)
      .go()
      .then((r) => r.data),
    webhookEntity.query
      .byTenantAndEventType({ tenantId: message.tenantId, eventType: "*" })
      .where(({ isActive }, { eq }) => `${eq(isActive, true)}`)
      .go()
      .then((r) => r.data),
  ]);

  const webhooks = [...specificWebhooks, ...wildcardWebhooks];
  
  if (webhooks.length === 0) {
    console.log(`No active webhooks found for event type ${message.eventType} in tenant ${message.tenantId}`);
    return;
  }

  console.log(`Found ${webhooks.length} webhooks to deliver to`);

  // Process deliveries in parallel
  const deliveryPromises = webhooks.map(webhook => 
    attemptWebhookDelivery(webhook, message)
  );

  const results = await Promise.allSettled(deliveryPromises);
  
  // Log results
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      console.error(`Delivery to webhook ${webhooks[index].webhookId} failed:`, result.reason);
    } else {
      console.log(`Delivery to webhook ${webhooks[index].webhookId} completed`);
    }
  });

  // If any delivery failed, throw an error to trigger SQS retry
  const failedDeliveries = results.filter(result => result.status === "rejected");
  if (failedDeliveries.length > 0) {
    throw new Error(`${failedDeliveries.length} out of ${webhooks.length} webhook deliveries failed`);
  }
}

async function attemptWebhookDelivery(webhook: any, message: WebhookDeliveryMessage): Promise<void> {
  const signature = generateWebhookSignature(webhook.secret, message);
  
  const payload = {
    eventId: message.eventId,
    eventType: message.eventType,
    tenantId: message.tenantId,
    payload: message.payload,
    metadata: message.metadata,
    timestamp: message.timestamp,
  };

  console.log(`Attempting delivery to ${webhook.url} for webhook ${webhook.webhookId}`);

  const response = await fetch(webhook.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Webhook-Signature": signature,
      "X-Event-Type": message.eventType,
      "X-Event-Id": message.eventId,
      "X-Tenant-Id": message.tenantId,
    },
    body: JSON.stringify(payload),
  });

  const responseBody = await response.text();
  const isSuccess = response.status >= 200 && response.status < 300;

  if (!isSuccess) {
    console.error(`Webhook delivery failed for ${webhook.webhookId}:`, {
      status: response.status,
      body: responseBody,
      url: webhook.url,
    });
    
    throw new Error(`Webhook delivery failed with status ${response.status}: ${responseBody}`);
  }

  console.log(`Webhook delivery successful for ${webhook.webhookId}:`, {
    status: response.status,
    url: webhook.url,
  });
}

function generateWebhookSignature(secret: string, message: WebhookDeliveryMessage): string {
  const payload = JSON.stringify({
    eventId: message.eventId,
    eventType: message.eventType,
    tenantId: message.tenantId,
    payload: message.payload,
    metadata: message.metadata,
    timestamp: message.timestamp,
  });

  return crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
}
