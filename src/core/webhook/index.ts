import { z } from "zod";
import { webhookEntity } from "./webhook.entity";
import { fn } from "../utils";
import { VisibleError } from "../error";
import { createId } from "@paralleldrive/cuid2";
import crypto from "crypto";
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

// not using Resource directly to avoid errors on fresh project setup
let tableName: string;
let queueUrl: string;
let dlqUrl: string;
try {
  const { Resource } = await import("sst");
  tableName = (Resource as any).WebhookServiceTable.name;
  queueUrl = (Resource as any).WebhookServiceQueue.url;
  dlqUrl = (Resource as any).WebhookServiceDLQ.url;
} catch {
  tableName = "";
  queueUrl = "";
  dlqUrl = "";
}

const sqs = new SQSClient({});

export module Webhook {
  export const Info = z.object({
    webhookId: z.string(),
    tenantId: z.string(),
    url: z.string().url(),
    eventType: z.string(),
    secret: z.string(),
    isActive: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  });
  export type Info = z.infer<typeof Info>;

  export const create = fn(
    z.object({
      tenantId: z.string().min(1).max(100),
      url: z.string().url().max(2048),
      eventType: z.union([z.string(), z.array(z.string())]).transform((val) => Array.isArray(val) ? val : [val]),
      secret: z.string().optional(),
    }),
    async ({ tenantId, url, eventType, secret }) => {
      const eventTypes = eventType; // Already transformed to array by zod
      const webhookSecret = secret || crypto.randomBytes(32).toString("hex");
      
      // Create webhooks for each event type
      const webhooks = await Promise.all(
        eventTypes.map(async (type) => {
          // Check if webhook with same URL and eventType exists for tenant
          const existing = await webhookEntity.query
            .byTenantAndEventType({ tenantId, eventType: type })
            .where(({ url: urlField }, { eq }) => `${eq(urlField, url)}`)
            .go()
            .then((r) => r.data);

          if (existing.length > 0) {
            throw new VisibleError("input", "webhook.already-exists", `Webhook for event type "${type}" and URL "${url}" already exists for tenant`);
          }

          const webhookId = createId();
          const webhook = {
            webhookId,
            tenantId,
            url,
            eventType: type,
            secret: webhookSecret,
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };

          await webhookEntity.create(webhook).go();
          return webhook;
        })
      );

      // Return single webhook if only one was created, otherwise return array
      return eventTypes.length === 1 ? webhooks[0] : webhooks;
    }
  );

   const findById = fn(
    z.object({
      webhookId: z.string(),
    }),
    async ({ webhookId }) => {
      const res = await webhookEntity.query
        .byWebhookId({ webhookId })
        .go()
        .then((r) => r.data);

      return res.at(0);
    }
  );

   const findByIdOrFail = fn(
    findById.schema,
    async ({ webhookId }) => {
      const webhook = await findById({ webhookId });
      if (!webhook) {
        throw new VisibleError("not-found", "webhook.not-found", `Webhook with id "${webhookId}" not found`);
      }
      return webhook;
    }
  );

   const findByTenant = fn(
    z.object({
      tenantId: z.string(),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(100).optional().default(10),
    }),
    async ({ tenantId, cursor, limit }) => {
      const res = await webhookEntity.query
        .byTenant({ tenantId })
        .go({
          cursor,
          count: limit,
        });

      return {
        webhooks: res.data,
        cursor: res.cursor,
      };
    }
  );

  const update = fn(
    z.object({
      webhookId: z.string(),
      url: z.string().url().max(2048).optional(),
      eventType: z.string().min(1).max(100).optional(),
      isActive: z.boolean().optional(),
    }),
    async ({ webhookId, url, eventType, isActive }) => {
      const webhook = await findByIdOrFail({ webhookId });
      
      const updates: any = {};
      if (url !== undefined) updates.url = url;
      if (eventType !== undefined) updates.eventType = eventType;
      if (isActive !== undefined) updates.isActive = isActive;

      if (Object.keys(updates).length === 0) {
        return webhook;
      }

      const updated = await webhookEntity
        .update({ webhookId })
        .set(updates)
        .go()
        .then((r) => r.data);

      return updated;
    }
  );

  export const remove = fn(
    z.object({
      webhookId: z.string(),
    }),
    async ({ webhookId }) => {
      await findByIdOrFail({ webhookId });
      await webhookEntity.delete({ webhookId }).go();
    }
  );

  
  export const get = findById;
  export const delete_ = remove;

  export const failed = fn(
    z.object({
      tenantId: z.string(),
      limit: z.number().min(1).max(100).optional().default(10),
      deleteProcessed: z.boolean().optional().default(false),
    }),
    async ({ tenantId, limit, deleteProcessed }) => {
      if (!dlqUrl) {
        throw new VisibleError("not-found", "dlq.not-configured", "Dead Letter Queue URL not available");
      }

      const failedEvents: Array<{
        messageId: string;
        eventId: string;
        tenantId: string;
        eventType: string;
        payload: Record<string, any>;
        metadata?: any;
        timestamp: string;
        receiptHandle?: string;
        failureReason?: string;
      }> = [];

      // Receive messages from DLQ
      const receiveCommand = new ReceiveMessageCommand({
        QueueUrl: dlqUrl,
        MaxNumberOfMessages: Math.min(limit, 10), // SQS max is 10
        MessageAttributeNames: ["All"],
        WaitTimeSeconds: 1, // Short polling to avoid blocking
      });

      const response = await sqs.send(receiveCommand);
      
      if (!response.Messages || response.Messages.length === 0) {
        return {
          failedEvents: [],
          hasMore: false,
        };
      }

      // Process each message
      for (const message of response.Messages) {
        try {
          if (!message.Body) continue;
          
          const eventData = JSON.parse(message.Body);
          
          // Filter by tenantId
          if (eventData.tenantId === tenantId) {
            failedEvents.push({
              messageId: message.MessageId || "",
              eventId: eventData.eventId,
              tenantId: eventData.tenantId,
              eventType: eventData.eventType,
              payload: eventData.payload,
              metadata: eventData.metadata,
              timestamp: eventData.timestamp,
              receiptHandle: message.ReceiptHandle,
              failureReason: "Max retries exceeded", // SQS moved to DLQ after max retries
            });

            // Optionally delete processed messages from DLQ
            if (deleteProcessed && message.ReceiptHandle) {
              await sqs.send(new DeleteMessageCommand({
                QueueUrl: dlqUrl,
                ReceiptHandle: message.ReceiptHandle,
              }));
            }
          }
        } catch (error) {
          console.error("Error processing DLQ message:", error);
          // Continue processing other messages
        }
      }

      return {
        failedEvents,
        hasMore: response.Messages.length === 10, // If we got max messages, there might be more
      };
    }
  );

  export const list = fn(
    z.object({
      tenantId: z.string(),
      cursor: z.string().optional(),
      limit: z.number().min(1).max(100).optional().default(10),
    }),
    async ({ tenantId, cursor, limit }) => {
      const res = await webhookEntity.query
        .byTenant({ tenantId })
        .go({
          cursor,
          count: limit,
        });

      return {
        webhooks: res.data,
        cursor: res.cursor,
      };
    }
  );



  // Nested event module for SDK compatibility
  export module event {
    export const create = fn(
      z.object({
        tenantId: z.string().min(1).max(100),
        eventType: z.string().min(1).max(100),
        payload: z.record(z.any()),
        metadata: z.object({
          source: z.string().optional(),
          correlationId: z.string().optional(),
          timestamp: z.string().optional(),
        }).optional(),
      }),
      async ({ tenantId, eventType, payload, metadata }) => {
        const eventId = createId();
        const timestamp = new Date().toISOString();
        
        const message = {
          eventId,
          tenantId,
          eventType,
          payload,
          metadata: {
            ...metadata,
            timestamp: metadata?.timestamp || timestamp,
          },
          timestamp,
        };

        // Send message to SQS queue for processing
        if (queueUrl) {
          await sqs.send(new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(message),
            MessageAttributes: {
              eventType: {
                DataType: "String",
                StringValue: eventType,
              },
              tenantId: {
                DataType: "String",
                StringValue: tenantId,
              },
            },
          }));
        }

        return {
          eventId,
          tenantId,
          eventType,
          payload,
          metadata: message.metadata,
          createdAt: timestamp,
        };
      }
    );

    export const retryFailed = fn(
      z.object({
        eventIds: z.array(z.string()).min(1), // Required: specific event IDs to retry
      }),
      async ({ eventIds }) => {
        if (!dlqUrl || !queueUrl) {
          throw new VisibleError("not-found", "queue.not-configured", "Queue URLs not available");
        }

        const retriedEvents: string[] = [];
        const failedRetries: string[] = [];
        const notFoundEvents: string[] = [];

        // We need to search the DLQ for the specific event IDs
        // Since we can't query SQS by message content, we'll need to receive messages
        // and look for our target events
        const maxReceiveAttempts = 10; // Limit how many times we poll the DLQ
        let receiveAttempts = 0;
        const foundEvents = new Map<string, any>();

        // Poll DLQ until we find all requested events or hit our limit
        while (foundEvents.size < eventIds.length && receiveAttempts < maxReceiveAttempts) {
          const receiveCommand = new ReceiveMessageCommand({
            QueueUrl: dlqUrl,
            MaxNumberOfMessages: 10,
            MessageAttributeNames: ["All"],
            WaitTimeSeconds: 1,
          });

          const response = await sqs.send(receiveCommand);
          
          if (!response.Messages || response.Messages.length === 0) {
            break; // No more messages in DLQ
          }

          // Process each message to see if it's one we want to retry
          for (const message of response.Messages) {
            try {
              if (!message.Body) continue;
              
              const eventData = JSON.parse(message.Body);
              
              // Check if this is one of the events we want to retry
              if (eventIds.includes(eventData.eventId)) {
                foundEvents.set(eventData.eventId, {
                  eventData,
                  receiptHandle: message.ReceiptHandle,
                });
              }
            } catch (error) {
              console.error("Error parsing DLQ message:", error);
            }
          }

          receiveAttempts++;
        }

        // Retry each found event
        for (const eventId of eventIds) {
          const foundEvent = foundEvents.get(eventId);
          
          if (!foundEvent) {
            notFoundEvents.push(eventId);
            continue;
          }

          try {
            const { eventData, receiptHandle } = foundEvent;

            // Reconstruct the original message
            const retryMessage = {
              eventId: eventData.eventId,
              tenantId: eventData.tenantId,
              eventType: eventData.eventType,
              payload: eventData.payload,
              metadata: {
                ...eventData.metadata,
                retryAttempt: true,
                originalFailureTime: eventData.timestamp,
              },
              timestamp: new Date().toISOString(),
            };

            // Send back to main queue for retry
            await sqs.send(new SendMessageCommand({
              QueueUrl: queueUrl,
              MessageBody: JSON.stringify(retryMessage),
              MessageAttributes: {
                eventType: {
                  DataType: "String",
                  StringValue: eventData.eventType,
                },
                tenantId: {
                  DataType: "String",
                  StringValue: eventData.tenantId,
                },
                isRetry: {
                  DataType: "String",
                  StringValue: "true",
                },
              },
            }));

            // Remove from DLQ since we're retrying it
            if (receiptHandle) {
              await sqs.send(new DeleteMessageCommand({
                QueueUrl: dlqUrl,
                ReceiptHandle: receiptHandle,
              }));
            }

            retriedEvents.push(eventId);
          } catch (error) {
            console.error(`Failed to retry event ${eventId}:`, error);
            failedRetries.push(eventId);
          }
        }

        return {
          retriedEvents,
          failedRetries,
          notFoundEvents,
          totalProcessed: eventIds.length,
        };
      }
    );

  }

  export const handler = (options: { tenantId: string }) => {
    return async (c: any) => {
      // Extract the path after /webhook/
      const path = c.req.path;
      const method = c.req.method;
      const webhookPath = path.replace(/^.*\/webhook/, "");
      
      // Add tenantId to the request context for API functions
      c.set("tenantId", options.tenantId);
      
      // Handle different webhook operations based on path and method
      try {
        // Parse request body for POST requests
        let body = {};
        if (method === "POST" || method === "PUT" || method === "PATCH") {
          body = await c.req.json().catch(() => ({}));
        }
        
        // Parse query parameters
        const query = c.req.query();
        
        // Route to appropriate webhook operation
        if (webhookPath === "" || webhookPath === "/") {
          if (method === "POST") {
            // Create webhook
            const createData = { ...body, tenantId: options.tenantId } as any;
            const result = await create(createData);
            return c.json(result);
          } else if (method === "GET") {
            // List webhooks
            const result = await list({ 
              tenantId: options.tenantId, 
              cursor: query.cursor,
              limit: query.limit ? parseInt(query.limit) : undefined 
            });
            return c.json(result);
          }
        } else if (webhookPath.startsWith("/") && webhookPath.split("/").length === 2) {
          // Individual webhook operations: /webhookId
          const webhookId = webhookPath.substring(1);
          
          if (method === "GET") {
            // Get webhook
            const result = await get({ webhookId });
            return c.json(result);
          } else if (method === "PUT" || method === "PATCH") {
            // Update webhook
            const result = await update({ ...body, webhookId });
            return c.json(result);
          } else if (method === "DELETE") {
            // Delete webhook
            await remove({ webhookId });
            return c.json({ success: true });
          }
        } else if (webhookPath === "/failed") {
          if (method === "GET") {
            // Get failed events
            const result = await failed({ 
              tenantId: options.tenantId,
              limit: query.limit ? parseInt(query.limit) : undefined,
              deleteProcessed: query.deleteProcessed === "true"
            });
            return c.json(result);
          }
        } else if (webhookPath === "/events") {
          if (method === "POST") {
            // Create event
            const eventData = { ...body, tenantId: options.tenantId } as any;
            const result = await event.create(eventData);
            return c.json(result);
          }
        } else if (webhookPath === "/events/retry") {
          if (method === "POST") {
            // Retry failed events
            const result = await event.retryFailed(body as any);
            return c.json(result);
          }
        }
        
        // If no route matched, return 404
        return c.json({ error: "Not found" }, 404);
        
      } catch (error) {
        console.error("Webhook handler error:", error);
        
        // Handle VisibleError types
        if (error instanceof Error && "type" in error) {
          const visibleError = error as any;
          const statusCode = visibleError.type === "not-found" ? 404 : 
                           visibleError.type === "auth" ? 403 : 400;
          return c.json({ 
            error: visibleError.message,
            code: visibleError.code 
          }, statusCode);
        }
        
        return c.json({ error: "Internal server error" }, 500);
      }
    };
  };
}


