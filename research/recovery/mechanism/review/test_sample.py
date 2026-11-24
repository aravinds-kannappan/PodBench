"""Verify sample coverage using artificial rows that are never published as ratings."""
import itertools
import unittest
from collections import Counter
from generate import GROUP, select


class TestSample(unittest.TestCase):
    def test_balanced_margins_and_blind_label_coverage(self):
        rows = []
        for index, cell in enumerate(itertools.product(("m","n"),("a","b"),("r","s","t"),("0","1"),range(8))):
            rows.append(dict(zip(GROUP, cell[:4]), id=f"test{index:03}", failure_label="rare" if index == 1 else "common"))
        picked = select(rows)
        self.assertEqual(picked, select(list(reversed(rows))))
        self.assertEqual(len({r["id"] for r in picked}), 60)
        self.assertEqual({r["failure_label"] for r in picked}, {"rare","common"})
        for factor in GROUP:
            counts = Counter(row[factor] for row in picked)
            self.assertEqual(len(set(counts.values())), 1)
        self.assertEqual(set(Counter(tuple(r[k] for k in GROUP) for r in picked).values()), {2,3})
