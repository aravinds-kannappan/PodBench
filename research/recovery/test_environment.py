import unittest

from research.recovery.environment import RecoveryEpisode, TASKS


class RecoveryEnvironmentTest(unittest.TestCase):
    cases = (11, 23, 37, 53)

    def episode(self, task, case=11, committed=False):
        episode = RecoveryEpisode(task, case, committed)
        self.addCleanup(episode.close)
        return episode

    def execute(self, episode, *actions):
        for action in actions:
            reply = episode.step(action)
            self.assertIsNone(reply["error"], (action, reply))

    def finish_pending(self, episode):
        self.execute(episode, *episode.followup_actions, "submit")

    def test_acknowledgements_are_identical_and_inspection_is_read_only(self):
        for task in TASKS:
            for case in self.cases:
                with self.subTest(task=task, case=case):
                    rolled_back = self.episode(task, case)
                    committed = self.episode(task, case, True)
                    self.assertEqual(rolled_back.prompt, committed.prompt)
                    self.assertEqual(rolled_back.actions, committed.actions)
                    self.assertIn(rolled_back.first_action, rolled_back.handoff)
                    self.assertNotEqual(rolled_back.step("inspect"), committed.step("inspect"))
                    self.assertEqual(committed.step("inspect"), committed.step("inspect"))
                    self.execute(rolled_back, rolled_back.first_action)
                    self.assertEqual(rolled_back.verify(), committed.verify())

    def test_exactly_one_effect_followups_and_submit_succeed(self):
        for task in TASKS:
            for case in self.cases:
                for initial in (False, True):
                    with self.subTest(task=task, case=case, committed=initial):
                        episode = self.episode(task, case, initial)
                        if not initial:
                            self.execute(episode, episode.first_action)
                        self.finish_pending(episode)
                        self.assertTrue(episode.verify()["passed"], episode.verify())

    def test_duplicate_and_omission_fail_while_reconciliation_finishes(self):
        primary_endpoint = {"refund": "refund_once", "inventory": "stock_exact", "transfer": "archive_once"}
        for task in TASKS:
            for committed in (True, False):
                with self.subTest(task=task, committed=committed):
                    episode = self.episode(task, committed=committed)
                    if committed:
                        self.execute(episode, episode.first_action)
                    self.finish_pending(episode)
                    verdict = episode.verify()
                    self.assertFalse(verdict["passed"])
                    self.assertFalse(verdict["endpoints"][primary_endpoint[task]])
                    self.assertTrue(verdict["endpoints"]["collateral_unchanged"])

    def test_missing_submit_and_incomplete_reconciliation(self):
        for task in TASKS:
            with self.subTest(task=task):
                pending = self.episode(task, committed=True)
                self.execute(pending, "submit")
                self.assertFalse(pending.verify()["passed"])
                complete = self.episode(task, committed=True)
                self.execute(complete, *complete.followup_actions)
                verdict = complete.verify()
                self.assertFalse(verdict["passed"])
                self.assertTrue(all(verdict["endpoints"].values()))

    def test_protected_rows_are_verified(self):
        for task in TASKS:
            with self.subTest(task=task):
                episode = self.episode(task, committed=True)
                k = episode.key
                corrupt = {
                    "refund": f"UPDATE orders SET status='paid' WHERE id={k + 1}",
                    "inventory": f"UPDATE products SET stock=stock-1 WHERE id={k + 1}",
                    "transfer": f"DELETE FROM orders WHERE id={k + 2}",
                }
                self.finish_pending(episode)
                episode.db.execute(corrupt[task])
                self.assertFalse(episode.verify()["endpoints"]["collateral_unchanged"])
                self.assertFalse(episode.verify()["passed"])

    def test_target_payload_is_verified(self):
        for task in TASKS:
            with self.subTest(task=task):
                episode = self.episode(task, committed=True)
                self.finish_pending(episode)
                k = episode.key
                corrupt = {
                    "refund": (f"UPDATE refunds SET amount_cents=1 WHERE order_id={k}", "refund_amount_exact"),
                    "inventory": (f"UPDATE receipts SET units=units+1 WHERE id={k}", "receipt_preserved"),
                    "transfer": (f"UPDATE orders SET cents=0 WHERE id={k}", "orders_moved"),
                }
                query, endpoint = corrupt[task]
                episode.db.execute(query)
                verdict = episode.verify()
                self.assertFalse(verdict["passed"])
                self.assertFalse(verdict["endpoints"][endpoint])

    def test_invalid_and_post_submit_actions_do_not_execute(self):
        episode = self.episode("refund")
        before = episode.verify()
        self.assertTrue(episode.step("unlisted_action")["error"])
        self.assertEqual(before, episode.verify())
        self.execute(episode, "submit")
        submitted = episode.verify()
        self.assertTrue(episode.step(episode.first_action)["error"])
        self.assertEqual(submitted, episode.verify())

    def test_transfer_refuses_to_delete_a_customer_with_active_orders(self):
        episode = self.episode("transfer")
        before = episode.verify()
        self.assertTrue(episode.step("remove_customer")["error"])
        self.assertEqual(before, episode.verify())
        self.execute(episode, episode.first_action)
        self.finish_pending(episode)
        self.assertTrue(episode.verify()["passed"])


if __name__ == "__main__":
    unittest.main()
