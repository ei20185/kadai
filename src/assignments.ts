// WebClass の HTML から「コース」と「課題」を取り出す（通信しない純粋な関数だけ）

export interface Course {
  id: string;
  name: string;
  href: string;
  /** トップページに「締切が近い課題があります」と出ているか */
  hasDeadlineSoon: boolean;
}

export interface Assignment {
  id: string;        // コースID_コンテンツID
  course: string;
  title: string;
  kind: string;      // レポート / 小テスト / アンケート
  endSec: number;    // 締切（UNIX秒）。0 は締切なし
  submitted: boolean;
}

export interface NearDeadline {
  id: string;        // 締切が延びたら別の課題として通知し直せるよう、締切も含める
  course: string;
  title: string;
  kind: string;
  endSec: number;
}

// WebClass の分類ラベル → 通知に出す名前
const KIND_MAP: Record<string, string> = {
  レポート: "レポート",
  試験: "小テスト",
  テスト: "小テスト",
  アンケート: "アンケート",
};

// 課題ではないので通知しないもの
const EXCLUDED_TITLE_WORDS = ["欠席連絡"];

/** トップページから、自分が履修しているコースの一覧を取り出す */
export function extractCourses(html: string): Course[] {
  const out: Course[] = [];
  const seen = new Set<string>();
  const re = /<a[^>]+href="(\/webclass\/course\.php\/([A-Za-z0-9]+)\/login[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    const rawText = m[3]
      .replace(/<[^>]+>/g, "")
      .replace(/&raquo;/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const hasDeadlineSoon = rawText.includes("締切が近い課題があります");
    const name = rawText
      .replace(/^\d+\s*/, "")
      .replace(/締切が近い課題があります。?/g, "")
      .replace(/\([A-Za-z0-9]+\)\s*$/, "")
      .trim();
    out.push({ id, name, href, hasDeadlineSoon });
  }
  return out;
}

/** コースのページから、課題（レポート・小テスト・アンケート）を取り出す */
export function extractCourseAssignments(html: string, course: Course): Assignment[] {
  const items: Assignment[] = [];
  const secRe = /<section\s+([^>]*?)>([\s\S]*?)<\/section>/g;
  let m: RegExpExecArray | null;
  while ((m = secRe.exec(html)) !== null) {
    // data-contents-id="..." などの属性を読む
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/data-([a-z-]+)="([^"]*)"/g)) {
      attrs[a[1]] = a[2];
    }
    const contentsId = attrs["contents-id"];
    if (!contentsId) continue;

    const label = (m[2].match(/cl-contentsList_categoryLabel">([^<]+)</) ?? [])[1]?.trim();
    const kind = label ? KIND_MAP[label] : undefined;
    if (!kind) continue; // 資料など、課題ではないもの

    const title = (attrs["contents-name"] ?? "課題").trim();
    if (EXCLUDED_TITLE_WORDS.some((w) => title.includes(w))) continue;

    items.push({
      id: `${course.id}_${contentsId}`,
      course: course.name || "（コース名不明）",
      title,
      kind,
      endSec: parseInt(attrs["end-date"] ?? "0", 10) || 0,
      submitted: parseInt(attrs["exec-count"] ?? "0", 10) > 0,
    });
  }
  return items;
}

/** 未提出で、締切が今から days 日以内の課題だけを選ぶ */
export function selectNearDeadlines(items: Assignment[], nowSec: number, days: number): NearDeadline[] {
  const limitSec = nowSec + days * 86400;
  return items
    .filter((i) => !i.submitted && i.endSec > nowSec && i.endSec <= limitSec)
    .map((i) => ({ id: `${i.id}_${i.endSec}`, course: i.course, title: i.title, kind: i.kind, endSec: i.endSec }));
}
