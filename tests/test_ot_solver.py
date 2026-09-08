"""Compare the browser OT port with the bot: python3 tests/test_ot_solver.py.

Uses the sibling fish checkout without importing Discord or starting the bot.
"""
import ast
import functools
import json
from pathlib import Path
import random
import subprocess


def main():
    root = Path(__file__).resolve().parents[1]
    source = root.parent / "fish/src/extensions/mudae/sphere.py"
    names = {
        "_ot_line_masks", "_ot_required_masks", "_ot_layout_statistics",
        "_ot_recommendations", "_ot_random_layout", "_ot_initial_recommendations",
    }
    namespace = {
        "random": random, "lru_cache": functools.lru_cache, "GRID_SIZE": 5,
        "OT_COMMON_SHIPS": (("teal", 4), ("green", 3), ("yellow", 3)),
        "OT_BOARD_MASK": (1 << 25) - 1, "OT_LAYOUT_NODE_LIMIT": 1_000_000,
        "OT_INITIAL_SAMPLE_COUNT": 10_000, "_from_rc": lambda r, c: r * 5 + c,
    }
    tree = ast.parse(source.read_text())
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(ast.Module(body=functions, type_ignores=[]), str(source), "exec"), namespace)
    cases = []
    for count in range(6, 10):
        board = namespace["_ot_random_layout"](count, rng=random.Random(count))
        cases.extend([
            ({}, count),
            ({12: "teal"}, count),
            ({0: "teal", 24: "teal"}, count),  # impossible straight line
            ({position: board[position] for position in range(15)}, count),
            (board, count),
        ])
    cases.append(({0: "orange", 1: "light", 2: "purple"}, 6))  # too many rare colors
    actual = json.loads(subprocess.check_output([
        "node", "-e",
        "const {analyzeOT}=require('./src/ot-solver.js');"
        "const cases=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        "console.log(JSON.stringify(cases.map(([r,n])=>analyzeOT(r,n))));",
    ], input=json.dumps(cases).encode(), cwd=root))
    for (revealed, count), result in zip(cases, actual, strict=True):
        safe, danger, ranked, probabilities, complete = namespace["_ot_recommendations"](revealed, count)
        assert result["safe"] == sorted(safe), (revealed, count, "safe")
        assert result["danger"] == sorted(danger), (revealed, count, "danger")
        assert result["ranked"] == ranked, (revealed, count, "ranked")
        assert result["probabilities"] == {str(p): value for p, value in probabilities.items()}, (revealed, count, "probabilities")
        assert result["complete"] == complete, (revealed, count, "complete")
    print(f"All {len(cases)} OT boards match the bot, including exact and bounded searches.")


if __name__ == "__main__":
    main()
