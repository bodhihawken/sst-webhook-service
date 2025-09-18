import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Result } from "./utils";
import { Webhook } from "../../core/webhook";

export module WebhookApi {
  export const WebhookSchema = z
    .object(Webhook.Info.shape)
    .openapi("Webhook");

  export const WebhookCreateResultSchema = z
    .union([
      z.object(Webhook.Info.shape),
      z.array(z.object(Webhook.Info.shape))
    ])
    .openapi("WebhookCreateResult");

  export const WebhookListResultSchema = z
    .object({ webhooks: Webhook.Info.array(), cursor: z.string().nullable() })
    .openapi("WebhookListResult");

  export const EventSchema = z
    .object({
      eventId: z.string(),
      tenantId: z.string(),
      eventType: z.string(),
      payload: z.record(z.any()),
      metadata: z.object({
        source: z.string().optional(),
        correlationId: z.string().optional(),
        timestamp: z.string().optional(),
      }).optional(),
      createdAt: z.string().datetime(),
    })
    .openapi("Event");

  export const route = new OpenAPIHono()
    // Webhook CRUD operations
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "post",
        path: "/webhooks",
        description: "Create a new webhook for a tenant",
        request: {
          body: {
            content: {
              "application/json": {
                schema: Webhook.create.schema,
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(WebhookCreateResultSchema),
              },
            },
            description: "Return the created webhook",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("json");
        const result = await Webhook.create(input);
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/webhooks/{webhookId}",
        description: "Get a webhook by ID",
        request: {
          params: z.object({
            webhookId: z.string(),
          }),
        },
        responses: {
          404: {
            content: {
              "application/json": {
                schema: z.object({ error: z.string() }),
              },
            },
            description: "Webhook not found",
          },
          200: {
            content: {
              "application/json": {
                schema: Result(WebhookSchema),
              },
            },
            description: "Return the webhook data",
          },
        },
      }),
      async (c) => {
        const { webhookId } = c.req.valid("param");
        const result = await Webhook.findByIdOrFail({ webhookId });
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/webhooks",
        description: "List webhooks for a tenant",
        request: {
          query: z.object({
            tenantId: z.string(),
            cursor: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
          }),
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(WebhookListResultSchema),
              },
            },
            description: "List of webhooks",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("query");
        const result = await Webhook.findByTenant(input);
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "put",
        path: "/webhooks/{webhookId}",
        description: "Update a webhook",
        request: {
          params: z.object({
            webhookId: z.string(),
          }),
          body: {
            content: {
              "application/json": {
                schema: Webhook.update.schema.omit({ webhookId: true }),
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(WebhookSchema),
              },
            },
            description: "Return the updated webhook",
          },
        },
      }),
      async (c) => {
        const { webhookId } = c.req.valid("param");
        const input = c.req.valid("json");
        const result = await Webhook.update({ webhookId, ...input });
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "delete",
        path: "/webhooks/{webhookId}",
        description: "Delete a webhook",
        request: {
          params: z.object({
            webhookId: z.string(),
          }),
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: z.object({}),
              },
            },
            description: "Webhook deleted successfully",
          },
        },
      }),
      async (c) => {
        const { webhookId } = c.req.valid("param");
        await Webhook.remove({ webhookId });
        return c.json({}, 200);
      }
    )

 
    // Event operations
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "post",
        path: "/events",
        description: "Create and trigger a new event",
        request: {
          body: {
            content: {
              "application/json": {
                schema: Webhook.event.create.schema,
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(EventSchema),
              },
            },
            description: "Return the created event",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("json");
        const result = await Webhook.event.create(input);
        return c.json({ result }, 200);
      }
    )
}
