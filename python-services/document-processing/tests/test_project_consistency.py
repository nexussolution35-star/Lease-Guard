"""Guards against drift between this service and the rest of the repository.

The TypeScript files in `packages/domain/src/types` are the authoritative wire contract. They are
parsed here (comments stripped, brackets matched, string literals tokenised) rather than matched
with ad-hoc regular expressions, and compared exactly with the Python Literals and with the JSON
schemas the models actually serialise.
"""

import json
import re
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, get_args

import pytest
from pydantic import BaseModel

from app.main import app
from app.schemas.v1 import (
    ZAR_DECIMAL_PATTERN,
    ErrorCode,
    ErrorResponse,
    ExtractedField,
    ExtractionFieldName,
    ExtractionResult,
    ExtractionStatus,
    FinancialFieldName,
    Issue,
    IssueCode,
    IssueSeverity,
    LineItem,
    LineItemCategory,
    LineItemKind,
    StatementSource,
)

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DOMAIN_TYPES = SERVICE_ROOT.parents[1] / "packages/domain/src/types"
STATEMENT_TS = DOMAIN_TYPES / "statement.ts"
EXTRACTION_TS = DOMAIN_TYPES / "extraction.ts"

requires_domain = pytest.mark.skipif(
    not (STATEMENT_TS.is_file() and EXTRACTION_TS.is_file()),
    reason="packages/domain is not present (service checked out on its own)",
)


# --- A small TypeScript reader: enough for `as const` tuples and flat interfaces. ---------------

_STRING = r"'(?:[^'\\]|\\.)*'|\"(?:[^\"\\]|\\.)*\"|`(?:[^`\\]|\\.)*`"
_TOKENS = re.compile(rf"(?P<string>{_STRING})|(?P<line>//[^\n]*)|(?P<block>/\*.*?\*/)", re.S)
_OPENERS = {"[": "]", "{": "}", "(": ")", "<": ">"}


def strip_comments(source: str) -> str:
    """Remove `//` and `/* */` comments, leaving string literals (which may contain `//`) intact."""

    def keep(match: re.Match[str]) -> str:
        return match.group("string") or ("\n" * match.group().count("\n"))

    return _TOKENS.sub(keep, source)


def _matching(source: str, start: int) -> int:
    """Index of the bracket closing the one at `start`, skipping string literals."""
    opener = source[start]
    closer = _OPENERS[opener]
    depth = 0
    position = start
    while position < len(source):
        string = re.compile(_STRING).match(source, position)
        if string:
            position = string.end()
            continue
        char = source[position]
        if char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return position
        position += 1
    raise AssertionError(f"unbalanced {opener!r} at offset {start}")


def ts_const_tuple(source: str, name: str) -> tuple[str, ...]:
    """Elements of `export const NAME = [...] as const`; each must be a string literal."""
    declaration = re.search(rf"\bexport\s+const\s+{name}\s*=\s*\[", source)
    assert declaration, f"export const {name} = [...] not found"
    start = declaration.end() - 1
    end = _matching(source, start)
    assert re.match(r"\s*as\s+const\b", source[end + 1 :]), f"{name} is not declared `as const`"
    body = source[start + 1 : end]
    elements = [element.strip() for element in body.split(",") if element.strip()]
    values: list[str] = []
    for element in elements:
        assert re.fullmatch(_STRING, element), f"{name}: {element!r} is not a string literal"
        values.append(element[1:-1])
    assert len(values) == len(set(values)), f"{name} has duplicate entries"
    return tuple(values)


@dataclass(frozen=True)
class TsProperty:
    name: str
    optional: bool
    type: str

    @property
    def nullable(self) -> bool:
        return "null" in re.split(r"\s*\|\s*", self.type)


def ts_interface(source: str, name: str) -> dict[str, TsProperty]:
    """Properties of a flat `export interface NAME { ... }` (no index signatures or methods)."""
    declaration = re.search(rf"\bexport\s+interface\s+{name}\b[^{{]*\{{", source)
    assert declaration, f"export interface {name} not found"
    start = declaration.end() - 1
    body = source[start + 1 : _matching(source, start)]
    members: list[str] = []
    depth, current = 0, ""
    for char in body:
        if char in "[{(<":
            depth += 1
        elif char in "]})>":
            depth -= 1
        if depth == 0 and char in ";\n":
            members.append(current)
            current = ""
        else:
            current += char
    members.append(current)
    properties: dict[str, TsProperty] = {}
    for member in (m.strip() for m in members):
        if not member:
            continue
        parsed = re.fullmatch(r"(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*:\s*(.+)", member, re.S)
        assert parsed, f"{name}: cannot read member {member!r}"
        prop = TsProperty(
            parsed.group(1), parsed.group(2) == "?", " ".join(parsed.group(3).split())
        )
        assert prop.name not in properties, f"{name}.{prop.name} is declared twice"
        properties[prop.name] = prop
    assert properties, f"interface {name} has no properties"
    return properties


def test_typescript_reader_handles_comments_strings_and_nesting() -> None:
    source = strip_comments(
        """
        /** A doc comment with a fake `export const X = ['nope'] as const` inside. */
        export const X = [
          'a', // trailing comment
          "b//not-a-comment",
          /* inline */ 'c',
        ] as const satisfies readonly string[]
        export interface Y {
          /** comment: with colon */
          plain: string
          optional?: number | null
          readonly list: readonly Record<string, unknown>[] | null;
          nested: { inner: string; other: number }
        }
        """
    )
    assert ts_const_tuple(source, "X") == ("a", "b//not-a-comment", "c")
    members = ts_interface(source, "Y")
    assert list(members) == ["plain", "optional", "list", "nested"]
    assert members["optional"].optional and members["optional"].nullable
    assert members["list"].nullable and not members["list"].optional
    assert not members["plain"].nullable


# --- Enumerations -------------------------------------------------------------------------------

ENUMERATIONS: list[tuple[str, str, Any]] = [
    ("statement.ts", "STATEMENT_SOURCES", StatementSource),
    ("statement.ts", "EXTRACTION_FIELD_NAMES", ExtractionFieldName),
    ("statement.ts", "LINE_ITEM_CATEGORIES", LineItemCategory),
    ("statement.ts", "LINE_ITEM_KINDS", LineItemKind),
    ("extraction.ts", "EXTRACTION_RESULT_STATUSES", ExtractionStatus),
    ("extraction.ts", "EXTRACTION_ISSUE_CODES", IssueCode),
    ("extraction.ts", "EXTRACTION_ISSUE_SEVERITIES", IssueSeverity),
    ("extraction.ts", "DOCUMENT_PROCESSING_ERROR_CODES", ErrorCode),
    ("extraction.ts", "FINANCIAL_EXTRACTION_FIELDS", FinancialFieldName),
]


def _source(file_name: str) -> str:
    return strip_comments((DOMAIN_TYPES / file_name).read_text(encoding="utf-8"))


@requires_domain
@pytest.mark.parametrize(
    ("file_name", "const_name", "literal"), ENUMERATIONS, ids=[e[1] for e in ENUMERATIONS]
)
def test_enumerations_mirror_the_domain_package(
    file_name: str, const_name: str, literal: Any
) -> None:
    assert get_args(literal) == ts_const_tuple(_source(file_name), const_name)


# --- Response models ----------------------------------------------------------------------------

MODELS: list[tuple[str, type[BaseModel]]] = [
    ("DocumentExtractionResult", ExtractionResult),
    ("DocumentExtractionField", ExtractedField),
    ("DocumentExtractionLineItem", LineItem),
    ("DocumentExtractionIssue", Issue),
    ("DocumentProcessingErrorResponse", ErrorResponse),
]


def _serialisation_schema(model: type[BaseModel]) -> dict[str, Any]:
    return model.model_json_schema(mode="serialization", ref_template="{model}")


def _allows_null(schema: dict[str, Any]) -> bool:
    return schema.get("type") == "null" or any(
        option.get("type") == "null" for option in schema.get("anyOf", [])
    )


@requires_domain
@pytest.mark.parametrize(("interface", "model"), MODELS, ids=[m[0] for m in MODELS])
def test_response_models_serialise_exactly_the_interface_properties(
    interface: str, model: type[BaseModel]
) -> None:
    expected = ts_interface(_source("extraction.ts"), interface)
    schema = _serialisation_schema(model)
    properties: dict[str, dict[str, Any]] = schema["properties"]

    assert set(properties) == set(expected)
    # Non-optional TypeScript properties are always present in the JSON, even when null.
    required = {name for name, prop in expected.items() if not prop.optional}
    assert set(schema.get("required", [])) == required
    for name, prop in expected.items():
        assert _allows_null(properties[name]) == prop.nullable, f"{interface}.{name} nullability"
    # Each camelCase name maps to exactly one snake_case attribute.
    aliases = {
        field.serialization_alias or field.alias or attr: attr
        for attr, field in model.model_fields.items()
    }
    assert set(aliases) == set(expected)


@requires_domain
def test_money_fields_are_two_decimal_strings_like_zar_decimal() -> None:
    """The properties typed `ZarDecimal` in TypeScript are exactly the ones Python serialises
    only as 2-decimal strings (`DocumentExtractionField.value` may also be plain text)."""
    source = _source("extraction.ts")
    typescript_money = {
        (interface, name)
        for interface, _ in MODELS
        for name, prop in ts_interface(source, interface).items()
        if re.split(r"\s*\|\s*", prop.type)[0] == "ZarDecimal"
    }
    python_money: set[tuple[str, str]] = set()
    for interface, model in MODELS:
        for name, schema in _serialisation_schema(model)["properties"].items():
            strings = [o for o in schema.get("anyOf", [schema]) if o.get("type") == "string"]
            if strings and all(o.get("pattern") == ZAR_DECIMAL_PATTERN for o in strings):
                python_money.add((interface, name))
    assert typescript_money, "no ZarDecimal properties found"
    assert python_money == typescript_money
    assert ZAR_DECIMAL_PATTERN == r"^-?\d{1,13}\.\d{2}$"  # the pattern parseZarDecimal accepts


@requires_domain
def test_multipart_form_fields_match_the_request_interface() -> None:
    expected = ts_interface(_source("extraction.ts"), "DocumentExtractionRequest")
    operation = app.openapi()["paths"]["/v1/extractions"]["post"]
    reference = operation["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"]
    body = app.openapi()["components"]["schemas"][reference.rsplit("/", 1)[-1]]
    form_fields = set(body["properties"]) - {"file"}
    assert form_fields == set(expected)
    required = set(body["required"]) - {"file"}
    assert required == {name for name, prop in expected.items() if not prop.optional}


# --- Requirements lock --------------------------------------------------------------------------

LOCK_HEADER = (
    "# Generated by scripts/lock_requirements.py from pyproject.toml. Do not edit by hand."
)
_PIN = re.compile(r"(?P<name>[a-z0-9]+(?:-[a-z0-9]+)*)==(?P<version>\S+)")
# Final, pre- and post-releases (PEP 440 canonical form); no local versions or wildcards.
_VERSION = re.compile(
    r"(?:[0-9]+!)?[0-9]+(?:\.[0-9]+)*(?:(?:a|b|rc)[0-9]+)?(?:\.post[0-9]+)?(?:\.dev[0-9]+)?"
)


def canonical_name(name: str) -> str:
    """PEP 503 normalised project name: lowercase, runs of `-`, `_` and `.` become `-`."""
    return re.sub(r"[-_.]+", "-", name).lower()


def pin_problem(line: str) -> str | None:
    """Why a requirements line is not an exact, canonical `name==version` pin (None if it is)."""
    pin = _PIN.fullmatch(line)
    if pin is None:
        return "not a canonical lowercase `name==version` pin"
    version = pin.group("version")
    if not _VERSION.fullmatch(version):
        return f"invalid version {version!r}"
    if set(version.replace(".", "")) == {"0"}:
        return f"placeholder version {version!r}"
    return None


def _locked() -> dict[str, str]:
    lines = (SERVICE_ROOT / "requirements.txt").read_text(encoding="utf-8").splitlines()
    assert lines, "requirements.txt is empty"
    assert lines[0] == LOCK_HEADER, "requirements.txt is not generated by the lock script"
    locked: dict[str, str] = {}
    for number, line in enumerate(lines, start=1):
        if line.startswith("#"):
            continue
        problem = pin_problem(line)
        assert problem is None, f"requirements.txt:{number}: {line!r}: {problem}"
        name, _, version = line.partition("==")
        assert name not in locked, f"requirements.txt:{number}: {name} is pinned twice"
        locked[name] = version
    assert list(locked) == sorted(locked), "requirements.txt is not sorted by name"
    return locked


def _declared(requirements: list[str]) -> dict[str, str]:
    declared: dict[str, str] = {}
    for requirement in requirements:
        name, separator, version = requirement.partition("==")
        assert separator and _VERSION.fullmatch(version), f"{requirement!r} must be pinned with =="
        declared[canonical_name(name)] = version
    return declared


def test_requirements_lock_is_fully_pinned_and_matches_pyproject() -> None:
    pyproject = tomllib.loads((SERVICE_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    project = pyproject["project"]
    locked = _locked()
    for name, version in _declared(project["dependencies"]).items():
        assert locked.get(name) == version, f"re-run scripts/lock_requirements.py ({name})"
    assert canonical_name(project["name"]) not in locked, "the service itself must not be locked"
    # Dev tools are declared pinned too, and never reach the runtime image.
    dev = _declared(project["optional-dependencies"]["dev"])
    assert not set(dev) & set(locked), "dev dependencies leaked into the runtime lock"


@pytest.mark.parametrize(
    "line",
    [
        "fastapi",
        "h11==0",
        "pydantic_core==2.50.4",
        "Pillow==13.0.0",
        "pdfminer.six==20260107",
        "anyio>=4",
        "anyio==4.*",
        "anyio==4.16.0+local",
        "anyio==4.16.0 ; python_version >= '3.14'",
        "anyio == 4.16.0",
        "-e .",
        "",
    ],
)
def test_lock_rejects_unpinned_invalid_or_non_canonical_lines(line: str) -> None:
    assert pin_problem(line) is not None


@pytest.mark.parametrize(
    "line", ["pdfminer-six==20260107", "typing-extensions==4.16.0", "starlette==1.0.0rc1"]
)
def test_lock_accepts_canonical_pins(line: str) -> None:
    assert pin_problem(line) is None


def test_exported_openapi_document_is_current() -> None:
    exported = json.loads((SERVICE_ROOT / "openapi.json").read_text(encoding="utf-8"))
    assert exported == json.loads(json.dumps(app.openapi())), "re-run scripts/export_openapi.py"


def test_docker_base_image_is_pinned_and_documented_consistently() -> None:
    dockerfile = (SERVICE_ROOT / "Dockerfile").read_text(encoding="utf-8")
    base = re.search(r"^FROM\s+(\S+)", dockerfile, re.M)
    assert base, "Dockerfile has no FROM line"
    image = base.group(1)
    assert re.fullmatch(r"python:\d+\.\d+\.\d+-slim-[a-z]+", image), f"unpinned base {image!r}"
    lock_script = (SERVICE_ROOT / "scripts/lock_requirements.py").read_text(encoding="utf-8")
    readme = (SERVICE_ROOT / "README.md").read_text(encoding="utf-8")
    assert image in lock_script, "scripts/lock_requirements.py documents another base image"
    assert image in readme, "README.md documents another base image"
    python = image.split(":")[1].split("-")[0]
    assert f"CPython {python} on linux/" in (SERVICE_ROOT / "requirements.txt").read_text(), (
        "requirements.txt was not locked in the Dockerfile's base image"
    )
