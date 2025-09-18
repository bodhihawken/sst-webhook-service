// TODO: figure out absolute imports; currently committed imports are relative to the node_modules folder
import type { FunctionArgs } from "../../../../.sst/platform/src/components/aws/function";
import type { ApiGatewayV2Args } from "../../../../.sst/platform/src/components/aws/apigatewayv2";
import type { DynamoArgs } from "../../../../.sst/platform/src/components/aws/dynamo";
import { type Input } from "@pulumi/pulumi";
import { type QueueArgs } from "../../../../.sst/platform/src/components/aws/queue";
import {Queue} from "../../../../.sst/platform/src/components/aws/queue";
import {Dynamo} from "../../../../.sst/platform/src/components/aws/dynamo";
import {Function} from "../../../../.sst/platform/src/components/aws/function";
import {Secret} from "../../../../.sst/platform/src/components/secret";

// export domain functions that can be used in the app
export * from './src/core/webhook'


type WebhookServiceArgs = {
  /**
   * Require bearer authentication on API requests
   *
   * When `true`, the auth token value is inferred from the `WebhookServiceApiAuthKey` [Secret](https://sst.dev/docs/component/secret/)
   * To change the token run `sst secret set WebhookServiceApiAuthKey "YOUR_TOKEN"`
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
   * Set a custom domain for the webhook service API
   *
   * ```typescript
   * const webhookService = new WebhookService({
   *     domain: {
   *       name: "webhooks.acme.com",
   *       dns: sst.aws.dns()
   *     }
   * })
   * ```
   * The above example will result in the API being available at `https://webhooks.acme.com/ui`
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
   *   domain: "webhooks.example.com"
   * }
   * ```
   *
   * For domains hosted on Cloudflare.
   *
   * ```js
   * {
   *   domain: {
   *     name: "webhooks.example.com",
   *     dns: sst.cloudflare.dns()
   *   }
   * }
   * ```
   */
  domain?: string | {
    name: string;
    dns?: any;
    cert?: any;
  }

  /**
   * Specify VPC configuration for the Lambda Functions used by the webhook service.
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
    api?: ApiGatewayV2Args['transform']
    table?: DynamoArgs['transform']
    queue?: QueueArgs['transform']
    dlq?: QueueArgs['transform']
    webhookProcessor?: FunctionArgs['transform']
  };
}

export class WebhookService {
  api: Function
  table: Dynamo
  queue: Queue
  deadLetterQueue: Queue
  webhookProcessor: Function
  /**
   * used to link WebhookService to other components
   */
  link: Input<any[]>

  constructor(
    args: WebhookServiceArgs,
  ) {
    const isAuthEnabled = new Secret("WebhookServiceApiAuthEnabled", args.enableApiAuth ? "true" : "false")
    const areOpenApiDocsEnabled = new Secret("WebhookServiceOpenApiDocsEnabled", args.enableOpenApiDocs === false ? "false" : "true")
    const authKey = new Secret("WebhookServiceApiAuthKey", "your_secret")
    const handlerPathPrefix = process.env.PACKAGE_DEV_MODE === "true" ? "" : "node_modules/@queuebar/sst-webhook-service/"

    // single table design with https://electrodb.dev/
    const table = new Dynamo("WebhookServiceTable", {
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

    // Dead Letter Queue for failed webhook deliveries
    const deadLetterQueue = new Queue("WebhookServiceDLQ", {
      fifo: false,
      visibilityTimeout: "30 seconds",
      transform: args.transform?.dlq,
    });

    // Main queue for webhook deliveries with DLQ and retry configuration
    const queue = new Queue("WebhookServiceQueue", {
      fifo: false,
      visibilityTimeout: "30 seconds",
      dlq: {
        queue: deadLetterQueue.arn,
        retry: 3, // Retry 3 times before sending to DLQ
      },
      transform: args.transform?.queue,
    });

    // Function to process webhook deliveries from the queue
    const webhookProcessor = new Function("WebhookServiceProcessor", {
      handler: `${handlerPathPrefix}src/functions/webhook-processor.handler`,
      vpc: args.vpc,
      link: [table, queue, deadLetterQueue],
      timeout: "30 seconds",
      transform: args.transform?.webhookProcessor,
    });

    // Subscribe the processor to the main queue
    queue.subscribe(webhookProcessor.arn, {
      batch: {
        size: 10, // Process up to 10 messages at once
        window: "30 seconds", // Wait up to 5 seconds to collect messages
        partialResponses: true, // Allow partial batch failures
      },
    });

    //create a function and use the url for the api
    const api = new Function("WebhookServiceApi", {
      handler: `${handlerPathPrefix}src/functions/api/index.handler`,
      link: [table, queue, deadLetterQueue, isAuthEnabled, areOpenApiDocsEnabled, authKey],
      transform: args.transform?.api,
      url: true,
    });



    this.api = api
    this.table = table
    this.queue = queue
    this.deadLetterQueue = deadLetterQueue
    this.webhookProcessor = webhookProcessor
    this.link = [table, api, queue, deadLetterQueue, webhookProcessor, isAuthEnabled, areOpenApiDocsEnabled, authKey]
  }
}
