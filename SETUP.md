# ドキュメント

> **このファイルは移行されました。**
> 最新のドキュメントは [`docs/`](./docs/) フォルダを参照してください。
>
> - セットアップ手順 → [docs/setup.md](./docs/setup.md)
> - ユーザー登録手順 → [docs/user_registration.md](./docs/user_registration.md)

---

# Firebase セットアップ手順（旧版）

GAS から Firebase（Authentication + Firestore + Hosting）へ移行するための手順書です。

> **無料プラン（Spark）について**
> Authentication・Firestore・Hosting はすべて無料枠で利用できます。
> **Cloud Functions は有料プラン（Blaze）が必要**なため、定期購入の毎日自動登録機能は
> 現在の構成では動作しません。定期購入の登録・一覧・削除は通常通り使用できます。

---

## 前提条件

- Google アカウント
- Node.js 18 以上がインストール済み
- npm がインストール済み

---

## 1. Firebase プロジェクト作成　【完了】

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力（例: `kakeibo`）し、「続行」
4. Google アナリティクスは任意（不要なら OFF）
5. 「プロジェクトを作成」をクリック

---

## 2. Authentication 有効化（メール/パスワード）　【完了】

1. Firebase Console → 左メニュー「構築」→「Authentication」
2. 「始める」をクリック
3. 「Sign-in method」タブ → 「メール/パスワード」をクリック
4. 「有効にする」をオンにして「保存」

---

## 3. Firestore データベース作成　【完了】

1. Firebase Console → 左メニュー「構築」→「Firestore Database」
2. 「データベースの作成」をクリック
3. **「本番環境モードで開始」** を選択して「次へ」
4. ロケーションを選択（例: `asia-northeast1`（東京））→「有効にする」

---

## 4. Firebase CLI のインストールとログイン　【完了】

```bash
npm install -g firebase-tools
firebase login
```

---

## 5. プロジェクトと連携　【完了】

```bash
cd e:/_html/kakeibo
firebase use --add
```

表示されたリストから手順1で作成したプロジェクトを選択し、エイリアス名（例: `default`）を入力します。

---

## 6. js/firebase.js に設定値を入力　【完了】

1. Firebase Console → プロジェクト設定（歯車アイコン）→「全般」タブ
2. 「マイアプリ」セクション →「ウェブアプリを追加」（初回）または既存アプリを選択
3. 「Firebase SDK の追加」に表示される `firebaseConfig` の値をコピー
4. `js/firebase.js` を開き、以下の箇所を実際の値に書き換える：

```javascript
const firebaseConfig = {
  apiKey:            "実際のAPIキー",
  authDomain:        "実際のプロジェクトID.firebaseapp.com",
  projectId:         "実際のプロジェクトID",
  storageBucket:     "実際のプロジェクトID.appspot.com",
  messagingSenderId: "実際の送信者ID",
  appId:             "実際のアプリID"
};
```

---

## 7. Firestore セキュリティルールのデプロイ　【完了】

```bash
firebase deploy --only firestore:rules
```

---

## 8. Firebase Hosting へのデプロイ

### 8-1. Hosting の有効化（初回のみ）

1. Firebase Console → 左メニュー「構築」→「Hosting」
2. 「始める」をクリック → 画面の指示に従う（CLI 手順は後述のコマンドで代替可）
3. 最後まで進んで「コンソールに移動」

### 8-2. デプロイ実行

```bash
cd e:/_html/kakeibo
firebase deploy --only hosting
```

デプロイ完了後、ターミナルに以下のような URL が表示されます：

```
Hosting URL: https://kakeibo-xxxxx.web.app
```

この URL でアプリにアクセスできます。

### 8-3. カスタムドメインの設定（任意）

独自ドメインを使いたい場合は Firebase Console → Hosting → 「カスタムドメインを追加」から設定できます。

---

## 9. ユーザーの作成

### Firebase Authentication にユーザーを追加

1. Firebase Console → Authentication → 「ユーザー」タブ
2. 「ユーザーを追加」をクリック
3. 以下の形式でメールアドレスを設定：

```
メールアドレス: {ユーザー名}@kakeibo.local
パスワード:     任意のパスワード
```

例: ユーザー名が `yamada` の場合 → `yamada@kakeibo.local`

### Firestore にユーザードキュメントを追加

Authentication でユーザーを作成すると UID が発行されます。
Firebase Console → Firestore → 「データ」タブで以下を手動作成してください：

```
コレクション: users
ドキュメント ID: {AuthenticationのUID}
フィールド:
  userName: "yamada"     （ユーザー名、文字列型）
  groupId:  "group1"     （グループID、任意の文字列）
```

---

## 10. マスターデータ（項目・決済方法）の投入

Firestore Console で各ユーザーの `users/{uid}/items` と `users/{uid}/methods` に
データを手動で追加します。

### items サブコレクションの例

```
users/{uid}/items/{自動IDまたは任意ID}
  categoryId: "1"         （収入）
  name:       "給与"

users/{uid}/items/{自動IDまたは任意ID}
  categoryId: "2"         （支出）
  name:       "食費"

users/{uid}/items/{自動IDまたは任意ID}
  categoryId: "3"         （チャージ）
  name:       "電子マネーチャージ"
```

### methods サブコレクションの例

```
users/{uid}/methods/{自動IDまたは任意ID}
  categoryId: "1"
  name:       "銀行振込"

users/{uid}/methods/{自動IDまたは任意ID}
  categoryId: "2"
  name:       "現金"

users/{uid}/methods/{自動IDまたは任意ID}
  categoryId: "2"
  name:       "クレジットカード"
```

> **注意:** `categoryId` は文字列型（`"1"`, `"2"`, `"3"`）で登録してください。数値型では動作しません。

---

## 11. 動作確認チェックリスト

- [x] `js/firebase.js` の `firebaseConfig` を実際の値に更新した
- [x] Firestore セキュリティルールをデプロイした
- [ ] Firebase Hosting にデプロイした
- [ ] Firebase Console でユーザーを作成した（Authentication）
- [ ] Firestore に `users/{uid}` ドキュメントを作成した
- [ ] Firestore に `users/{uid}/items` と `users/{uid}/methods` を投入した
- [ ] ログインページでユーザー名とパスワードが正常に認証される
- [ ] 収支の登録・検索・グラフ表示が正常に動作する
- [ ] 定期購入の登録と一覧表示が正常に動作する

---

## Firestore データ構造（参考）

```
users/{uid}
  ├── userName: string
  ├── groupId:  string
  │
  ├── items/{itemId}
  │     ├── categoryId: string  ("1"|"2"|"3")
  │     └── name:       string
  │
  ├── methods/{methodId}
  │     ├── categoryId: string  ("1"|"2"|"3")
  │     └── name:       string
  │
  ├── transactions/{autoId}
  │     ├── itemId:     string
  │     ├── itemName:   string   (非正規化)
  │     ├── methodId:   string
  │     ├── methodName: string   (非正規化)
  │     ├── categoryId: string   (非正規化)
  │     ├── amount:     number
  │     ├── date:       string   (YYYYMMDD)
  │     ├── memo:       string
  │     └── createdAt:  Timestamp
  │
  └── subscriptions/{autoId}
        ├── itemId:          string
        ├── itemName:        string
        ├── methodId:        string
        ├── methodName:      string
        ├── categoryId:      string
        ├── amount:          number
        ├── startDate:       string   (YYYY-MM-DD)
        ├── frequencyType:   string   ("daily"|"weekly"|"monthly"|"yearly")
        ├── frequencyValue:  number
        ├── nextPurchaseDate: string  (YYYYMMDD)
        └── memo:            string
```
