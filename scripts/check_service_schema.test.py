import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_service_schema import validate_file

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "schema.service.json"


class ServiceSchemaTest(unittest.TestCase):
    def test_published_schema_is_valid(self):
        self.assertEqual(validate_file(SCHEMA), [])

    def test_broken_keyword_value_is_rejected(self):
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        schema["type"] = 123
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "broken.json"
            path.write_text(json.dumps(schema), encoding="utf-8")
            problems = validate_file(path)
        self.assertTrue(any("meta-schema" in problem for problem in problems))

    def test_wrong_draft_is_rejected(self):
        schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
        schema["$schema"] = "http://json-schema.org/draft-04/schema#"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "draft4.json"
            path.write_text(json.dumps(schema), encoding="utf-8")
            problems = validate_file(path)
        self.assertTrue(any("draft-07" in problem for problem in problems))


if __name__ == "__main__":
    unittest.main()
