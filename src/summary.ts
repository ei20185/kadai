// 平日17時に送る「未提出の課題まとめ」の文章をつくる
import type { Assignment } from "./assignments";

const TZ = "Asia/Tokyo";
const DAY_FORMAT = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, month: "numeric", day: "numeric", weekday: "short" });
const TIME_FORMAT = new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** 例: 10/29(水) */
export function dayLabel(sec: number): string {
  const parts = DAY_FORMAT.formatToParts(new Date(sec * 1000));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")}/${get("day")}(${get("weekday")})`;
}

/** 例: 23:59 */
export function timeLabel(sec: number): string {
  return TIME_FORMAT.format(new Date(sec * 1000));
}

function line(a: Assignment, withTime: boolean): string {
  const time = withTime ? `${timeLabel(a.endSec)}まで` : "";
  return `・${time}【${a.kind}】${a.title}（${a.course}）`;
}

/** 未提出の課題を、締切日ごとにまとめた通知文にする */
export function buildUnsubmittedSummary(items: Assignment[], nowSec: number): { title: string; body: string } {
  const unsubmitted = items.filter((i) => !i.submitted && (i.endSec === 0 || i.endSec > nowSec));
  const title = `未提出の課題 ${unsubmitted.length} 件（${dayLabel(nowSec)} ${timeLabel(nowSec)} 時点）`;
  if (unsubmitted.length === 0) return { title, body: "未提出の課題はありません 🎉" };

  const withDeadline = unsubmitted.filter((i) => i.endSec > 0).sort((x, y) => x.endSec - y.endSec);
  const noDeadline = unsubmitted.filter((i) => i.endSec === 0);

  const lines: string[] = [];
  let currentDay = "";
  for (const a of withDeadline) {
    const day = dayLabel(a.endSec);
    if (day !== currentDay) {
      lines.push(`■ ${day}`);
      currentDay = day;
    }
    lines.push(line(a, true));
  }
  if (noDeadline.length > 0) {
    lines.push("■ 締切なし", ...noDeadline.map((a) => line(a, false)));
  }
  return { title, body: lines.join("\n") };
}
