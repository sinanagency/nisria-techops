"""CLI export of grants to CSV.

Usage:
    python scripts/export_grants.py --tier HIGH --output high_grants.csv
    python scripts/export_grants.py --source grants_gov
"""

import argparse
import csv
import sys

from src.common.db import get_db


def export(db_path=None, tier=None, source=None, output=None):
    conn = get_db(db_path)

    where_clauses = []
    params = []
    if tier:
        where_clauses.append("relevance_tier = ?")
        params.append(tier)
    if source:
        where_clauses.append("source = ?")
        params.append(source)

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    rows = conn.execute(
        f"SELECT * FROM grants WHERE {where_sql} ORDER BY relevance_score DESC",
        params,
    ).fetchall()

    out = open(output, "w", newline="") if output else sys.stdout
    writer = csv.writer(out)
    writer.writerow([
        "Title", "Agency", "Source", "Amount Floor", "Amount Ceiling",
        "Status", "Open Date", "Close Date", "Relevance Score", "Tier", "URL",
    ])
    for row in rows:
        r = dict(row)
        writer.writerow([
            r["title"], r["agency"], r["source"],
            r["amount_floor"], r["amount_ceiling"],
            r["status"], r["open_date"], r["close_date"],
            r["relevance_score"], r["relevance_tier"], r["url"],
        ])

    if output:
        out.close()
        print(f"Exported {len(rows)} grants to {output}")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Export grants to CSV")
    parser.add_argument("--db", default=None)
    parser.add_argument("--tier", choices=["HIGH", "MEDIUM", "LOW", "IRRELEVANT"])
    parser.add_argument("--source")
    parser.add_argument("--output", "-o")
    args = parser.parse_args()
    export(args.db, args.tier, args.source, args.output)
