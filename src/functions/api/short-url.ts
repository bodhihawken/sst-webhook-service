import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { Result } from "./utils";
import { ShortUrl } from "../../core/short-url";

export module UrlApi {
  export const ShortUrlSchema = z
    .object(ShortUrl.Info.shape)
    .openapi("ShortUrl");
  export const ShortUrlSearchResultSchema = z
    .object({ urls: ShortUrl.Info.array(), cursor: z.string().nullable() })
    .openapi("ShortUrlSearchResult")
  export const ShortrUrlCountResultSchema = z
    .object({ count: z.number() })
    .openapi("ShortUrlCountResult")

  export const route = new OpenAPIHono()
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "post",
        path: "/create",
        description: "Create a new short url",
        request: {
          body: {
            content: {
              "application/json": {
                schema: ShortUrl.create.schema,
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(ShortUrlSchema),
              },
            },
            description: "Return the created short url",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("json");
        const result = await ShortUrl.create(input);
        return c.json({ result }, 200);
      },
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/from-original-url",
        description: "Get the short url from the original url",
        request: {
          query: ShortUrl.fromOriginalUrl.schema,
        },
        responses: {
          404: {
            content: {
              "application/json": {
                schema: z.object({ error: z.string() }),
              },
            },
            description: "Short URL not found",
          },
          200: {
            content: {
              "application/json": {
                schema: Result(ShortUrlSchema),
              },
            },
            description: "Return the url data",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("query");
        const result = await ShortUrl.fromOriginalUrlOrFall(input);
        return c.json({ result }, 200);
      },
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/from-short-id",
        description: "Get the short url from the short id",
        request: {
          query: ShortUrl.fromShortId.schema,
        },
        responses: {
          404: {
            content: {
              "application/json": {
                schema: z.object({ error: z.string() }),
              },
            },
            description: "Short URL not found",
          },
          200: {
            content: {
              "application/json": {
                schema: Result(ShortUrlSchema),
              },
            },
            description: "Return the url data",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("query");
        const result = await ShortUrl.fromShortIdOrFall(input);
        return c.json({ result }, 200);
      },
    ).openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/search",
        description: "Paginated search of short urls",
        request: {
          query: ShortUrl.search.schema,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(ShortUrlSearchResultSchema),
              },
            },
            description: "List of short urls",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("query");
        const result = await ShortUrl.search(input);
        return c.json({ result }, 200);
      },
    ).openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/quick-count",
        description: "Get approximate count of short urls in the DB. Updated every 6 hours.",
        request: {},
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(ShortrUrlCountResultSchema),
              },
            },
            description: "Count of short urls",
          },
        },
      }),
      async (c) => {
        const result = await ShortUrl.quickCount();
        return c.json({ result }, 200);
      },
    ).openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "get",
        path: "/slow-count",
        description: "Scan through the entire table to get real-time count of items",
        request: {},
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(ShortrUrlCountResultSchema),
              },
            },
            description: "Count of short urls",
          },
        },
      }),
      async (c) => {
        const result = await ShortUrl.slowCount();
        return c.json({ result }, 200);
      },
    ).openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "delete",
        path: "/delete-by-original-url",
        description: "Delete a short url by original url",
        request: {
          query: ShortUrl.removeByOriginalUrl.schema,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: z.object({}),
              },
            },
            description: "Return empty object",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("query");
        await ShortUrl.removeByOriginalUrl(input);
        return c.json({}, 200);
      },
    )
    .openapi(
      createRoute({
        security: [{ Bearer: [] }],
        method: "delete",
        path: "/delete-by-short-id",
        description: "Delete a short url by short id",
        request: {
          query: ShortUrl.removeByShortId.schema,
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: z.object({}),
              },
            },
            description: "Return empty object",
          },
        },
      }),
      async (c) => {
        const input = c.req.valid("query");
        await ShortUrl.removeByShortId(input);
        return c.json({}, 200);
      },
    )

}

