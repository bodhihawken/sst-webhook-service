/// <reference path="./.sst/platform/config.d.ts" />

import { UrlShortener } from ".";

export default $config({
  app(input) {
    return {
      name: "sst-url-shortener",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws"
    };
  },
  async run() {
    const shortener = new UrlShortener({})

    return {
      ulrShortenerApi: shortener.api.url,
      urlShortenerRouter: shortener.router.url,
    }
  }
});
