#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys


HIGH_LEVELS = {"HIGH", "CRITICAL", "ERROR"}


def load_results(path: str) -> list[dict]:
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data.get("results", [])


def changed_line_ranges(base_sha: str) -> dict[str, list[tuple[int, int]]]:
    if not base_sha:
        return {}
    try:
        changed_files = subprocess.check_output(
            ["git", "diff", "--name-only", f"{base_sha}...HEAD"],
            text=True,
        ).splitlines()
    except subprocess.CalledProcessError as exc:
        print(f"Could not load changed files against {base_sha}: {exc}. Falling back to all findings.")
        return {}

    file_ranges: dict[str, list[tuple[int, int]]] = {}
    for path in changed_files:
        normalized_path = os.path.normpath(path).strip()
        if not normalized_path or normalized_path.startswith("..") or os.path.isabs(normalized_path):
            continue
        try:
            diff_text = subprocess.check_output(
                ["git", "diff", "--unified=0", f"{base_sha}...HEAD", "--", normalized_path],
                text=True,
            )
        except subprocess.CalledProcessError:
            continue
        file_ranges.setdefault(normalized_path, [])
        for line in diff_text.splitlines():
            if not line.startswith("@@"):
                continue
            match = re.search(r"\+(\d+)(?:,(\d+))?", line)
            if not match:
                continue
            start = int(match.group(1))
            length = int(match.group(2) or "1")
            if length <= 0:
                continue
            file_ranges[normalized_path].append((start, start + length - 1))
    return file_ranges


def is_new_finding(item: dict, ranges_by_file: dict[str, list[tuple[int, int]]]) -> bool:
    if not ranges_by_file:
        return True
    path = item.get("path")
    if not path or path not in ranges_by_file:
        return False
    start = ((item.get("start") or {}).get("line")) or ((item.get("extra") or {}).get("lines")) or 0
    try:
        line_number = int(start)
    except Exception:
        line_number = 0
    if line_number <= 0:
        return False
    return any(lo <= line_number <= hi for lo, hi in ranges_by_file[path])


def main() -> int:
    results = load_results("semgrep-results.json")
    if not results:
        print("No Semgrep findings.")
        return 0

    changed_ranges = changed_line_ranges(os.environ.get("BASE_SHA", "").strip())
    scoped_results = [item for item in results if is_new_finding(item, changed_ranges)]
    if changed_ranges and not scoped_results:
        print("Semgrep findings exist, but none land on lines changed by this PR. Passing.")
        return 0

    severities = []
    for item in scoped_results:
        extra = item.get("extra", {}) if isinstance(item, dict) else {}
        severity = str(extra.get("severity", "")).upper()
        if severity:
            severities.append(severity)

    if severities:
        high = [severity for severity in severities if severity in HIGH_LEVELS]
        if high:
            print(
                f"Semgrep found {len(scoped_results)} findings on PR-changed lines; "
                f"{len(high)} are high/critical/error. Failing."
            )
            return 1
        print(f"Semgrep found {len(scoped_results)} findings on PR-changed lines; none are high/critical/error. Passing.")
        return 0

    print("Semgrep findings on PR-changed lines do not include severity metadata; failing on any findings.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
