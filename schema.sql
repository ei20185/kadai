-- 課題の記録（1つの課題 = 1行。17時に毎日上書きする）
CREATE TABLE IF NOT EXISTS assignments (
  id            TEXT    PRIMARY KEY,  -- コースID_コンテンツID
  course        TEXT    NOT NULL,     -- 授業名
  title         TEXT    NOT NULL,     -- 課題名
  kind          TEXT    NOT NULL,     -- レポート / 小テスト / アンケート
  end_sec       INTEGER NOT NULL,     -- 締切（UNIX秒。0 は締切なし）
  submitted     INTEGER NOT NULL,     -- 提出済みなら 1
  first_seen_on TEXT    NOT NULL,     -- 初めて見つけた日（YYYY-MM-DD）
  last_seen_on  TEXT    NOT NULL,     -- 最後に見た日
  submitted_on  TEXT                  -- 提出に気づいた日
);
