from __future__ import annotations

import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"
TARGET_WORKSPACE = "fb71d118-de05-4fe0-9001-c7a764adc0ff"
STUDENT_ID = "074a0fb8-e41b-5805-9a01-8c1a9c2fe1e9"


def apply(db: sqlite3.Connection, name: str) -> None:
    db.executescript((MIGRATIONS / name).read_text(encoding="utf-8"))


def validate_d1_migration_source_compatibility() -> None:
    """Guard source patterns known to break D1 remote migration splitting.

    SQLite accepts more trigger syntax than D1's remote migration statement
    splitter reliably recognizes. Keep migrations portable by enforcing LF,
    uppercase trigger BEGIN, and trigger bodies without CASE ... END; blocks.
    """
    for path in sorted(MIGRATIONS.glob("*.sql")):
        raw = path.read_bytes()
        if b"\r\n" in raw:
            raise SystemExit(f"D1 migration must use LF line endings: {path.name}")

        in_trigger = False
        saw_begin = False
        for line_number, line in enumerate(raw.decode("utf-8").splitlines(), start=1):
            stripped = line.strip()
            if re.search(r"\bCREATE\s+TRIGGER\b", stripped, re.IGNORECASE):
                if in_trigger:
                    raise SystemExit(f"Nested/unclosed trigger near {path.name}:{line_number}")
                in_trigger = True
                saw_begin = False
                continue

            if not in_trigger:
                continue

            if stripped.lower() == "begin":
                if stripped != "BEGIN":
                    raise SystemExit(
                        f"D1 trigger BEGIN must be uppercase: {path.name}:{line_number}"
                    )
                saw_begin = True
                continue

            if re.search(r"\bCASE\b", stripped, re.IGNORECASE):
                raise SystemExit(
                    f"Avoid CASE ... END inside D1 migration triggers: {path.name}:{line_number}"
                )

            if stripped.upper() == "END;":
                if not saw_begin:
                    raise SystemExit(f"Trigger missing BEGIN: {path.name}:{line_number}")
                in_trigger = False
                saw_begin = False

        if in_trigger:
            raise SystemExit(f"Unclosed trigger in D1 migration: {path.name}")


def make_pre_repair_database() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name >= "0007_correct_tutoring_data_2026_09_17.sql":
            break
        db.executescript(path.read_text(encoding="utf-8"))
    db.execute(
        "INSERT INTO core_workspaces(id, name, template_key) VALUES (?, 'Repair fixture', 'tutoring')",
        (TARGET_WORKSPACE,),
    )
    apply(db, "0007_correct_tutoring_data_2026_09_17.sql")
    apply(db, "0008_domain_integrity.sql")
    return db


def expect_integrity_error(action, message: str) -> None:
    try:
        action()
    except sqlite3.IntegrityError:
        return
    raise SystemExit(message)


def validate_untouched_synthetic_repair() -> sqlite3.Connection:
    db = make_pre_repair_database()
    before = db.execute(
        "SELECT COUNT(*) FROM tutoring_billing_plans WHERE workspace_id=?",
        (TARGET_WORKSPACE,),
    ).fetchone()[0]
    if before != 24:
        raise SystemExit(f"Expected 24 synthetic billing plans after 0007, found {before}")

    apply(db, "0009_repair_tutoring_baselines_2026_09_17.sql")

    students = db.execute(
        "SELECT COUNT(*) FROM tutoring_students WHERE workspace_id=? AND active=1 AND deleted_at IS NULL",
        (TARGET_WORKSPACE,),
    ).fetchone()[0]
    if students != 24:
        raise SystemExit(f"Repair changed canonical roster: expected 24 active students, found {students}")

    baselines = db.execute(
        "SELECT COUNT(*) FROM tutoring_student_baselines WHERE workspace_id=?",
        (TARGET_WORKSPACE,),
    ).fetchone()[0]
    if baselines != 18:
        raise SystemExit(f"Expected 18 observed lesson baselines, found {baselines}")

    synthetic_plans = db.execute(
        "SELECT COUNT(*) FROM tutoring_billing_plans WHERE workspace_id=?",
        (TARGET_WORKSPACE,),
    ).fetchone()[0]
    synthetic_cycles = db.execute(
        "SELECT COUNT(*) FROM tutoring_billing_cycles WHERE workspace_id=?",
        (TARGET_WORKSPACE,),
    ).fetchone()[0]
    if synthetic_plans != 0 or synthetic_cycles != 0:
        raise SystemExit(
            "Untouched synthetic zero-price billing survived repair: "
            f"plans={synthetic_plans}, cycles={synthetic_cycles}"
        )
    return db


def validate_user_owned_billing_survives() -> None:
    db = make_pre_repair_database()
    db.execute(
        "UPDATE tutoring_billing_plans SET package_price_pence=12500 WHERE workspace_id=? AND student_id=?",
        (TARGET_WORKSPACE, STUDENT_ID),
    )
    apply(db, "0009_repair_tutoring_baselines_2026_09_17.sql")
    preserved = db.execute(
        "SELECT package_price_pence FROM tutoring_billing_plans WHERE workspace_id=? AND student_id=?",
        (TARGET_WORKSPACE, STUDENT_ID),
    ).fetchone()
    if preserved != (12500,):
        raise SystemExit("Targeted repair overwrote an explicitly changed billing plan")


def validate_finance_guard(db: sqlite3.Connection) -> None:
    db.execute(
        "INSERT INTO finance_receipts(id,workspace_id,payer_ref_type,payer_ref_id,amount_pence,received_at) "
        "VALUES('receipt-ci',?,'tutoring.student',?,1000,'2026-09-17')",
        (TARGET_WORKSPACE, STUDENT_ID),
    )
    db.execute(
        "INSERT INTO finance_receipt_allocations(id,workspace_id,receipt_id,target_module,target_type,target_id,amount_pence) "
        "VALUES('allocation-1',?,'receipt-ci','tutoring','test','target-1',800)",
        (TARGET_WORKSPACE,),
    )
    expect_integrity_error(
        lambda: db.execute(
            "INSERT INTO finance_receipt_allocations(id,workspace_id,receipt_id,target_module,target_type,target_id,amount_pence) "
            "VALUES('allocation-2',?,'receipt-ci','tutoring','test','target-2',300)",
            (TARGET_WORKSPACE,),
        ),
        "Receipt allocation guard allowed allocations to exceed the receipt amount",
    )
    violations = db.execute("SELECT COUNT(*) FROM finance_allocation_integrity_violations").fetchone()[0]
    if violations != 0:
        raise SystemExit(f"Finance integrity view reports {violations} violations")


def main() -> None:
    validate_d1_migration_source_compatibility()
    repaired = validate_untouched_synthetic_repair()
    validate_user_owned_billing_survives()
    validate_finance_guard(repaired)
    print("Domain integrity migrations validated")


if __name__ == "__main__":
    main()
