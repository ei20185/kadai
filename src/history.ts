// 課題の記録を D1（Cloudflare の SQLite）に1日1回保存する
import type { Assignment } from "./assignments";

const DATE_FORMAT = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" });

/** UNIX秒 → 日本時間の "YYYY-MM-DD" */
export function jstDate(sec: number): string {
  return DATE_FORMAT.format(new Date(sec * 1000));
}

// 同じ課題がすでにあれば上書き（UPSERT）。提出した日は最初に気づいた日のまま残す
const UPSERT_SQL = `
INSERT INTO assignments (id, course, title, kind, end_sec, submitted, first_seen_on, last_seen_on, submitted_on)
VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)
ON CONFLICT(id) DO UPDATE SET
  course = excluded.course,
  title = excluded.title,
  kind = excluded.kind,
  end_sec = excluded.end_sec,
  submitted = excluded.submitted,
  last_seen_on = excluded.last_seen_on,
  submitted_on = COALESCE(assignments.submitted_on, excluded.submitted_on)
`;

export async function saveSnapshot(db: D1Database, items: Assignment[], today: string): Promise<void> {
  if (items.length === 0) return;
  const stmt = db.prepare(UPSERT_SQL);
  // batch で1回の通信にまとめる（D1 では batch は1つのトランザクションとして実行される）
  await db.batch(
    items.map((a) =>
      stmt.bind(a.id, a.course, a.title, a.kind, a.endSec, a.submitted ? 1 : 0, today, a.submitted ? today : null)
    )
  );
}
