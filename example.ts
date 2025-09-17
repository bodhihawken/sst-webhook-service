import { Webhook } from "./src/core/webhook"


export const handler = async () => {
    const  webhook  = await Webhook.get({ webhookId: "webhook-123" })


   
    return webhook
  }