// Next serves public/ as-is. Keep docs/ as the source for both hosting options.
import { cp, mkdir } from "node:fs/promises";

const source = new URL("../docs/", import.meta.url);
const destination = new URL("../public/explorer/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
