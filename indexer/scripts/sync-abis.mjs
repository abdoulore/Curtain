// Copies contract ABIs from the Foundry build (../out) into abis/. Run `forge build` in the repo root first.
import { readFileSync, writeFileSync } from "node:fs";

for (const name of ["CurtainFactory", "CurtainEvent"]) {
  const { abi } = JSON.parse(readFileSync(new URL(`../../out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
  writeFileSync(new URL(`../abis/${name}.json`, import.meta.url), JSON.stringify(abi, null, 2) + "\n");
  console.log(`wrote abis/${name}.json`);
}
