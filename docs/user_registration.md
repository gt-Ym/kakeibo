# ユーザー登録手順

家計簿アプリへのユーザー追加手順です。
Firebase Console で「Authentication への追加」と「Firestore へのドキュメント追加」の2ステップが必要です。

---

## 事前確認

- ログイン時のメールアドレス形式: `{ユーザー名}@kakeibo.com`
- ユーザー名とパスワードの組み合わせがログイン画面の入力値と一致する必要があります

---

## Step 1 — Firebase Authentication にユーザーを追加

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. プロジェクトを選択
3. 左メニュー **「構築」→「Authentication」→「Users」タブ**
4. **「ユーザーを追加」** をクリック
5. 以下を入力して保存：

| 項目 | 形式 | 例 |
|---|---|---|
| メールアドレス | `{ユーザー名}@kakeibo.com` | `yamada@kakeibo.com` |
| パスワード | 任意（8文字以上推奨） | `pass1234!` |

6. 作成後に表示される **UID** をコピーしておく（次のステップで使用）

---

## Step 2 — Firestore にユーザードキュメントを追加

1. Firebase Console → **「Firestore Database」→「データ」タブ**
2. **`users`** コレクションを開く（なければ「コレクションを開始」で作成）
3. **「ドキュメントを追加」** をクリック
4. ドキュメント ID に **Step 1 でコピーした UID** を貼り付ける
5. 以下のフィールドを追加：

| フィールド名 | 型 | 値 |
|---|---|---|
| `userName` | string | ユーザー名（ログイン画面で入力するもの） |
| `groupId` | string | グループに属す場合はグループID、なければ `""` |

---

## 登録例

### 管理者ユーザー（admin）

```
Authentication:
  メール:     admin@kakeibo.com
  パスワード: admin1!

Firestore: users/{uid}
  userName: "admin"
  groupId:  ""
```

> 管理者は「マスター管理」メニューにアクセスできます（他ユーザーは非表示）。

---

### 一般ユーザー（グループなし）

```
Authentication:
  メール:     yamada@kakeibo.com
  パスワード: yamada123!

Firestore: users/{uid}
  userName: "yamada"
  groupId:  ""
```

---

### 一般ユーザー（グループあり）

```
Authentication:
  メール:     tanaka@kakeibo.com
  パスワード: tanaka123!

Firestore: users/{uid}
  userName: "tanaka"
  groupId:  "family"   ← 同じグループのメンバーは同じIDを設定
```

> `groupId` が同じユーザー同士はグループ共有取引・方法を閲覧できます。

---

## グループ設定について

グループを組むユーザー全員の `groupId` フィールドに**同一の文字列**を設定することでグループが構成されます。
グループ機能がない場合は `groupId` を空文字 `""` のままにしてください。

| ユーザー | groupId |
|---|---|
| yamada | `"family"` |
| tanaka | `"family"` |
| suzuki | `""` （グループなし） |

---

## ログイン確認

登録後、ログイン画面で以下を入力してテスト：

- **ユーザー名**: `yamada`（メールアドレスではなくユーザー名）
- **パスワード**: 設定したパスワード

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|---|---|---|
| 「ユーザー名またはパスワードが正しくありません」 | Authentication のメール形式が違う | メールを `{userName}@kakeibo.com` で確認 |
| ログイン後にメニューが正しく表示されない | Firestore の `users/{uid}` ドキュメントがない | Step 2 を再確認 |
| マスター管理が表示されない | `userName` が `"admin"` でない | Firestore の `userName` フィールドを確認 |
| グループ共有が動作しない | `groupId` の値が一致していない | 両ユーザーの `groupId` フィールドを確認 |
