// TODO: figure out absolute imports; currently committed imports are relative to the node_modules folder
import { type CdnArgs } from "../../../.sst/platform/src/components/aws";
import type { FunctionArgs } from "../../../.sst/platform/src/components/aws/function";
import type { ApiGatewayV2Args } from "../../../.sst/platform/src/components/aws/apigatewayv2";
import type { DynamoArgs } from "../../../.sst/platform/src/components/aws/dynamo";
import type { RouterArgs } from "../../../.sst/platform/src/components/aws/router";
import { type Input } from "@pulumi/pulumi";

// export domain functions that can be used in the app
export * from './src/core/short-url'


type UrlShortenerArgs = {
  /**
   * Require bearer authentication on API requests
   *
   * When `true`, the auth token value is inferred from the `UrlShortenerApiAuthKey` [Secret](https://sst.dev/docs/component/secret/)
   * To change the token run `sst secret set UrlShortenerApiAuthKey "YOUR_TOKEN"`
   * @default false
   */
  enableApiAuth?: boolean

  /**
   * Have Swagger UI under /ui and openapi.json under /doc
   *
   * @default true
   */
  enableOpenApiDocs?: boolean

  /**
   * Desired length of the id in shortened urls e.g. my-shortener.com/{shortId}
   * Allowed values between 4 and 24
   *
   * Inferred from the `UrlShortenerShortIdLength` [Secret](https://sst.dev/docs/component/secret/)
   * To change, run `sst secret set UrlShortenerShortIdLength "YOUR_TOKEN"`
   * @default 8
   */
  shortIdLength?: number

  /**
   * Set a custom domain for your short URLs and the API
   *
   * ```typescript
   * const shortener = new UrlShortener({
   *     domain: {
   *       name: "share.acme.com",
   *       dns: sst.aws.dns()
   *     }
   * })
   * ```
   * The above example will results in short URLs looking like `https://share.acme.com/etogiyeu`,
   * and the API looking like `https://api.share.acme.com/ui`
   *
   *
   * Automatically manages domains hosted on AWS Route 53, Cloudflare, and Vercel. For other
   * providers, you'll need to pass in a `cert` that validates domain ownership and add the
   * DNS records.
   *
   * :::tip
   * Built-in support for AWS Route 53, Cloudflare, and Vercel. And manual setup for other
   * providers.
   * :::
   *
   * @example
   *
   * By default this assumes the domain is hosted on Route 53.
   *
   * ```js
   * {
   *   domain: "example.com"
   * }
   * ```
   *
   * For domains hosted on Cloudflare.
   *
   * ```js
   * {
   *   domain: {
   *     name: "example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   *
   * Specify a `www.` version of the custom domain.
   *
   * ```js
   * {
   *   domain: {
   *     name: "domain.com",
   *     redirects: ["www.domain.com"]
   *   }
   * }
   * ```
   */
  domain?: CdnArgs["domain"]

  /**
   * Specify VPC configuration for the Lambda Functions used by the URL shortener.
   *
   * @example
   * ```js
   * {
   *   vpc: {
   *     privateSubnets: ["subnet-0b6a2b73896dc8c4c", "subnet-021389ebee680c2f0"]
   *     securityGroups: ["sg-0399348378a4c256c"],
   *   }
   * }
   * ```
   */
  vpc?: FunctionArgs["vpc"]

  /**
   * [Transform](https://sst.dev/docs/components/#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    redirectHandler?: FunctionArgs['transform']
    api?: ApiGatewayV2Args['transform']
    router?: RouterArgs['transform']
    table?: DynamoArgs['transform']
  };
}

export class UrlShortener {
  api: sst.aws.ApiGatewayV2
  router: sst.aws.Router
  redirectHandler: sst.aws.Function
  table: sst.aws.Dynamo
  /**
   * used to link URLShortener to other components
   */
  link: Input<any[]>

  constructor(
    args: UrlShortenerArgs,
  ) {
    const isAuthEnabled = new sst.Secret("UrlShortenerApiAuthEnabled", args.enableApiAuth ? "true" : "false")
    const areOpenApiDocsEnabled = new sst.Secret("UrlShortenerOpenApiDocsEnabled", args.enableOpenApiDocs === false ? "false" : "true")
    const authKey = new sst.Secret("UrlShortenerApiAuthKey", "your_secret")
    if (args.shortIdLength && (args.shortIdLength < 4 || args.shortIdLength > 24)) {
      throw new Error("shortIdLength must be between 4 and 24")
    }
    const shortIdLength = new sst.Secret("UrlShortenerShortIdLength", args.shortIdLength ? args.shortIdLength.toString() : "8")
    const handlerPathPrefix = process.env.DIZZZMAS_DEV_MODE === "true" ? "" : "node_modules/@dizzzmas/sst-url-shortener/"

    // single table design with https://electrodb.dev/
    const table = new sst.aws.Dynamo("UrlShortenerTable", {
      fields: {
        pk: "string",
        sk: "string",
        gsi1pk: "string",
        gsi1sk: "string",
        gsi2pk: "string",
        gsi2sk: "string",
      },
      primaryIndex: { hashKey: "pk", rangeKey: "sk" },
      globalIndexes: {
        "gsi1pk-gsi1sk-index": { hashKey: "gsi1pk", rangeKey: "gsi1sk" },
        "gsi2pk-gsi2sk-index": { hashKey: "gsi2pk", rangeKey: "gsi2sk" },
      },
      transform: args?.transform?.table,
    });

    const redirectHandler = new sst.aws.Function("UrlShortenerRedirectHandlerFunction", {
      handler: `${handlerPathPrefix}src/functions/redirect.handler`,
      vpc: args.vpc,
      link: [table, shortIdLength],
      url: true,
      transform: args.transform?.redirectHandler
    });

    const redirectRouter = new sst.aws.Router("UrlShortenerRouter", {
      routes: {
        "/*": redirectHandler.url,
      },
      domain: args.domain,
      transform: args.transform?.router,
    });

    const api = new sst.aws.ApiGatewayV2("UrlShortenerApi", {
      domain: args.domain && $output(args.domain).apply(d => (
        typeof d === 'string' ? `api.${d}` : { ...d, name: `api.${d.name}` }
      )),
      link: [table, redirectRouter, isAuthEnabled, areOpenApiDocsEnabled, authKey, shortIdLength],
      transform: args.transform?.api,
      vpc: args.vpc && { subnets: $output(args.vpc).privateSubnets, securityGroups: $output(args.vpc).securityGroups },
    });
    api.route("$default", `${handlerPathPrefix}src/functions/api/index.handler`)

    this.api = api
    this.router = redirectRouter
    this.table = table
    this.redirectHandler = redirectHandler
    this.link = [table, api, redirectHandler, redirectRouter, shortIdLength, isAuthEnabled, areOpenApiDocsEnabled, authKey]
  }
}
