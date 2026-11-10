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

function line(a: Assignment): string {
  return `・${timeLabel(a.endSec)}まで【${a.kind}】${a.title}（${a.course}）`;
}

/** 未提出の課題を、締切日ごとにまとめた通知文にする（締切のない課題は通知しない） */
export function buildUnsubmittedSummary(items: Assignment[], nowSec: number): { title: string; body: string } {
  const withDeadline = items
    .filter((i) => !i.submitted && i.endSec > nowSec) // endSec が 0（締切なし）や締切切れは入らない
    .sort((x, y) => x.endSec - y.endSec);
  const title = `未提出の課題 ${withDeadline.length} 件（${dayLabel(nowSec)} ${timeLabel(nowSec)} 時点）`;
  if (withDeadline.length === 0) return { title, body: "未提出の課題はありません 🎉" };

  const lines: string[] = [];
  let currentDay = "";
  for (const a of withDeadline) {
    const day = dayLabel(a.endSec);
    if (day !== currentDay) {
      lines.push(`■ ${day}`);
      currentDay = day;
    }
    lines.push(line(a));
  }
  return { title, body: lines.join("\n") };
}
