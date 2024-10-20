import { ShortUrl } from "../core/short-url";
import { type ApiGatewayRequestContextV2, type LambdaEvent } from "hono/aws-lambda";

export const handler = async (event: LambdaEvent) => {
  console.log("Event", event);
  const path = (event.requestContext as ApiGatewayRequestContextV2).http.path;

  const regex = /(?<=\/)[a-zA-Z0-9]*(?=\/+|$)/;
  const shortId = path.match(regex)?.at(0);

  if (!shortId) {
    return {
      statusCode: 400,
      body: "Invalid URL",
    };
  }

  const url = await ShortUrl.fromShortId({
    shortId,
  });
  if (!url) {
    return {
      statusCode: 404,
      body: "Not found",
    };
  }

  if (url.expiredAt && new Date().toISOString() > url.expiredAt) {
    return {
      statusCode: 404,
      body: "URL expired",
    };
  }

  return {
    statusCode: 301,
    headers: {
      Location: url.originalUrl,
      "Cache-Control": "public, max-age=86400", // 1 day
    },
  };
};

