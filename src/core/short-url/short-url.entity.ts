import { Entity } from "electrodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient();
let table: string
try {
  const { Resource } = await import("sst");
  table = Resource.UrlShortenerTable.name;
} catch {
  table = ""
}

export const shortUrlEntity = new Entity(
  {
    model: {
      entity: "shortUrl",
      version: "1",
      service: "urlShortener",
    },
    attributes: {
      shortId: {
        type: "string",
        required: true,
      },
      originalUrl: {
        type: "string",
        required: true,
      },
      shortUrl: {
        type: "string",
        required: true,
      },
      createdAt: {
        type: "string",
        required: true,
        default: () => new Date().toISOString(),
      },
      expiredAt: {
        type: "string"
      },
    },
    indexes: {
      byShortId: {
        pk: {
          field: "pk",
          composite: ["shortId"],
        },
        sk: {
          field: "sk",
          composite: ["shortId"],
        },
      },

      byShortUrl: {
        index: "gsi1pk-gsi1sk-index",
        pk: {
          field: "gsi1pk",
          composite: ["shortUrl"],
        },
        sk: {
          field: "gsi1sk",
          composite: ["shortUrl"],
        },
      },

      byOriginalUrl: {
        index: "gsi2pk-gsi2sk-index",
        pk: {
          field: "gsi2pk",
          composite: ["originalUrl"],
        },
        sk: {
          field: "gsi2sk",
          composite: ["originalUrl"],
        },
      },
    },
  },
  { client, table },
);

