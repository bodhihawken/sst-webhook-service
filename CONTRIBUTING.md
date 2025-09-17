# sst-webhook-service

## Running locally

```bash
# install deps
bun install

# Annoying, but to have proper type inference during development go to `index.ts` and change `"../../../.sst/platform/*` imports to `./.sst/platform/*`. Don't commit this change

# run in dev mode
bunx sst dev
```
