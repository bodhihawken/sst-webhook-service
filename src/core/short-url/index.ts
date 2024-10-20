import { z } from "zod";
import { shortUrlEntity } from "./short-url.entity";
import { createShortId, fn } from "../utils";
import { Resource } from "sst/resource";
import { VisibleError } from "../error";
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";



export module ShortUrl {
  export const Info = z.object({
    shortId: z.string(),
    originalUrl: z.string().url(),
    shortUrl: z.string().url(),
    createdAt: z.string().datetime(),
    expiredAt: z.string().datetime().optional(),
  });
  export type Info = z.infer<typeof Info>;

  export const create = fn(
    z.object({
      originalUrl: z.string().url().max(2048),
      expiredAt: z.string().datetime().optional(),
    }),
    async ({ originalUrl, expiredAt }) => {
      const existingShortUrl = await fromOriginalUrl({ originalUrl });
      if (existingShortUrl) {
        return existingShortUrl;
      }

      const shortId = createShortId();
      const shortUrl = `${Resource.UrlShortenerRouter.url}/${shortId}`;
      const url = {
        shortId,
        originalUrl,
        shortUrl,
        expiredAt,
        createdAt: new Date().toISOString(),
      }
      await shortUrlEntity
        .create(url)
        .go();

      return url
    },
  );

  export const fromShortUrl = fn(
    z.object({
      shortUrl: z.string().url().max(2048),
    }),
    async ({ shortUrl }) => {
      const res = await shortUrlEntity.query
        .byShortUrl({
          shortUrl,
        })
        .go()
        .then((r) => r.data);

      return res.at(0);
    },
  );

  export const fromOriginalUrl = fn(
    z.object({
      originalUrl: z.string().url().max(2048),
    }),
    async ({ originalUrl }) => {
      const res = await shortUrlEntity.query
        .byOriginalUrl({
          originalUrl,
        })
        .go()
        .then((r) => r.data);

      return res.at(0);
    },
  );

  export const fromOriginalUrlOrFall = fn(
    z.object({
      originalUrl: z.string().url().max(2048),
    }),
    async ({ originalUrl }) => {
      const url = await fromOriginalUrl({ originalUrl });
      if (!url) {
        throw new VisibleError("not-found", "shorturl.not-found", `Short URL not found from original url ${originalUrl}`);
      }
      return url;
    },
  );

  export const fromShortUrlOrFall = fn(
    fromShortUrl.schema,
    async ({ shortUrl }) => {
      const url = await fromShortUrl({ shortUrl });
      if (!url) {
        throw new VisibleError("not-found", "shorturl.not-found", `Short URL not found from short url ${shortUrl}`);
      }
      return url;
    },
  );

  export const fromShortId = fn(
    z.object({
      shortId: z.string().min(3).max(36),
    }),
    async ({ shortId }) => {
      const res = await shortUrlEntity.query
        .byShortId({
          shortId,
        })
        .go()
        .then((r) => r.data);

      return res.at(0);
    },
  );


  export const fromShortIdOrFall = fn(
    fromShortId.schema,
    async ({ shortId }) => {
      const url = await fromShortId({ shortId });
      if (!url) {
        throw new VisibleError("not-found", "shorturl.not-found", `Short URL not found from short id ${shortId}`);
      }
      return url;
    },
  );

  export const removeByOriginalUrl = fn(
    z.object({
      originalUrl: z.string().url().max(2048),
    }),
    async ({ originalUrl }) => {
      const res = await fromOriginalUrlOrFall({ originalUrl });
      await shortUrlEntity.delete({
        shortId: res.shortId,
      }).go()
    },
  );

  export const removeByShortId = fn(
    z.object({
      shortId: z.string().max(36),
    }),
    async ({ shortId }) => {
      await fromShortIdOrFall({ shortId });
      await shortUrlEntity.delete({
        shortId
      }).go()
    },
  );

  export const search = fn(
    z.object({
      originalUrlBeginsWith: z.string().max(2048).optional(),
      expiredAtLTE: z.string().datetime().optional(),
      cursor: z.string().max(200).optional(),
      limit: z.coerce.number().min(1).max(100).optional().default(10).transform(v => typeof v === 'string' ? parseInt(v) : v),
    }),
    async ({ originalUrlBeginsWith, expiredAtLTE, cursor, limit }) => {
      let query = shortUrlEntity.scan
      if (originalUrlBeginsWith) {
        query = query.where(({ originalUrl }, { begins }) =>
          `${begins(originalUrl, originalUrlBeginsWith)}`
        )
      }

      if (expiredAtLTE) {
        query = query.where(({ expiredAt }, { lte }) =>
          `${lte(expiredAt, expiredAtLTE)}`
        )
      }

      const res = await query.go({
        cursor,
        count: limit
      })

      return {
        urls: res.data,
        cursor: res.cursor
      }
    },
  );

  export const quickCount = fn(
    z.void(),
    async () => {
      const client = new DynamoDBClient();
      const command = new DescribeTableCommand({
        TableName: Resource.UrlShortenerTable.name
      })

      const res = await client.send(command);
      const count = res.Table?.ItemCount

      if (count === undefined) {
        throw new Error("Failed to get table item count")
      }

      return {
        count
      }
    },
  );

  export const slowCount = fn(
    z.void(),
    async () => {
      const limit = 100
      let count = 0
      let cursor = null

      do {
        const res = await shortUrlEntity.scan.go({
          count: limit,
          cursor: null
        })
        cursor = res.cursor
        count += res.data.length
      }
      while (cursor)


      return {
        count
      }
    },
  );
}

