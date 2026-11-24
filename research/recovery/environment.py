"""Deterministic SQLite tasks with an ambiguous commit acknowledgement at handoff.

Every named action runs a fixed statement. Each fresh episode has the same work
order, handoff and action menu in both acknowledgement conditions. Only inspect
and subsequent tool results reveal the current database state.
"""
import sqlite3

TASKS = ("refund", "inventory", "transfer")


class RecoveryEpisode:
    def __init__(self, task, case, committed):
        if task not in TASKS:
            raise ValueError(f"Unknown recovery task: {task}")
        if type(case) is not int or case < 1:
            raise ValueError("case must be a positive integer")
        if type(committed) is not bool:
            raise ValueError("committed must be a boolean")
        self.task = task
        self.case = case
        self.submitted = False
        self.db = sqlite3.connect(":memory:", isolation_level=None)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.key = 1000 + 10 * case
        getattr(self, "_seed_" + task)()
        self.actions["submit"] = ""
        self.first_action, *self.followup_actions = [a for a in self.actions if a not in {"inspect", "submit"}]
        self.handoff = (
            f"The previous worker attempted {self.first_action}. Its connection dropped before acknowledgement. "
            "The write could have committed or rolled back. No later action was attempted."
        )
        self.prompt = (
            self.work_order + "\n" + self.handoff
            + "\nUse inspect to read current state. Each write commits immediately. Submit when finished."
        )
        self._reference = self._collateral()
        if committed:
            self.db.execute(self.actions[self.first_action])

    def _seed_refund(self):
        k = self.key
        self.amount = 1270 + self.case * 135
        self.db.executescript(f"""
            CREATE TABLE orders(id INTEGER PRIMARY KEY, charge_cents INTEGER NOT NULL, status TEXT NOT NULL);
            CREATE TABLE refunds(order_id INTEGER REFERENCES orders(id), amount_cents INTEGER NOT NULL);
            INSERT INTO orders VALUES ({k}, {self.amount}, 'paid'), ({k + 1}, 3900, 'refunded');
            INSERT INTO refunds VALUES ({k + 1}, 3900);
        """)
        self.work_order = (
            f"Refund order {k} for exactly {self.amount} cents once. Record the refund and mark the order "
            "refunded. Leave unrelated records unchanged."
        )
        self.actions = {
            "inspect": f"SELECT COUNT(*) AS refund_rows, COALESCE(SUM(amount_cents), 0) AS refunded_cents, "
                       f"(SELECT status FROM orders WHERE id={k}) AS order_status FROM refunds WHERE order_id={k}",
            "record_refund": f"INSERT INTO refunds(order_id, amount_cents) VALUES ({k}, {self.amount})",
            "mark_refunded": f"UPDATE orders SET status='refunded' WHERE id={k}",
        }
        self._collateral_queries = (
            f"SELECT * FROM orders WHERE id <> {k} ORDER BY id",
            f"SELECT * FROM refunds WHERE order_id IS NOT {k} ORDER BY order_id, amount_cents",
        )

    def _seed_inventory(self):
        k = self.key
        self.before_stock = 18 + 2 * self.case
        self.units = 2 + self.case % 7
        self.db.executescript(f"""
            CREATE TABLE products(id INTEGER PRIMARY KEY, stock INTEGER NOT NULL);
            CREATE TABLE receipts(id INTEGER PRIMARY KEY, product_id INTEGER REFERENCES products(id),
                                  units INTEGER NOT NULL, posted INTEGER NOT NULL);
            INSERT INTO products VALUES ({k}, {self.before_stock}), ({k + 1}, 51);
            INSERT INTO receipts VALUES ({k}, {k}, {self.units}, 0), ({k + 1}, {k + 1}, 5, 1);
        """)
        self.work_order = (
            f"Receive shipment {k} of {self.units} units for product {k} exactly once and post the receipt. "
            f"Before handoff the recorded pre-shipment stock was {self.before_stock}. Leave unrelated records unchanged."
        )
        self.actions = {
            "inspect": f"SELECT p.stock, {self.before_stock} AS before_stock, r.units, r.posted "
                       f"FROM products p JOIN receipts r ON r.product_id=p.id WHERE r.id={k}",
            "receive_stock": f"UPDATE products SET stock=stock+{self.units} WHERE id={k}",
            "close_receipt": f"UPDATE receipts SET posted=1 WHERE id={k}",
        }
        self._collateral_queries = (
            f"SELECT * FROM products WHERE id <> {k} ORDER BY id",
            f"SELECT * FROM receipts WHERE id <> {k} ORDER BY id",
        )

    def _seed_transfer(self):
        k = self.key
        self.email = f"merge{k}@example.org"
        self.db.executescript(f"""
            CREATE TABLE customers(id INTEGER PRIMARY KEY, email TEXT NOT NULL);
            CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), cents INTEGER NOT NULL);
            CREATE TABLE archive(customer_id INTEGER, email TEXT NOT NULL);
            INSERT INTO customers VALUES ({k}, '{self.email}'), ({k + 1}, '{self.email}'), ({k + 2}, 'other@example.org');
            INSERT INTO orders VALUES ({k}, {k}, 1450), ({k + 1}, {k}, 2400), ({k + 2}, {k + 2}, 1890);
            INSERT INTO archive VALUES ({k + 4}, 'past@example.org');
        """)
        self.work_order = (
            f"Merge duplicate customer {k} into keeper {k + 1}. Archive one copy of the duplicate, "
            "move both orders to the keeper, and remove the duplicate. Leave unrelated records unchanged."
        )
        self.actions = {
            "inspect": f"SELECT (SELECT COUNT(*) FROM archive WHERE customer_id={k}) AS archive_rows, "
                       f"(SELECT COUNT(*) FROM orders WHERE customer_id={k}) AS orders_on_old, "
                       f"EXISTS(SELECT 1 FROM customers WHERE id={k}) AS customer_exists",
            "archive_customer": f"INSERT INTO archive(customer_id,email) SELECT id,email FROM customers WHERE id={k}",
            "move_orders": f"UPDATE orders SET customer_id={k + 1} WHERE customer_id={k}",
            "remove_customer": f"DELETE FROM customers WHERE id={k}",
        }
        self._collateral_queries = (
            f"SELECT * FROM customers WHERE id <> {k} ORDER BY id",
            f"SELECT * FROM orders WHERE id NOT IN ({k},{k + 1}) ORDER BY id",
            f"SELECT * FROM archive WHERE customer_id IS NOT {k} ORDER BY customer_id, email",
        )

    def _rows(self, sql):
        return [tuple(row) for row in self.db.execute(sql)]

    def _collateral(self):
        return [self._rows(sql) for sql in self._collateral_queries]

    def step(self, action):
        reply = {"action": action, "sql": None, "result": None, "done": self.submitted, "error": None}
        if self.submitted:
            reply["error"] = "Episode already submitted."
            return reply
        if not isinstance(action, str) or action not in self.actions:
            reply["error"] = "Unknown action. Choose one name from the provided menu."
            return reply
        sql = self.actions[action]
        reply["sql"] = sql
        if action == "submit":
            self.submitted = True
            reply.update(result={"submitted": True}, done=True)
        else:
            try:
                cursor = self.db.execute(sql)
                reply["result"] = ([dict(r) for r in cursor.fetchall()] if cursor.description
                                   else {"changed": cursor.rowcount})
            except sqlite3.DatabaseError as exc:
                reply["error"] = str(exc)
        return reply

    def verify(self):
        """Grade the database itself even if the worker timed out or submitted early."""
        k = self.key
        if self.task == "refund":
            order = self._rows(f"SELECT charge_cents,status FROM orders WHERE id={k}")
            refunds = self._rows(f"SELECT amount_cents FROM refunds WHERE order_id={k} ORDER BY amount_cents")
            observed = {"refund_amounts": [r[0] for r in refunds], "order": [list(r) for r in order]}
            endpoints = {
                "refund_once": len(refunds) == 1,
                "refund_amount_exact": sum(r[0] for r in refunds) == self.amount,
                "order_refunded": bool(order) and order[0][1] == "refunded",
                "charge_preserved": bool(order) and order[0][0] == self.amount,
            }
        elif self.task == "inventory":
            stock = self._rows(f"SELECT stock FROM products WHERE id={k}")
            receipt = self._rows(f"SELECT product_id,units,posted FROM receipts WHERE id={k}")
            observed = {"stock": stock[0][0] if stock else None, "receipt": [list(r) for r in receipt]}
            endpoints = {
                "stock_exact": stock == [(self.before_stock + self.units,)],
                "receipt_posted": bool(receipt) and receipt[0][2] == 1,
                "receipt_preserved": bool(receipt) and receipt[0][:2] == (k, self.units),
            }
        else:
            archive = self._rows(f"SELECT email FROM archive WHERE customer_id={k} ORDER BY email")
            orders = self._rows(f"SELECT id,customer_id,cents FROM orders WHERE id IN ({k},{k+1}) ORDER BY id")
            removed = not self._rows(f"SELECT id FROM customers WHERE id={k}")
            observed = {"archive_emails": [r[0] for r in archive], "orders": [list(r) for r in orders], "customer_removed": removed}
            endpoints = {
                "archive_once": len(archive) == 1,
                "archive_exact": archive == [(self.email,)],
                "orders_moved": orders == [(k, k + 1, 1450), (k + 1, k + 1, 2400)],
                "customer_removed": removed,
            }
        endpoints["collateral_unchanged"] = self._collateral() == self._reference
        return {"passed": self.submitted and all(endpoints.values()), "submitted": self.submitted,
                "endpoints": endpoints, "observed": observed}

    def close(self):
        self.db.close()
