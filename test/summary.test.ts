// 17時のまとめ通知の文章のテスト
import test from "node:test";
import assert from "node:assert/strict";
import { buildUnsubmittedSummary } from "../src/summary.ts";
import { jstDate } from "../src/history.ts";
import type { Assignment } from "../src/assignments.ts";

// 2026-10-29(木) 17:00 日本時間 = 08:00 UTC
const NOW = Date.UTC(2026, 9, 29, 8, 0) / 1000;
const jst = (d: number, h: number, m: number) => Date.UTC(2026, 9, d, h - 9, m) / 1000;

const base = { course: "授業A", kind: "レポート", submitted: false };

test("未提出の課題を、締切日ごとにまとめる", () => {
  const items: Assignment[] = [
    { ...base, id: "2", title: "後の課題", endSec: jst(31, 23, 59) },
    { ...base, id: "1", title: "先の課題", endSec: jst(30, 9, 0) },
    { ...base, id: "3", title: "同じ日の課題", endSec: jst(31, 12, 0), kind: "小テスト" },
    { ...base, id: "4", title: "締切なしの課題", endSec: 0, kind: "アンケート" },
    { ...base, id: "5", title: "提出済み", endSec: jst(30, 9, 0), submitted: true },
    { ...base, id: "6", title: "締切が過ぎた", endSec: jst(28, 9, 0) },
  ];
  const { title, body } = buildUnsubmittedSummary(items, NOW);
  assert.equal(title, "未提出の課題 4 件（10/29(木) 17:00 時点）");
  assert.equal(
    body,
    [
      "■ 10/30(金)",
      "・09:00まで【レポート】先の課題（授業A）",
      "■ 10/31(土)",
      "・12:00まで【小テスト】同じ日の課題（授業A）",
      "・23:59まで【レポート】後の課題（授業A）",
      "■ 締切なし",
      "・【アンケート】締切なしの課題（授業A）",
    ].join("\n")
  );
});

test("未提出がなければ、そう伝える", () => {
  const { title, body } = buildUnsubmittedSummary([], NOW);
  assert.equal(title, "未提出の課題 0 件（10/29(木) 17:00 時点）");
  assert.equal(body, "未提出の課題はありません 🎉");
});

test("日付は日本時間で数える（UTCではまだ前日でも）", () => {
  assert.equal(jstDate(Date.UTC(2026, 9, 29, 16, 0) / 1000), "2026-10-30"); // 日本時間 10/30 1:00
});
