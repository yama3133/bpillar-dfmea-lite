"""Local CLI: run the full analysis + validation against a local TTL and real Amazon Bedrock."""

from __future__ import annotations

import argparse
import json
import sys
import time

from .agents.orchestrator import run_analysis
from .i18n import DEFAULT_LANGUAGE, LANGUAGES
from .ontology.store import OntologyStore
from .ontology.validate import validate_findings


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="dfmea")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("--ttl", required=True)
    a.add_argument("--preset", required=True)
    a.add_argument("--json-out")
    a.add_argument("--language", choices=LANGUAGES, default=DEFAULT_LANGUAGE)
    args = ap.parse_args(argv)

    store = OntologyStore.from_file(args.ttl)
    preset = json.load(open(args.preset, encoding="utf-8"))
    t0 = time.monotonic()

    def emit(t: str, data: dict) -> None:
        print(f"[{time.monotonic() - t0:7.1f}s] {t} {json.dumps(data, ensure_ascii=False)[:200]}", file=sys.stderr)

    print(f"ontology versionInfo={store.version_info} sha256={store.sha256[:12]}", file=sys.stderr)
    res = run_analysis(store, preset["componentIri"], preset["scenario"], emit, language=args.language)
    findings = [f.model_dump() for f in res.findings.findings]
    vals = validate_findings(store, findings)
    accepted = sum(1 for v in vals if v["status"] == "accepted")
    for f, v in zip(findings, vals):
        rpn = f["severity"] * f["occurrence"] * f["detection"]
        print(f"{f['finding_id']:>4} {v['code']:<20} RPN={rpn:<4} conf={f['confidence']:.2f} "
              f"fm={f['failure_mode_iri'].rsplit('/', 1)[-1]} path={[p.rsplit('/', 1)[-1] for p in f['cause_path']]}")
        if v["code"] != "OK":
            print(f"      {v['detail']}")
    summary = {
        "findings": len(findings),
        "accepted": accepted,
        "rejected": len(findings) - accepted,
        "elapsedSec": res.elapsed_sec,
        "usage": res.usage,
    }
    print(json.dumps(summary, indent=2))
    if args.json_out:
        json.dump({"summary": summary, "findings": findings, "validation": vals}, open(args.json_out, "w"), indent=2)
    return 0 if findings else 1


if __name__ == "__main__":
    raise SystemExit(main())
