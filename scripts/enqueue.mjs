// Push task descriptors onto the Redis queue the workers drain. Use this to
// generate load and watch the autoscaler react.
//
// Usage:
//   REDIS_URL=redis://localhost:6379 node scripts/enqueue.mjs 200
import { createClient } from "redis";

const TASKS = [
  "top-spender-email",
  "count-stale-processing",
  "revenue-by-category",
  "refund-order",
  "fix-oversell",
  "dedup-customers",
];
const MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"];

const url = process.env.REDIS_URL || "redis://localhost:6379";
const queue = process.env.PODBENCH_QUEUE || "podbench:tasks";
const n = Number(process.argv[2] || "100");

const client = createClient({ url });
client.on("error", (e) => console.error("redis error", e));
await client.connect();

const pipe = client.multi();
for (let i = 0; i < n; i++) {
  const msg = {
    task_id: TASKS[Math.floor(Math.random() * TASKS.length)],
    model: MODELS[Math.floor(Math.random() * MODELS.length)],
  };
  pipe.rPush(queue, JSON.stringify(msg));
}
await pipe.exec();
const depth = await client.lLen(queue);
console.log(`enqueued ${n} tasks to ${queue}; queue depth now ${depth}`);
await client.quit();
