import alasql from "alasql";

// The reference clock for the environment. All date math in tasks is computed
// against this fixed instant so verification stays deterministic regardless of
// when a run executes.
export const ENV_NOW =
  process.env.PODBENCH_ENV_NOW && process.env.PODBENCH_ENV_NOW.length > 0
    ? process.env.PODBENCH_ENV_NOW
    : "2026-06-15";

export const SCHEMA = `
customers(id INT, name STRING, email STRING, country STRING, created_at STRING)
products(id INT, name STRING, category STRING, price NUMBER, stock INT)
orders(id INT, customer_id INT, status STRING, order_total NUMBER, created_at STRING)
order_items(id INT, order_id INT, product_id INT, qty INT, unit_price NUMBER)
refunds(id INT, order_id INT, amount NUMBER, reason STRING, created_at STRING)
`.trim();

// A detailed data dictionary that ships with the system prompt. Two reasons it is
// this long: (1) it is genuinely the context an operator needs to write correct
// queries against this schema, and (2) prompt caching on the Opus tier only
// engages above a 4096-token prefix, so a thin schema would silently never cache.
// Keeping the dictionary stable and first in the prompt is what makes every turn
// after the first read the prefix from cache instead of paying full input price.
export const PLAYBOOK = `
DATA DICTIONARY

This console is a read/write window onto an order-management database for a small
furniture and peripherals retailer. Five tables model the whole business. There
are no views, no stored procedures, and no triggers; every invariant below is
maintained by the application, not the database, which is exactly why operator
queries have to respect them by hand.

Table: customers
  id          Stable integer primary key. Never reused, never reordered.
  name        Display name. Not unique; two different people can share a name.
  email       Login identity. Intended to be unique per person, but historically
              the signup flow allowed the same email to be registered twice, so a
              single real person can appear under more than one customer id with
              the same email. Treat email as the identity of record when totalling
              spend or deduplicating; treat id as the key when joining.
  country     Two-letter ISO country code. Used for tax and shipping logic only.
  created_at  Account creation date, ISO 8601 date (YYYY-MM-DD). Dates are stored
              as text and compare correctly with lexical string comparison because
              they are zero-padded ISO. Never store a non-ISO date here.

Table: products
  id          Stable integer primary key.
  name        Catalogue name. Product families share a prefix (for example the
              "Strata" desk and "Strata" desk mat) but are distinct rows.
  category    One of: lighting, peripherals, furniture. Lowercase, no synonyms.
  price       Current list price in USD. Historical orders may have transacted at
              a different price, which is why order_items carries its own
              unit_price rather than joining back to this column.
  stock       On-hand units. Should never be negative. It can go negative when two
              fulfilment workers decrement the same row concurrently and oversell;
              when that happens the correct remediation is to clamp the value to
              zero, not to invent inventory. Do not touch rows that are already at
              or above zero.

Table: orders
  id          Stable integer primary key. Order ids start at 1001.
  customer_id Foreign key into customers.id. When customers are merged, the orders
              of the losing id must be reassigned to the surviving id; orders are
              never deleted as part of a merge.
  status      Lifecycle state. The allowed values and their meaning:
                processing  Accepted, not yet paid or shipped. Orders can sit here
                            for a long time when payment authorisation is pending.
                paid        Payment captured, awaiting fulfilment.
                delivered   Fulfilled and received. Terminal, happy path.
                cancelled   Voided before fulfilment. Excluded from revenue and
                            from lifetime-spend totals.
                refunded    Money returned after the fact. A refunded order keeps
                            its total but should have a matching row in refunds.
              Revenue and spend questions almost always mean "exclude cancelled".
              Read the task to decide whether refunded should also be excluded; by
              default it is still counted as having been spent.
  order_total Order total in USD. This is the authoritative amount to refund when
              issuing a full refund. It equals the sum of its order_items
              qty * unit_price for well-formed orders, but always read order_total
              directly rather than recomputing it.
  created_at  Order placement date, ISO 8601 date. Use string comparison against a
              cutoff date for "older than N days" questions; compute the cutoff
              from the reference date given in the task, not from the wall clock.

Table: order_items
  id          Stable integer primary key.
  order_id    Foreign key into orders.id. One order has one or more items.
  product_id  Foreign key into products.id.
  qty         Units of this product on the order. Always positive.
  unit_price  Price actually charged per unit at order time. Use this, not
              products.price, for any revenue computation, because list prices
              drift over time.

Table: refunds
  id          Stable integer primary key.
  order_id    Foreign key into orders.id. At most one refund row per order in
              normal operation; issuing a refund twice is a defect to avoid.
  amount      Amount returned in USD. For a full refund this equals the order
              total. Partial refunds are allowed in the data model but are not
              something the current tasks ask for.
  reason      Free text. Short human explanation.
  created_at  Refund date, ISO 8601 date.

QUERY CONVENTIONS

  - The engine is a standard SQL dialect supporting SELECT, INSERT, UPDATE,
    DELETE, JOIN, GROUP BY, ORDER BY, LIMIT, COUNT, SUM, AVG, MIN, and MAX.
  - One statement per run_sql call. Inspect before you mutate.
  - For "which X has the most Y" questions, GROUP BY the dimension, ORDER BY the
    aggregate descending, and LIMIT 1.
  - For lifetime spend, group by customers.email (identity of record), not by
    customer id, and exclude cancelled orders unless told otherwise.
  - For "older than N days" questions, derive the cutoff date by subtracting N
    days from the task's reference date, then filter created_at < cutoff using
    string comparison on the ISO dates.
  - For revenue by category, sum order_items.qty * order_items.unit_price, join
    to orders to filter out cancelled orders, and join to products for the
    category. Never use products.price for revenue.
  - When changing state, change only the rows the task names. After a mutation,
    read the affected rows back to confirm the change before you submit.

SAFETY RULES

  - Do not delete rows unless the task explicitly asks for a deletion or a merge.
  - Do not issue a refund for an order that already has a refund row.
  - Do not modify a product whose stock is already non-negative.
  - When merging customers, reassign orders first, then delete the duplicate, so
    you never strand an order against a missing customer id.
  - If a query returns something surprising, investigate with another read before
    you act on it. The cost of an extra SELECT is trivial; the cost of a wrong
    UPDATE is not.

WORKED PATTERNS

  Find the top group by an aggregate:
    SELECT email FROM customers c JOIN orders o ON o.customer_id = c.id
    WHERE o.status <> 'cancelled' GROUP BY c.email
    ORDER BY SUM(o.order_total) DESC LIMIT 1;

  Count rows matching a date cutoff:
    SELECT COUNT(*) FROM orders
    WHERE status = 'processing' AND created_at < '2026-05-16';

  Issue a full refund safely:
    SELECT order_total FROM orders WHERE id = 1007;      -- read the amount
    SELECT COUNT(*) FROM refunds WHERE order_id = 1007;  -- confirm none exists
    INSERT INTO refunds (id, order_id, amount, reason, created_at)
      VALUES (2, 1007, 235, 'full refund', '2026-06-15');
    UPDATE orders SET status = 'refunded' WHERE id = 1007;

  Clamp oversold inventory:
    SELECT id, stock FROM products WHERE stock < 0;      -- see what is affected
    UPDATE products SET stock = 0 WHERE stock < 0;

  Merge a duplicate customer:
    UPDATE orders SET customer_id = 4 WHERE customer_id = 9;
    DELETE FROM customers WHERE id = 9;

APPENDIX A: COMMON MISTAKES AND HOW TO AVOID THEM

  Mistake: totalling lifetime spend by customer id when a person has two ids.
    Why it is wrong: a duplicate signup splits one person's spend across two
    rows, so neither row reflects their true total and the ranking is wrong.
    Fix: GROUP BY email, which is the identity of record for spend questions.

  Mistake: using products.price in a revenue calculation.
    Why it is wrong: list prices change over time, so the current price does not
    reflect what was actually charged on an old order.
    Fix: use order_items.unit_price, which is frozen at order time.

  Mistake: including cancelled orders in revenue or spend.
    Why it is wrong: a cancelled order never collected money.
    Fix: filter WHERE status <> 'cancelled'. Decide separately whether refunded
    orders should be excluded; the task will say so when it matters.

  Mistake: computing a date cutoff from the current wall-clock time.
    Why it is wrong: results then depend on when the query runs, which is not
    reproducible.
    Fix: subtract the window from the reference date the task provides.

  Mistake: recomputing an order total from its items to decide a refund amount.
    Why it is wrong: small rounding differences and missing items make the
    recomputed value drift from the authoritative figure.
    Fix: refund orders.order_total directly.

  Mistake: issuing a second refund for an order that already has one.
    Why it is wrong: it double-pays the customer and corrupts the books.
    Fix: SELECT COUNT(*) FROM refunds WHERE order_id = X before inserting.

  Mistake: deleting a customer before reassigning their orders.
    Why it is wrong: it strands orders against a customer id that no longer
    exists, breaking every join that goes through customers.
    Fix: reassign orders first, delete the duplicate second.

  Mistake: setting all stock to zero to fix an oversell.
    Why it is wrong: it destroys legitimate inventory on healthy rows.
    Fix: restrict the UPDATE to WHERE stock < 0.

APPENDIX B: STATUS TRANSITION REFERENCE

  The normal forward path for an order is:
    processing -> paid -> delivered
  Two side exits are allowed:
    processing -> cancelled       (before any money is captured)
    paid -> refunded              (after money is captured and then returned)
    delivered -> refunded         (a return after delivery)
  No other transitions are expected in this data set. In particular, a
  delivered order does not go back to processing, and a cancelled order does not
  later become paid. When a task asks you to set a status, set exactly that
  status on exactly the named order and leave the lifecycle of every other order
  untouched.

  Counting semantics by status:
    processing  Counts as open work in progress. Often the subject of
                "stuck" or "stale" questions filtered by created_at.
    paid        Counts as revenue collected and as fulfilment backlog.
    delivered   Counts as revenue collected and as completed work.
    cancelled   Counts as nothing. Excluded from revenue and spend.
    refunded    Counts as revenue that was collected and then returned. Whether
                it nets out of a total depends on the question being asked.

APPENDIX C: EXTENDED EXAMPLES

  List every order for one customer, newest first:
    SELECT id, status, order_total, created_at FROM orders
    WHERE customer_id = 4 ORDER BY created_at DESC;

  Total revenue by category, excluding cancelled orders:
    SELECT p.category AS category, SUM(oi.qty * oi.unit_price) AS revenue
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.status <> 'cancelled'
    GROUP BY p.category ORDER BY revenue DESC;

  Find duplicate emails that map to more than one customer id:
    SELECT email, COUNT(*) AS ids FROM customers
    GROUP BY email HAVING COUNT(*) > 1;

  Inspect oversold inventory before fixing it:
    SELECT id, name, stock FROM products WHERE stock < 0 ORDER BY stock ASC;

  Confirm a refund landed correctly:
    SELECT o.status, r.amount FROM orders o
    LEFT JOIN refunds r ON r.order_id = o.id
    WHERE o.id = 1007;

  Spend per email, ranked, excluding cancelled orders:
    SELECT c.email AS email, SUM(o.order_total) AS spend
    FROM customers c JOIN orders o ON o.customer_id = c.id
    WHERE o.status <> 'cancelled'
    GROUP BY c.email ORDER BY spend DESC;

GLOSSARY

  identity of record   The column that represents a real-world entity for the
                       purpose of a given question. For spend and deduplication
                       it is the email; for joins it is the id.
  oversell             Selling more units than are in stock, which drives the
                       stock column negative. Remediated by clamping to zero.
  clamp                Replace an out-of-range value with the nearest allowed
                       value. Here, replace a negative stock with zero.
  merge                Collapse two customer rows that represent one person into
                       a single surviving row, moving all dependent rows over
                       before deleting the duplicate.
  cutoff date          The boundary date for an "older than N days" filter,
                       computed by subtracting N days from a reference date.
  terminal status      A status an order is not expected to leave: delivered,
                       cancelled, and refunded are terminal in this data set.
  authoritative amount The figure to trust when two sources disagree. For a
                       refund it is orders.order_total, not a recomputed sum.

CLOSING NOTE

  Every task in this environment is graded by a programmatic verifier that
  inspects the database you leave behind, or compares your submitted answer to a
  value computed from a freshly seeded copy of the same data. There is no credit
  for explanation and no penalty for extra reads. Correctness of the final state
  or the final answer is the only thing measured. Read first, change only what is
  asked, confirm, then submit.
`.trim();

// Deterministic fixture data. Note the planted situations the tasks probe:
//  - customer 4 and customer 9 share the email "rmoreno@example.com" (duplicate).
//  - products 5 and 8 carry negative stock from an oversell.
//  - several orders sit in "processing" with old created_at values.
//  - order 1007 is "paid" and has no refund yet.
const CUSTOMERS = [
  [1, "Ada Okafor", "ada.okafor@example.com", "NG", "2025-11-02"],
  [2, "Lin Zhao", "lin.zhao@example.com", "CN", "2025-12-14"],
  [3, "Priya Nair", "priya.nair@example.com", "IN", "2026-01-09"],
  [4, "Rafael Moreno", "rmoreno@example.com", "MX", "2026-01-20"],
  [5, "Sofia Bianchi", "sofia.b@example.com", "IT", "2026-02-01"],
  [6, "Tomas Novak", "tnovak@example.com", "CZ", "2026-02-18"],
  [7, "Hana Sato", "hana.sato@example.com", "JP", "2026-03-03"],
  [8, "Omar Haddad", "omar.haddad@example.com", "JO", "2026-03-22"],
  [9, "Rafael Moreno", "rmoreno@example.com", "MX", "2026-04-11"],
];

const PRODUCTS = [
  [1, "Aero Desk Lamp", "lighting", 48.0, 120],
  [2, "Nimbus Floor Lamp", "lighting", 139.0, 34],
  [3, "Quill Mechanical Keyboard", "peripherals", 96.0, 75],
  [4, "Quill Wrist Rest", "peripherals", 22.0, 200],
  [5, "Orbit Wireless Mouse", "peripherals", 54.0, -6],
  [6, "Strata Standing Desk", "furniture", 410.0, 12],
  [7, "Strata Desk Mat", "furniture", 35.0, 88],
  [8, "Lumen Monitor Light Bar", "lighting", 78.0, -3],
  [9, "Cedar Bookshelf", "furniture", 165.0, 19],
  [10, "Pixel 4K Webcam", "peripherals", 119.0, 41],
];

const ORDERS = [
  [1001, 1, "delivered", 144.0, "2026-03-10"],
  [1002, 2, "delivered", 410.0, "2026-03-28"],
  [1003, 3, "processing", 96.0, "2026-04-02"],
  [1004, 4, "delivered", 187.0, "2026-04-15"],
  [1005, 5, "cancelled", 139.0, "2026-04-20"],
  [1006, 6, "processing", 54.0, "2026-04-25"],
  [1007, 7, "paid", 235.0, "2026-05-01"],
  [1008, 8, "processing", 78.0, "2026-05-04"],
  [1009, 1, "delivered", 119.0, "2026-05-09"],
  [1010, 2, "paid", 165.0, "2026-05-12"],
  [1011, 3, "processing", 35.0, "2026-05-14"],
  [1012, 9, "delivered", 220.0, "2026-05-18"],
  [1013, 5, "delivered", 96.0, "2026-05-22"],
  [1014, 6, "paid", 410.0, "2026-05-26"],
  [1015, 7, "processing", 48.0, "2026-06-01"],
  [1016, 8, "delivered", 119.0, "2026-06-05"],
  [1017, 4, "paid", 54.0, "2026-06-08"],
  [1018, 9, "processing", 165.0, "2026-06-11"],
];

const ORDER_ITEMS = [
  [1, 1001, 1, 3, 48.0],
  [2, 1002, 6, 1, 410.0],
  [3, 1003, 3, 1, 96.0],
  [4, 1004, 9, 1, 165.0],
  [5, 1004, 4, 1, 22.0],
  [6, 1005, 2, 1, 139.0],
  [7, 1006, 5, 1, 54.0],
  [8, 1007, 8, 1, 78.0],
  [9, 1007, 10, 1, 119.0],
  [10, 1007, 7, 1, 35.0],
  [11, 1008, 8, 1, 78.0],
  [12, 1009, 10, 1, 119.0],
  [13, 1010, 9, 1, 165.0],
  [14, 1011, 7, 1, 35.0],
  [15, 1012, 9, 1, 165.0],
  [16, 1012, 5, 1, 54.0],
  [17, 1013, 3, 1, 96.0],
  [18, 1014, 6, 1, 410.0],
  [19, 1015, 1, 1, 48.0],
  [20, 1016, 10, 1, 119.0],
  [21, 1017, 5, 1, 54.0],
  [22, 1018, 9, 1, 165.0],
];

const REFUNDS: unknown[][] = [
  [1, 1005, 139.0, "order cancelled before fulfilment", "2026-04-21"],
];

export type Db = InstanceType<typeof alasql.Database>;

// Build a fresh, isolated database seeded from the fixtures above. Each call
// returns a brand new instance, which is what makes the environment resettable:
// the verifier seeds its own copy to compute ground truth, and every run gets a
// clean state with no cross-run leakage.
export function seedDatabase(): Db {
  const db = new alasql.Database();
  db.exec(
    "CREATE TABLE customers (id INT, name STRING, email STRING, country STRING, created_at STRING)"
  );
  db.exec(
    "CREATE TABLE products (id INT, name STRING, category STRING, price NUMBER, stock INT)"
  );
  db.exec(
    "CREATE TABLE orders (id INT, customer_id INT, status STRING, order_total NUMBER, created_at STRING)"
  );
  db.exec(
    "CREATE TABLE order_items (id INT, order_id INT, product_id INT, qty INT, unit_price NUMBER)"
  );
  db.exec(
    "CREATE TABLE refunds (id INT, order_id INT, amount NUMBER, reason STRING, created_at STRING)"
  );

  insertRows(db, "customers", CUSTOMERS);
  insertRows(db, "products", PRODUCTS);
  insertRows(db, "orders", ORDERS);
  insertRows(db, "order_items", ORDER_ITEMS);
  insertRows(db, "refunds", REFUNDS);
  return db;
}

function insertRows(db: Db, table: string, rows: unknown[][]): void {
  for (const row of rows) {
    const placeholders = row.map(() => "?").join(", ");
    db.exec(`INSERT INTO ${table} VALUES (${placeholders})`, row);
  }
}
