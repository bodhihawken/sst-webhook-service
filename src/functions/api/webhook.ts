import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Result } from "./utils";
import { Webhook, Listener, Event, Delivery } from "../../core/webhook";

export module WebhookApi {
  export const WebhookSchema = z
    .object(Webhook.Info.shape)
    .openapi("Webhook");
  export const ListenerSchema = z
    .object(Listener.Info.shape)
    .openapi("Listener");
  export const EventSchema = z
    .object(Event.Info.shape)
    .openapi("Event");
  export const DeliverySchema = z
    .object(Delivery.Info.shape)
    .openapi("Delivery");

  export const WebhookListResultSchema = z
    .object({ webhooks: Webhook.Info.array(), cursor: z.string().nullable() })
    .openapi("WebhookListResult");
  export const ListenerListResultSchema = z
    .object({ listeners: Listener.Info.array(), cursor: z.string().nullable() })
    .openapi("ListenerListResult");
  export const EventListResultSchema = z
    .object({ events: Event.Info.array(), cursor: z.string().nullable() })
    .openapi("EventListResult");
  export const DeliveryListResultSchema = z
    .object({ deliveries: Delivery.Info.array(), cursor: z.string().nullable() })
    .openapi("DeliveryListResult");

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
                schema: Result(WebhookSchema),
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
          param: z.object({
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
          param: z.object({
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
          param: z.object({
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

    // Listener CRUD operations
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "post",
        path: "/webhooks/{webhookId}/listeners",
        description: "Create a new event listener for a webhook",
        request: {
          param: z.object({
            webhookId: z.string(),
          }),
          body: {
            content: {
              "application/json": {
                schema: z.object({
                  eventType: z.string().min(1).max(100),
                }),
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(ListenerSchema),
              },
            },
            description: "Return the created listener",
          },
        },
      }),
      async (c) => {
        const { webhookId } = c.req.valid("param");
        const { eventType } = c.req.valid("json");
        const result = await Listener.create({ webhookId, eventType });
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/webhooks/{webhookId}/listeners",
        description: "List listeners for a webhook",
        request: {
          param: z.object({
            webhookId: z.string(),
          }),
          query: z.object({
            cursor: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
          }),
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(ListenerListResultSchema),
              },
            },
            description: "List of listeners",
          },
        },
      }),
      async (c) => {
        const { webhookId } = c.req.valid("param");
        const query = c.req.valid("query");
        const result = await Listener.findByWebhook({ webhookId, ...query });
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "put",
        path: "/listeners/{listenerId}",
        description: "Update a listener (enable/disable)",
        request: {
          param: z.object({
            listenerId: z.string(),
          }),
          body: {
            content: {
              "application/json": {
                schema: z.object({
                  isActive: z.boolean(),
                }),
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(ListenerSchema),
              },
            },
            description: "Return the updated listener",
          },
        },
      }),
      async (c) => {
        const { listenerId } = c.req.valid("param");
        const { isActive } = c.req.valid("json");
        const result = await Listener.update({ listenerId, isActive });
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "delete",
        path: "/listeners/{listenerId}",
        description: "Delete a listener",
        request: {
          param: z.object({
            listenerId: z.string(),
          }),
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: z.object({}),
              },
            },
            description: "Listener deleted successfully",
          },
        },
      }),
      async (c) => {
        const { listenerId } = c.req.valid("param");
        await Listener.remove({ listenerId });
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
                schema: Event.create.schema,
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
        const result = await Event.create(input);
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/events/{eventId}",
        description: "Get an event by ID",
        request: {
          param: z.object({
            eventId: z.string(),
          }),
        },
        responses: {
          404: {
            content: {
              "application/json": {
                schema: z.object({ error: z.string() }),
              },
            },
            description: "Event not found",
          },
          200: {
            content: {
              "application/json": {
                schema: Result(EventSchema),
              },
            },
            description: "Return the event data",
          },
        },
      }),
      async (c) => {
        const { eventId } = c.req.valid("param");
        const result = await Event.findById({ eventId });
        if (!result) {
          return c.json({ error: "Event not found" }, 404);
        }
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/events",
        description: "List events for a tenant",
        request: {
          query: z.object({
            tenantId: z.string(),
            eventType: z.string().optional(),
            cursor: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
          }),
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(EventListResultSchema),
              },
            },
            description: "List of events",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("query");
        const result = await Event.findByTenant(input);
        return c.json({ result }, 200);
      }
    )

    // Delivery operations (read-only for monitoring)
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/events/{eventId}/deliveries",
        description: "List deliveries for an event",
        request: {
          param: z.object({
            eventId: z.string(),
          }),
          query: z.object({
            cursor: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
          }),
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(DeliveryListResultSchema),
              },
            },
            description: "List of deliveries",
          },
        },
      }),
      async (c) => {
        const { eventId } = c.req.valid("param");
        const query = c.req.valid("query");
        const result = await Delivery.findByEvent({ eventId, ...query });
        return c.json({ result }, 200);
      }
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/webhooks/{webhookId}/deliveries",
        description: "List deliveries for a webhook by status",
        request: {
          param: z.object({
            webhookId: z.string(),
          }),
          query: z.object({
            status: z.enum(["pending", "success", "failed", "retrying"]),
            cursor: z.string().optional(),
            limit: z.coerce.number().min(1).max(100).optional(),
          }),
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(DeliveryListResultSchema),
              },
            },
            description: "List of deliveries",
          },
        },
      }),
      async (c) => {
        const { webhookId } = c.req.valid("param");
        const query = c.req.valid("query");
        const result = await Delivery.findByWebhookAndStatus({ webhookId, ...query });
        return c.json({ result }, 200);
      }
    );
}
