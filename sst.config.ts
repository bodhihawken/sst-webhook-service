/// <reference path="./.sst/platform/config.d.ts" />

import { WebhookService } from ".";


export default $config({
  app(input) {
    return {
      name: "sst-webhook-service",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws"
    };
  },
  async run() {
    const webhookService = new WebhookService({})

    //create a function and link it to the webhook service
    const fc = new sst.aws.Function("WebhookServiceFunction", {
      link: [webhookService],
      handler: "index.handler",
      url: true,
    })
    
    return {
      webhookServiceApi: webhookService.api.url,
    }
  }
});
