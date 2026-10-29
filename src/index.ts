// WebClass 課題通知ボット（Cloudflare Workers）
//   平日 9:00〜17:59（日本時間）に毎分動き、
//   - 締切3日以内の未提出課題が「新しく」見つかったら Discord に通知
//   - 17:00 に、未提出の課題を締切日ごとにまとめて通知し、D1 に記録
import { extractCourses, extractCourseAssignments, selectNearDeadlines, type Assignment } from "./assignments";
import { jstDate, saveSnapshot } from "./history";
import { buildUnsubmittedSummary } from "./summary";

export interface Env {
  DB: D1Database;            // 課題の記録
  STATE: KVNamespace;        // ログイン状態・通知済みの課題
  WEBCLASS_USERNAME: string; // ↓3つは `wrangler secret put` で登録（コードには書かない）
  WEBCLASS_PASSWORD: string;
  DISCORD_WEBHOOK: string;
}

type Cookies = Record<string, string>;

const BASE = "https://els.sa.dendai.ac.jp/webclass";
const ORIGIN = "https://els.sa.dendai.ac.jp";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DEADLINE_DAYS = 3;            // 締切が何日以内なら通知するか
const MAX_COURSES = 12;             // 1回に見るコースの上限（Workers の時間制限対策）
const FULL_SWEEP_INTERVAL_MIN = 30; // 全コースを見るのは30分に1回。それ以外は「締切が近い」コースだけ
const SESSION_TTL_SEC = 6 * 3600;   // ログイン状態を使い回す時間
const DAILY_SNAPSHOT_UTC_HOUR = 8;  // 8:00 UTC = 17:00 日本時間
const DAILY_SNAPSHOT_UTC_MINUTE = 0;

// ---------------------------------------------------------------
// Cookie とリダイレクトの処理
// ---------------------------------------------------------------
function parseCookies(res: Response): Cookies {
  const out: Cookies = {};
  // Workers では Set-Cookie を1つずつ取り出せる getAll がある
  const all: string[] = (res.headers as any).getAll?.("set-cookie") ?? [];
  if (all.length === 0) {
    const single = res.headers.get("set-cookie");
    if (single) all.push(single);
  }
  for (const s of all) {
    const eq = s.indexOf("=");
    if (eq < 0) continue;
    const name = s.slice(0, eq).trim();
    const rest = s.slice(eq + 1);
    const semi = rest.indexOf(";");
    out[name] = (semi < 0 ? rest : rest.slice(0, semi)).trim();
  }
  return out;
}

function cookieHeader(cookies: Cookies): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

// リダイレクト先は「https://〜」「/〜」「相対パス」の3通りがある
function resolveUrl(location: string): string {
  if (location.startsWith("http")) return location;
  if (location.startsWith("/")) return `${ORIGIN}${location}`;
  return `${BASE}/${location}`;
}

/** リダイレクトを自分でたどる（途中で配られる Cookie を集めるため）。JavaScript での移動にも対応 */
async function follow(url: string, cookies: Cookies, init: RequestInit = {}): Promise<{ html: string; cookies: Cookies }> {
  let cur = url;
  let ck = { ...cookies };
  let nextInit = init;
  for (let i = 0; i < 12; i++) {
    const res = await fetch(cur, {
      ...nextInit,
      redirect: "manual",
      headers: { "User-Agent": UA, "Cookie": cookieHeader(ck), ...((nextInit.headers as Record<string, string>) ?? {}) },
    });
    ck = { ...ck, ...parseCookies(res) };
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      cur = resolveUrl(loc);
      nextInit = {};
      continue;
    }
    const html = await res.text();
    // 「location.href = '...'」だけの短いページは、JavaScript でのリダイレクト
    const js = html.match(/(?:window\.location\.href|location\.href|location\.replace|window\.location)\s*=\s*['"]([^'"]+)/);
    if (js && html.length < 800) {
      cur = resolveUrl(js[1].replace(/\\\//g, "/")); // "\/" を "/" に戻す
      nextInit = {};
      continue;
    }
    return { html, cookies: ck };
  }
  return { html: "", cookies: ck };
}

// ---------------------------------------------------------------
// WebClass へのログインと課題の取得
// ---------------------------------------------------------------
async function login(username: string, password: string): Promise<Cookies | null> {
  // ログイン画面にある使い捨ての token を先にもらう
  const getRes = await fetch(`${BASE}/login.php`, { headers: { "User-Agent": UA } });
  if (!getRes.ok) return null;
  const loginHtml = await getRes.text();
  const tokenMatch = loginHtml.match(/name="token"\s+value="([^"]+)"/);
  if (!tokenMatch) return null;
  const cookies = parseCookies(getRes);

  const body = new URLSearchParams({
    username,
    val: password, // WebClass はパスワードフィールド名が "val"
    login: "ログイン",
    useragent: UA,
    language: "JAPANESE",
    token: tokenMatch[1],
  });
  const postRes = await fetch(`${BASE}/login.php`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Referer": `${BASE}/login.php`,
      "Cookie": cookieHeader(cookies),
    },
    body: body.toString(),
  });
  const merged = { ...cookies, ...parseCookies(postRes) };

  // 移動先はヘッダーか、本文の JavaScript に書かれている
  let location = postRes.headers.get("location");
  if (!location) {
    const pb = await postRes.text();
    const m = pb.match(/(?:location\.href|location\.replace|window\.location)\s*=\s*['"]([^'"]+)/);
    if (m) location = m[1].replace(/\\\//g, "/");
  }
  if (!location) return null;

  const { html, cookies: finalCookies } = await follow(resolveUrl(location), merged);
  if (!html.includes("logout") && !html.includes("ログアウト")) return null;
  return finalCookies;
}

/** 課題を集める。ログインが切れていたら null */
async function fetchAssignments(cookies: Cookies, fullSweep: boolean): Promise<Assignment[] | null> {
  const top = await follow(`${BASE}/`, cookies);
  if (!top.html) return null;
  if (top.html.includes('name="token"')) return null; // ログイン画面に戻された

  const courses = extractCourses(top.html);
  const targets = fullSweep ? courses : courses.filter((c) => c.hasDeadlineSoon);
  const all: Assignment[] = [];
  let ck = top.cookies;
  for (const c of targets.slice(0, MAX_COURSES)) {
    try {
      const page = await follow(resolveUrl(c.href), ck);
      ck = page.cookies;
      if (!page.html || page.html.includes('name="token"')) continue;
      all.push(...extractCourseAssignments(page.html, c));
    } catch (error) {
      console.error(`コース取得失敗 (${c.name}):`, error);
    }
  }
  return all;
}

// ---------------------------------------------------------------
// Discord 通知
// ---------------------------------------------------------------
const DUE_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "numeric",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDue(endSec: number): string {
  const remainMs = endSec * 1000 - Date.now();
  const remainHours = Math.floor(remainMs / 3_600_000);
  const remain = remainHours < 24 ? `あと約${Math.max(remainHours, 1)}時間` : `あと${Math.floor(remainHours / 24)}日`;
  return `${DUE_FORMAT.format(new Date(endSec * 1000))}（${remain}）`;
}

async function sendDiscord(webhook: string, title: string, body: string): Promise<boolean> {
  let content = `**${title}**\n${body}`;
  if (content.length > 1900) content = content.slice(0, 1900) + "…"; // Discord の上限は2000文字
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      username: "WebClass 通知",
      content,
      allowed_mentions: { parse: [] }, // @everyone 等のメンション誤爆を防ぐ
    }),
  });
  if (!res.ok) {
    console.error("Discord送信失敗:", res.status, await res.text());
    return false;
  }
  return true;
}

// ---------------------------------------------------------------
// 本体
// ---------------------------------------------------------------
const NOTIFIED_KEY = "notified_deadlines";
const SESSION_KEY = "session_cookies";

/** 保存しておいたログイン状態を使い、切れていたらログインし直す */
async function fetchWithSession(env: Env, fullSweep: boolean): Promise<Assignment[] | null | "login_failed"> {
  const saved = await env.STATE.get(SESSION_KEY);
  if (saved) {
    const items = await fetchAssignments(JSON.parse(saved), fullSweep);
    if (items !== null) return items;
  }
  const cookies = await login(env.WEBCLASS_USERNAME, env.WEBCLASS_PASSWORD);
  if (!cookies) return "login_failed";
  await env.STATE.put(SESSION_KEY, JSON.stringify(cookies), { expirationTtl: SESSION_TTL_SEC });
  console.log("WebClass にログインし直しました");
  return fetchAssignments(cookies, fullSweep);
}

async function runDailySnapshot(env: Env, items: Assignment[], nowSec: number): Promise<void> {
  try {
    await saveSnapshot(env.DB, items, jstDate(nowSec));
    console.log(`課題 ${items.length} 件をデータベースに保存しました`);
  } catch (error) {
    console.error("データベースへの保存に失敗:", error);
  }
  const { title, body } = buildUnsubmittedSummary(items, nowSec);
  await sendDiscord(env.DISCORD_WEBHOOK, title, body);
}

async function runCheck(env: Env, fullSweep: boolean, dailySnapshot: boolean): Promise<string> {
  const all = await fetchWithSession(env, fullSweep);
  if (all === "login_failed") {
    console.error("ログイン失敗");
    return "ログイン失敗。ユーザーID/パスワードを確認してください。";
  }
  if (all === null) {
    console.error("課題ページの取得に失敗");
    return "課題ページの取得に失敗しました。";
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const current = selectNearDeadlines(all, nowSec, DEADLINE_DAYS);

  // すでに通知した課題は送らない（二重通知の防止）
  const stored = await env.STATE.get(NOTIFIED_KEY);
  const notified: Record<string, number> = stored ? JSON.parse(stored) : {};
  const newItems = current.filter((item) => !(item.id in notified));
  if (newItems.length > 0) {
    const lines = newItems
      .map((i) => `・【${i.kind}】${i.title}（${i.course}）\n　締切: ${formatDue(i.endSec)}`)
      .join("\n");
    const body = `${lines}\n\n確認: ${BASE}/`;
    await sendDiscord(env.DISCORD_WEBHOOK, `締切が近い課題 ${newItems.length} 件`, body);
    console.log(`締切が近い課題 ${newItems.length} 件を通知しました`);
  }

  // 締切が過ぎたものは「通知済み」から消して、KV が増え続けないようにする
  const nextNotified: Record<string, number> = {};
  for (const [id, endSec] of Object.entries(notified)) {
    if (endSec > nowSec) nextNotified[id] = endSec;
  }
  for (const item of current) {
    nextNotified[item.id] = item.endSec;
  }
  const nextJson = JSON.stringify(nextNotified);
  if (nextJson !== (stored ?? "{}")) {
    await env.STATE.put(NOTIFIED_KEY, nextJson); // 変わったときだけ書く（KV の書き込み回数の節約）
  }

  if (dailySnapshot) await runDailySnapshot(env, all, nowSec);

  const mode = fullSweep ? "フル巡回" : "軽量チェック";
  const result = `完了(${mode}): 締切${DEADLINE_DAYS}日以内の未提出課題 ${current.length} 件, 新規通知 ${newItems.length} 件`;
  console.log(result);
  return result;
}

export default {
  // cron は毎分発火。普段は軽量チェック、FULL_SWEEP_INTERVAL_MIN の倍数の分だけフル巡回。
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const at = new Date(event.scheduledTime);
    const fullSweep = at.getUTCMinutes() % FULL_SWEEP_INTERVAL_MIN === 0;
    const dailySnapshot =
      at.getUTCHours() === DAILY_SNAPSHOT_UTC_HOUR && at.getUTCMinutes() === DAILY_SNAPSHOT_UTC_MINUTE;
    ctx.waitUntil(runCheck(env, fullSweep, dailySnapshot).catch(console.error));
  },

  // URL からは何も実行できないようにする（以前の /check・/test-notify は誰でも
  // ログインや通知を動かせてしまったため廃止）。動作確認は `npx wrangler tail` でログを見る。
  async fetch(): Promise<Response> {
    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
