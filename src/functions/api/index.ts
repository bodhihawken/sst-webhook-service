import { OpenAPIHono } from "@hono/zod-openapi";
import { logger } from "hono/logger";
import { handle } from "hono/aws-lambda";
import { ZodError } from "zod";
import { swaggerUI } from "@hono/swagger-ui";
import { VisibleError } from "../../core/error";
import { WebhookApi } from "./webhook";
import type { StatusCode } from "hono/utils/http-status";
import { bearerAuth } from 'hono/bearer-auth'
import { Resource } from "sst";
import { HTTPException } from "hono/http-exception";

const isAuthEnabled = Resource.WebhookServiceApiAuthEnabled.value === "true"
const areOpenApiDocsEnabled = Resource.WebhookServiceOpenApiDocsEnabled.value === "true"
const token = Resource.WebhookServiceApiAuthKey?.value

if (isAuthEnabled && !token?.length) {
  throw new Error("Bearer auth is enabled but no token provided. Please set WebhookServiceApiAuthKey secret.")
}

const app = new OpenAPIHono();
app.use(logger(), async (c, next) => {
  c.header("Cache-Control", "no-store");
  return next();
});
app.use("/api/*", async (c, next) => {
  if (isAuthEnabled && token?.length) {
    const bearer = bearerAuth({ token })
    return bearer(c, next)
  }
  return next()
})
app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
  type: "http",
  scheme: "bearer",
});


const routes = app.route("/api", WebhookApi.route).onError((error, c) => {
  if (error instanceof VisibleError) {
    let statusCode: StatusCode
    switch (error.kind) {
      case "input":
        statusCode = 400
        break
      case "auth":
        statusCode = 401
        break
      case "not-found":
        statusCode = 404
        break
      default:
        statusCode = 500
    }
    return c.json(
      {
        code: error.code,
        message: error.message,
      },
      statusCode
    );
  }

  // for when bearer auth is enabled
  if (error instanceof HTTPException) {
    if (error.status === 401) {
      return c.json({
        code: "auth",
        message: "Unauthorized",
      }, error.status)
    }
  }

  if (error instanceof ZodError) {
    const e = error.errors[0];
    if (e) {
      return c.json(
        {
          code: e?.code,
          message: e?.message,
        },
        400,
      );
    }
  }
  return c.json(
    {
      code: "internal",
      message: "Internal server error",
    },
    500,
  );
});


if (areOpenApiDocsEnabled) {
  app.doc("/doc", () => ({
    openapi: "3.0.0",
    info: {
      title: "sst-webhook-service",
      version: "1.0.0",
      description: "A multi-tenant webhook service for event delivery and management",
    },
  }));
  app.get("/ui", swaggerUI({ url: "/doc" }));
}

export type Routes = typeof routes;
export const handler = handle(app)

