import scripts.filter_semgrep_results as semgrep_filter


def test_format_finding_includes_required_fields():
    finding = {
        "path": "api.py",
        "start": {"line": 42},
        "check_id": "python.lang.security.audit.eval-use.eval-use",
        "extra": {
            "severity": "ERROR",
            "message": "User-controlled input reaches eval.",
        },
    }

    formatted = semgrep_filter.format_finding(finding)

    assert formatted == (
        "[ERROR] api.py:42 python.lang.security.audit.eval-use.eval-use"
        " :: User-controlled input reaches eval."
    )


def test_is_new_finding_filters_to_changed_lines():
    ranges_by_file = {"api.py": [(10, 12)]}

    assert semgrep_filter.is_new_finding({"path": "api.py", "start": {"line": 11}}, ranges_by_file) is True
    assert semgrep_filter.is_new_finding({"path": "api.py", "start": {"line": 25}}, ranges_by_file) is False
    assert semgrep_filter.is_new_finding({"path": "dashboard/lib/date.js", "start": {"line": 11}}, ranges_by_file) is False


def test_main_fails_with_diagnosable_output_when_severity_is_missing(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("BASE_SHA", raising=False)
    (tmp_path / "semgrep-results.json").write_text(
        """
        {
          "results": [
            {
              "path": "dashboard/lib/use-live-alerts.js",
              "start": {"line": 17},
              "check_id": "javascript.lang.security.audit.detect-eval-with-expression.detect-eval-with-expression",
              "extra": {"message": "Avoid eval()."}
            }
          ]
        }
        """.strip(),
        encoding="utf-8",
    )

    exit_code = semgrep_filter.main()
    output = capsys.readouterr().out

    assert exit_code == 1
    assert "Blocking Semgrep findings with missing severity metadata:" in output
    assert (
        "[UNKNOWN] dashboard/lib/use-live-alerts.js:17 "
        "javascript.lang.security.audit.detect-eval-with-expression.detect-eval-with-expression"
        " :: Avoid eval()."
    ) in output
