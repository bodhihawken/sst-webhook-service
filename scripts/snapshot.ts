#!/usr/bin/env bun
import { $ } from "bun";

import pkg from "../package.json";
const nextPkg = JSON.parse(JSON.stringify(pkg));
nextPkg.optionalDependencies = nextPkg.optionalDependencies || {};
nextPkg.version = `0.0.0-${Date.now()}`;  // set snapshot version
const isSnapshot = nextPkg.version.includes("0.0.0");
if (isSnapshot) {
  console.log("snapshot mode");
}

console.log("publishing", nextPkg.version);


const tag = isSnapshot ? "snapshot" : "latest";
await Bun.write("package.json", JSON.stringify(nextPkg, null, 2));
await $`bun publish --access public --tag ${tag}`;

