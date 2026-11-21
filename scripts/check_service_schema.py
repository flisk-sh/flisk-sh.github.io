"""Validate schema.service.json against the JSON Schema draft-07 meta-schema."""

import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator, SchemaError

DRAFT_07 = "http://json-schema.org/draft-07/schema#"


def validate_file(path):
    problems = []
    try:
        schema = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        return [f"cannot read schema: {error}"]

    declared = schema.get("$schema") if isinstance(schema, dict) else None
    if declared not in (DRAFT_07, DRAFT_07.replace("http:", "https:")):
        problems.append(f"$schema must declare draft-07, found {declared!r}")

    try:
        Draft7Validator.check_schema(schema)
    except SchemaError as error:
        problems.append(f"schema fails the draft-07 meta-schema: {error.message}")

    return problems


def main():
    path = Path(__file__).resolve().parent.parent / "schema.service.json"
    problems = validate_file(path)
    if problems:
        for problem in problems:
            print(problem, file=sys.stderr)
        return 1
    print(f"{path} is a valid draft-07 JSON Schema")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
