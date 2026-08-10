#!/usr/bin/env python3
"""
Detect and remove duplicate investment records in Soberan's SQLite DB.

Usage:
  python3 deduplicate_investments.py [--db /path/to/soberan.db] [--apply]

Without --apply it only prints what would be removed (dry-run).
With --apply it deletes the duplicates.

Dedup strategy:
  - Group records by lowercase(nombre)
  - Within each group, keep the record with the highest monto_invertido
    (or the oldest id as tiebreaker) and delete the rest
  - Also normalise tipo values: "fondos_indexados", "fondo", "indexado" → "ETF"
"""

import argparse
import sqlite3
import sys
from pathlib import Path

DEFAULT_DB = Path(__file__).parent.parent / "soberan.db"

TIPO_ALIASES = {
    "fondos_indexados": "ETF",
    "fondo_indexado": "ETF",
    "fondo": "ETF",
    "indexado": "ETF",
    "fondos": "ETF",
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=str(DEFAULT_DB))
    parser.add_argument("--apply", action="store_true", help="Actually delete duplicates")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        sys.exit(f"DB not found: {db_path}")

    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row

    rows = con.execute(
        "SELECT id, nombre, tipo, monto_invertido, valor_actual FROM investments ORDER BY nombre, id"
    ).fetchall()

    # Group by lowercase nombre
    from collections import defaultdict
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        groups[r["nombre"].strip().lower()].append(dict(r))

    duplicates: list[int] = []  # ids to delete
    tipo_fixes: list[tuple[int, str]] = []  # (id, new_tipo)

    for key, group in groups.items():
        # Normalise tipo aliases
        for rec in group:
            alias = TIPO_ALIASES.get(rec["tipo"], "").strip()
            if alias:
                tipo_fixes.append((rec["id"], alias))

        if len(group) < 2:
            continue

        # Sort: prefer record with highest monto_invertido, then lowest id
        group_sorted = sorted(group, key=lambda r: (-float(r["monto_invertido"] or 0), r["id"]))
        keeper = group_sorted[0]
        dupes = group_sorted[1:]

        print(f"\n[DUPLICATE] nombre='{group[0]['nombre']}'")
        print(f"  KEEP   id={keeper['id']} tipo={keeper['tipo']} "
              f"invertido={keeper['monto_invertido']} actual={keeper['valor_actual']}")
        for d in dupes:
            print(f"  DELETE id={d['id']}  tipo={d['tipo']} "
                  f"invertido={d['monto_invertido']} actual={d['valor_actual']}")
            duplicates.append(d["id"])

    print(f"\n{'='*50}")
    print(f"Duplicates to remove: {len(duplicates)}")
    print(f"Tipo aliases to fix:  {len(tipo_fixes)}")

    if not args.apply:
        print("\nDry run — pass --apply to execute")
        return

    if tipo_fixes:
        print("\nFixing tipo aliases…")
        for rec_id, new_tipo in tipo_fixes:
            con.execute("UPDATE investments SET tipo=? WHERE id=?", (new_tipo, rec_id))
        print(f"  Fixed {len(tipo_fixes)} records")

    if duplicates:
        print("Deleting duplicates…")
        placeholders = ",".join("?" * len(duplicates))
        con.execute(f"DELETE FROM investments WHERE id IN ({placeholders})", duplicates)
        print(f"  Deleted {len(duplicates)} records")

    con.commit()
    con.close()
    print("Done.")


if __name__ == "__main__":
    main()
