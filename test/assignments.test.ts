// HTML から課題を取り出す部分のテスト（HTML はテスト用に作ったもの。本物のデータではない）
import test from "node:test";
import assert from "node:assert/strict";
import { extractCourses, extractCourseAssignments, selectNearDeadlines, type Assignment } from "../src/assignments.ts";

const TOP_HTML = `
<ul>
  <li><a href="/webclass/course.php/AAA111/login?acs_=1">&raquo; 01 プログラミング演習 (AAA111)</a></li>
  <li><a href="/webclass/course.php/BBB222/login?acs_=1">&raquo; 02 情報数学 <span>締切が近い課題があります。</span> (BBB222)</a></li>
  <li><a href="/webclass/course.php/AAA111/login?acs_=2">同じコースへの2つ目のリンク</a></li>
  <li><a href="/webclass/other.php">関係ないリンク</a></li>
</ul>`;

test("トップページからコースを取り出す（重複は1つにまとめる）", () => {
  const courses = extractCourses(TOP_HTML);
  assert.deepEqual(
    courses.map((c) => [c.id, c.name, c.hasDeadlineSoon]),
    [
      ["AAA111", "プログラミング演習", false],
      ["BBB222", "情報数学", true],
    ]
  );
});

const section = (attrs: string, label: string) =>
  `<section ${attrs}><span class="cl-contentsList_categoryLabel">${label}</span></section>`;

const COURSE_HTML = [
  section('data-contents-id="c1" data-contents-name="第3回レポート" data-end-date="1800000000" data-exec-count="0"', "レポート"),
  section('data-contents-id="c2" data-contents-name="小テスト1" data-end-date="1800000000" data-exec-count="1"', "試験"),
  section('data-contents-id="c3" data-contents-name="授業資料" data-end-date="0"', "資料"),
  section('data-contents-id="c4" data-contents-name="欠席連絡フォーム" data-end-date="0"', "アンケート"),
  section('data-contents-id="c5" data-contents-name="授業アンケート"', "アンケート"),
].join("\n");

test("コースのページから課題だけを取り出す", () => {
  const items = extractCourseAssignments(COURSE_HTML, { id: "AAA111", name: "プログラミング演習", href: "", hasDeadlineSoon: false });
  assert.deepEqual(
    items.map((i) => [i.id, i.kind, i.title, i.submitted, i.endSec]),
    [
      ["AAA111_c1", "レポート", "第3回レポート", false, 1800000000],
      ["AAA111_c2", "小テスト", "小テスト1", true, 1800000000], // 「試験」は「小テスト」として通知
      ["AAA111_c5", "アンケート", "授業アンケート", false, 0],   // 締切なしは 0
    ]
  ); // 資料と欠席連絡は入らない
});

test("未提出で、締切が3日以内のものだけを選ぶ", () => {
  const now = 1_800_000_000;
  const day = 86400;
  const base = { course: "授業", kind: "レポート", submitted: false };
  const items: Assignment[] = [
    { ...base, id: "a", title: "明日締切", endSec: now + day },
    { ...base, id: "b", title: "提出済み", endSec: now + day, submitted: true },
    { ...base, id: "c", title: "もう過ぎた", endSec: now - 60 },
    { ...base, id: "d", title: "5日後", endSec: now + 5 * day },
    { ...base, id: "e", title: "締切なし", endSec: 0 },
  ];
  const near = selectNearDeadlines(items, now, 3);
  assert.deepEqual(near.map((i) => i.title), ["明日締切"]);
  assert.equal(near[0].id, `a_${now + day}`); // 締切が延びたら別IDになり、通知し直せる
});
