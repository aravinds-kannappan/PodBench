// Next serves public/ as-is. Copy the two static research sites into that directory.
import { cp, mkdir } from "node:fs/promises";

const source = new URL("../docs/", import.meta.url);
const destination = new URL("../public/explorer/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });

const recovery = new URL("../research/recovery/site/public/", import.meta.url);
const recoveryDestination = new URL("../public/recovery/", import.meta.url);
await mkdir(recoveryDestination, { recursive: true });
await cp(recovery, recoveryDestination, { recursive: true });
