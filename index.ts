// FIXME: figure out absolute imports; currently committed imports are relative to the node_modules folder
import { type CdnArgs } from "./.sst/platform/src/components/aws";
import type { FunctionArgs } from "./.sst/platform/src/components/aws/function";
import type { ApiGatewayV2Args } from "./.sst/platform/src/components/aws/apigatewayv2";
import type { DynamoArgs } from "./.sst/platform/src/components/aws/dynamo";
import type { RouterArgs } from "./.sst/platform/src/components/aws/router";
import { type Input } from "@pulumi/pulumi";



type UrlShortenerArgs = {
  /**
   * Require bearer authentication on API requests
   *
   * @default false
   */
  enableApiAuth?: boolean

  /**
   * Have swagger UI under /ui and openapi.json under /doc
   *
   * @default true
   */
  enableOpenApiDocs?: boolean

  /**
   * desired length of the short id: short.com/{shortId}
   * between 4 and 24
   *
   * @default 8
   */
  shortIdLength?: number

  /**
   * Set a custom domain for your short URLs.
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
   * [Link resources](https://sst.dev/docs/linking) to your function. This will:
   *
   * 1. Grant the permissions needed to access the resources.
   * 2. Allow you to access it in your function using the [SDK](/docs/reference/sdk/).
   *
   * @example
   *
   * Takes a list of components to link to the function.
   *
   * ```js
   * {
   *   link: [bucket, stripeKey]
   * }
   * ```
   */
  link?: Input<any[]>;


  /**
   * [Transform](https://sst.dev/docs/components/#transform) how this component creates its underlying
   * resources.
   */
  transform?: {
    redirectHandler?: FunctionArgs['transform']
    api?: ApiGatewayV2Args['transform']
    router?: RouterArgs['transform']
    dynamo?: DynamoArgs['transform']
  };
}


export class UrlShortener {
  api: sst.aws.ApiGatewayV2
  router: sst.aws.Router
  redirectHandler: sst.aws.Function
  table: sst.aws.Dynamo

  constructor(
    args: UrlShortenerArgs,
  ) {
    const link: Input<any> = args.link || [];
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
      transform: args?.transform?.dynamo,
    });

    const redirectHandler = new sst.aws.Function("UrlShortenerRedirectHandlerFunction", {
      handler: `${handlerPathPrefix}src/functions/redirect.handler`,
      vpc: args.vpc,
      link: [table, shortIdLength, ...link],
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
      link: [table, redirectRouter, isAuthEnabled, areOpenApiDocsEnabled, authKey, shortIdLength, ...link],
      transform: args.transform?.api,
      vpc: args.vpc && { subnets: $output(args.vpc).privateSubnets, securityGroups: $output(args.vpc).securityGroups },
    });
    api.route("$default", `${handlerPathPrefix}src/functions/api/index.handler`)


    this.api = api
    this.router = redirectRouter
    this.table = table
    this.redirectHandler = redirectHandler
  }
}


const __pulumiType = "sst:dizzzmas:aws:UrlShortener";
// @ts-expect-error
UrlShortener.__pulumiType = __pulumiType;
