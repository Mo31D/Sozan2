from __future__ import annotations

import pathlib
import re
import sqlite3

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


def validate_d1_migration_source_compatibility() -> None:
    """Guard source patterns known to break D1 remote migration splitting."""
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


def make_database() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:")
    db.execute("PRAGMA foreign_keys = ON")
    for path in sorted(MIGRATIONS.glob("*.sql")):
        db.executescript(path.read_text(encoding="utf-8"))
    return db


def expect_integrity_error(action, message: str) -> None:
    try:
        action()
    except sqlite3.IntegrityError:
        return
    raise SystemExit(message)


def validate_domain_integrity() -> None:
    db = make_database()
    db.execute(
        "INSERT INTO core_workspaces(id,name,template_key) VALUES('ws-integrity','Integrity','tutoring')"
    )
    db.execute(
        "INSERT INTO tutoring_students(id,workspace_id,name) "
        "VALUES('student-a','ws-integrity','Student A')"
    )
    db.execute(
        "INSERT INTO tutoring_students(id,workspace_id,name) "
        "VALUES('student-b','ws-integrity','Student B')"
    )
    db.execute(
        "INSERT INTO tutoring_recurring_sessions("
        "id,workspace_id,title,session_type,schedule_status,weekday,start_time,"
        "duration_minutes,travel_minutes,price_basis,default_price_pence,expected_student_count"
        ") VALUES("
        "'session-group','ws-integrity','Group','own_group','confirmed',1,'17:00',"
        "90,30,'per_student',2500,2"
        ")"
    )
    db.execute(
        "INSERT INTO tutoring_session_students(workspace_id,recurring_session_id,student_id) "
        "VALUES('ws-integrity','session-group','student-a')"
    )
    db.execute(
        "INSERT INTO tutoring_session_students(workspace_id,recurring_session_id,student_id) "
        "VALUES('ws-integrity','session-group','student-b')"
    )
    db.execute(
        "INSERT INTO tutoring_occurrences("
        "id,workspace_id,recurring_session_id,session_date,status,"
        "gross_pence,center_cut_pence,earned_pence,"
        "duration_minutes_snapshot,travel_minutes_snapshot,session_type_snapshot,"
        "price_basis_snapshot,default_price_pence_snapshot"
        ") VALUES("
        "'occurrence-a','ws-integrity','session-group','2026-09-17','completed',"
        "5000,0,5000,90,30,'own_group','per_student',2500"
        ")"
    )
    db.execute(
        "INSERT INTO tutoring_occurrence_students("
        "workspace_id,occurrence_id,student_id,attendance_status"
        ") VALUES('ws-integrity','occurrence-a','student-a','attended')"
    )
    db.execute(
        "INSERT INTO tutoring_occurrence_students("
        "workspace_id,occurrence_id,student_id,attendance_status"
        ") VALUES('ws-integrity','occurrence-a','student-b','absent')"
    )

    attendance = db.execute(
        "SELECT student_id,attendance_status FROM tutoring_occurrence_students "
        "WHERE occurrence_id='occurrence-a' ORDER BY student_id"
    ).fetchall()
    if attendance != [("student-a", "attended"), ("student-b", "absent")]:
        raise SystemExit(f"Occurrence attendance invariant failed: {attendance}")

    db.execute(
        "INSERT INTO finance_receipts("
        "id,workspace_id,payer_ref_type,payer_ref_id,amount_pence,received_at"
        ") VALUES('receipt-ci','ws-integrity','tutoring.student','student-a',1000,'2026-09-17')"
    )
    db.execute(
        "INSERT INTO finance_receipt_allocations("
        "id,workspace_id,receipt_id,target_module,target_type,target_id,amount_pence"
        ") VALUES("
        "'allocation-1','ws-integrity','receipt-ci','tutoring','student_occurrence',"
        "'occurrence-a:student-a',800"
        ")"
    )

    expect_integrity_error(
        lambda: db.execute(
            "INSERT INTO finance_receipt_allocations("
            "id,workspace_id,receipt_id,target_module,target_type,target_id,amount_pence"
            ") VALUES("
            "'allocation-2','ws-integrity','receipt-ci','tutoring','student_occurrence',"
            "'another:student-a',300"
            ")"
        ),
        "Receipt allocation guard allowed allocations to exceed the receipt amount",
    )

    expect_integrity_error(
        lambda: db.execute(
            "UPDATE finance_receipts SET amount_pence=700 WHERE id='receipt-ci'"
        ),
        "Receipt update guard allowed amount below allocated total",
    )

    violations = db.execute(
        "SELECT COUNT(*) FROM finance_allocation_integrity_violations"
    ).fetchone()[0]
    if violations != 0:
        raise SystemExit(f"Finance integrity view reports {violations} violations")


def validate_no_tenant_data_in_schema_migrations() -> None:
    """Schema migrations must be reusable and must not seed real tenant rows."""
    db = make_database()
    if db.execute("SELECT COUNT(*) FROM core_users").fetchone()[0] != 0:
        raise SystemExit("Schema migrations must not seed users")
    if db.execute("SELECT COUNT(*) FROM core_workspaces").fetchone()[0] != 0:
        raise SystemExit("Schema migrations must not seed workspaces")
    if db.execute("SELECT COUNT(*) FROM tutoring_students").fetchone()[0] != 0:
        raise SystemExit("Schema migrations must not seed tutoring students")


def main() -> None:
    validate_d1_migration_source_compatibility()
    validate_no_tenant_data_in_schema_migrations()
    validate_domain_integrity()
    print("Domain integrity migrations validated")


if __name__ == "__main__":
    main()
