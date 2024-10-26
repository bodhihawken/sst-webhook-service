# sst-url-shortener

Host your own URL shortener on AWS with SST and chop up those beefy URLs in a breeze.

- API comes with easily toggleable auth, swagger docs, URL search and expiration support
- Deploy as part of your existing SST app or standalone(using sdk to integrate with your other services)
- Lambda, DynamoDB, CloudFront, fully within AWS Free Tier with 0 upfront cost
- Bring your custom domain

```bash
bun install
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.1.31. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
