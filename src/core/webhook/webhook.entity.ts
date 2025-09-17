import { Entity } from "electrodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient();
let table: string
try {
  const { Resource } = await import("sst");
  table = (Resource as any).WebhookServiceTable.name;
} catch {
  table = ""
}

export const webhookEntity = new Entity(
  {
    model: {
      entity: "webhook",
      version: "1",
      service: "webhookService",
    },
    attributes: {
      webhookId: {
        type: "string",
        required: true,
      },
      tenantId: {
        type: "string",
        required: true,
      },
      url: {
        type: "string",
        required: true,
      },
      eventType: {
        type: "string",
        required: true, // "*" for all events or specific event type
      },
      secret: {
        type: "string",
        required: true,
      },
      isActive: {
        type: "boolean",
        required: true,
        default: true,
      },
      createdAt: {
        type: "string",
        required: true,
        default: () => new Date().toISOString(),
      },
      updatedAt: {
        type: "string",
        required: true,
        default: () => new Date().toISOString(),
        set: () => new Date().toISOString(),
      },
    },
    indexes: {
      byWebhookId: {
        pk: {
          field: "pk",
          composite: ["webhookId"],
        },
        sk: {
          field: "sk",
          composite: ["webhookId"],
        },
      },
      byTenant: {
        index: "gsi1pk-gsi1sk-index",
        pk: {
          field: "gsi1pk",
          composite: ["tenantId"],
        },
        sk: {
          field: "gsi1sk",
          composite: ["webhookId"],
        },
      },
      byTenantAndEventType: {
        index: "gsi2pk-gsi2sk-index",
        pk: {
          field: "gsi2pk",
          composite: ["tenantId", "eventType"],
        },
        sk: {
          field: "gsi2sk",
          composite: ["webhookId"],
        },
      },
    },
  },
  { client, table },
);



