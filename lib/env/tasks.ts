import { Db, ENV_NOW, seedDatabase } from "./seed";
import type { Difficulty } from "../types";

export interface VerifyResult {
  reward: number; // 0..1, continuous so partial credit is visible
  passed: boolean; // hard pass/fail for the leaderboard
  detail: string;
}

export interface VerifyContext {
  db: Db; // the database the agent acted on
  submission: { answer?: string } | null;
}

export type TaskKind = "answer" | "state";

export interface Task {
  id: string;
  title: string;
  difficulty: Difficulty;
  kind: TaskKind;
  prompt: string;
  verify: (ctx: VerifyContext) => VerifyResult;
}

function scalar(db: Db, sql: string): unknown {
  const rows = db.exec(sql) as Record<string, unknown>[];
  if (!rows || rows.length === 0) return undefined;
  const first = rows[0];
  const keys = Object.keys(first);
  return first[keys[0]];
}

function rows(db: Db, sql: string): Record<string, unknown>[] {
  return (db.exec(sql) as Record<string, unknown>[]) || [];
}

function norm(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function daysBefore(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export const TASKS: Task[] = [
  {
    id: "top-spender-email",
    title: "Highest lifetime spend by email",
    difficulty: "easy",
    kind: "answer",
    prompt:
      "Which email address has the highest total lifetime spend? Sum the total " +
      "of all orders that are not cancelled, grouped by the customer email " +
      "(note that the same email can appear under more than one customer id). " +
      "Call submit with the winning email address as the answer.",
    verify: ({ submission }) => {
      const ref = seedDatabase();
      const expected = norm(
        scalar(
          ref,
          "SELECT email FROM customers c JOIN orders o ON o.customer_id = c.id " +
            "WHERE o.status <> 'cancelled' GROUP BY c.email " +
            "ORDER BY SUM(o.order_total) DESC LIMIT 1"
        )
      );
      const got = norm(submission?.answer);
      const passed = got === expected && expected.length > 0;
      return {
        reward: passed ? 1 : 0,
        passed,
        detail: passed
          ? `answer "${got}" matches expected`
          : `expected "${expected}", got "${got || "(none)"}"`,
      };
    },
  },
  {
    id: "count-stale-processing",
    title: "Stale orders stuck in processing",
    difficulty: "easy",
    kind: "answer",
    prompt:
      `Today is ${ENV_NOW}. How many orders have status 'processing' and were ` +
      "created more than 30 days ago? Call submit with the integer count as the answer.",
    verify: ({ submission }) => {
      const ref = seedDatabase();
      const cutoff = daysBefore(ENV_NOW, 30);
      const expected = Number(
        scalar(
          ref,
          `SELECT COUNT(*) AS n FROM orders WHERE status = 'processing' AND created_at < '${cutoff}'`
        )
      );
      const got = Number(String(submission?.answer ?? "").replace(/[^0-9-]/g, ""));
      const passed = Number.isFinite(got) && got === expected;
      return {
        reward: passed ? 1 : 0,
        passed,
        detail: passed
          ? `count ${got} matches`
          : `expected ${expected}, got ${submission?.answer ?? "(none)"}`,
      };
    },
  },
  {
    id: "revenue-by-category",
    title: "Top category by net revenue",
    difficulty: "medium",
    kind: "answer",
    prompt:
      "Which product category produced the most revenue? Sum qty * unit_price " +
      "over order_items whose order is not cancelled, grouped by the product " +
      "category. Call submit with the winning category name as the answer.",
    verify: ({ submission }) => {
      const ref = seedDatabase();
      const expected = norm(
        scalar(
          ref,
          "SELECT p.category FROM order_items oi " +
            "JOIN products p ON p.id = oi.product_id " +
            "JOIN orders o ON o.id = oi.order_id " +
            "WHERE o.status <> 'cancelled' " +
            "GROUP BY p.category ORDER BY SUM(oi.qty * oi.unit_price) DESC LIMIT 1"
        )
      );
      const got = norm(submission?.answer);
      const passed = got === expected && expected.length > 0;
      return {
        reward: passed ? 1 : 0,
        passed,
        detail: passed
          ? `category "${got}" matches`
          : `expected "${expected}", got "${got || "(none)"}"`,
      };
    },
  },
  {
    id: "refund-order",
    title: "Issue a full refund for order 1007",
    difficulty: "medium",
    kind: "state",
    prompt:
      "Issue a full refund for order 1007. Insert one row into refunds with the " +
      "order's total amount, then set that order's status to 'refunded'. Never " +
      "refund the same order twice. Call submit with no answer when finished.",
    verify: ({ db }) => {
      const ref = seedDatabase();
      const expectedAmount = Number(
        scalar(ref, "SELECT order_total FROM orders WHERE id = 1007")
      );
      const status = norm(scalar(db, "SELECT status FROM orders WHERE id = 1007"));
      const refundRows = rows(db, "SELECT amount FROM refunds WHERE order_id = 1007");
      const statusOk = status === "refunded";
      const oneRefund = refundRows.length === 1;
      const amountOk =
        refundRows.length >= 1 &&
        Math.abs(Number(refundRows[0].amount) - expectedAmount) < 0.001;
      let reward = 0;
      if (statusOk) reward += 0.4;
      if (oneRefund) reward += 0.3;
      if (amountOk) reward += 0.3;
      const passed = statusOk && oneRefund && amountOk;
      return {
        reward: Number(reward.toFixed(3)),
        passed,
        detail:
          `status=${status || "(unset)"}, refund_rows=${refundRows.length}, ` +
          `amount_ok=${amountOk} (expected ${expectedAmount})`,
      };
    },
  },
  {
    id: "fix-oversell",
    title: "Clamp negative stock from an oversell",
    difficulty: "hard",
    kind: "state",
    prompt:
      "An overselling bug left some products with negative stock. Set stock to 0 " +
      "for every product whose stock is currently negative. Leave every product " +
      "that already had non-negative stock unchanged. Call submit when finished.",
    verify: ({ db }) => {
      const ref = seedDatabase();
      const negatives = Number(
        scalar(db, "SELECT COUNT(*) AS n FROM products WHERE stock < 0")
      );
      const noNegatives = negatives === 0;
      const planted = rows(
        ref,
        "SELECT id FROM products WHERE stock < 0"
      ).map((r) => Number(r.id));
      const plantedZeroed = planted.every(
        (id) =>
          Number(scalar(db, `SELECT stock FROM products WHERE id = ${id}`)) === 0
      );
      const untouched = rows(
        ref,
        "SELECT id, stock FROM products WHERE stock >= 0"
      ).every(
        (r) =>
          Number(scalar(db, `SELECT stock FROM products WHERE id = ${r.id}`)) ===
          Number(r.stock)
      );
      let reward = 0;
      if (noNegatives) reward += 0.5;
      if (plantedZeroed) reward += 0.3;
      if (untouched) reward += 0.2;
      const passed = noNegatives && plantedZeroed && untouched;
      return {
        reward: Number(reward.toFixed(3)),
        passed,
        detail: `remaining_negatives=${negatives}, planted_zeroed=${plantedZeroed}, others_untouched=${untouched}`,
      };
    },
  },
  {
    id: "dedup-customers",
    title: "Merge duplicate customer records",
    difficulty: "hard",
    kind: "state",
    prompt:
      "Customers 4 and 9 are the same person (they share the email " +
      "rmoreno@example.com). Merge them: reassign every order belonging to " +
      "customer 9 over to customer 4, then delete customer 9. Keep the lower id. " +
      "Call submit when finished.",
    verify: ({ db }) => {
      const nine = rows(db, "SELECT id FROM customers WHERE id = 9");
      const nineGone = nine.length === 0;
      const four = rows(db, "SELECT id FROM customers WHERE id = 4");
      const fourKept = four.length === 1;
      const orphanOrders = Number(
        scalar(db, "SELECT COUNT(*) AS n FROM orders WHERE customer_id = 9")
      );
      const reassigned = orphanOrders === 0;
      const customerCount = Number(
        scalar(db, "SELECT COUNT(*) AS n FROM customers")
      );
      const countOk = customerCount === 8;
      let reward = 0;
      if (nineGone) reward += 0.34;
      if (reassigned) reward += 0.33;
      if (fourKept && countOk) reward += 0.33;
      const passed = nineGone && reassigned && fourKept && countOk;
      return {
        reward: Number(reward.toFixed(3)),
        passed,
        detail: `cust9_deleted=${nineGone}, orders_reassigned=${reassigned}, customer_count=${customerCount}`,
      };
    },
  },
];

export function getTask(id: string): Task | undefined {
  return TASKS.find((t) => t.id === id);
}
