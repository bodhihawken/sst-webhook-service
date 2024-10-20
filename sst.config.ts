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
    const apiAuthKey = new sst.Secret(
      "UrlShortenerApiAuthKey",
      "your_secret",
    );

    const shortener = new UrlShortener({
      enableApiAuth: true,
      link: [apiAuthKey],
    })

    return {
      ulrShortenerApi: shortener.api.url,
      urlShortenerRouter: shortener.router.url,
    }
  }
});
