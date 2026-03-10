# Firebase セットアップ手順

家計簿アプリを Firebase（Authentication + Firestore + Hosting）で動かすためのセットアップ手順です。

> **無料プラン（Spark）について**
> Authentication・Firestore・Hosting はすべて無料枠で利用できます。
> Cloud Functions は有料プラン（Blaze）が必要なため、定期購入の自動登録機能は動作しません。
> 定期購入の登録・一覧・削除は通常通り使用できます。

---

## 前提条件

- Google アカウント
- Node.js 18 以上がインストール済み
- npm がインストール済み

---

## 1. Firebase プロジェクト作成

1. [Firebase Console](https://console.firebase.google.com/) を開く
2. 「プロジェクトを追加」をクリック
3. プロジェクト名を入力（例: `kakeibo`）し、「続行」
4. Google アナリティクスは任意（不要なら OFF）
5. 「プロジェクトを作成」をクリック

---

## 2. Authentication 有効化（メール/パスワード）

1. Firebase Console → 左メニュー「構築」→「Authentication」
2. 「始める」をクリック
3. 「Sign-in method」タブ → 「メール/パスワード」をクリック
4. 「有効にする」をオンにして「保存」

---

## 3. Firestore データベース作成

1. Firebase Console → 左メニュー「構築」→「Firestore Database」
2. 「データベースの作成」をクリック
3. **「本番環境モードで開始」** を選択して「次へ」
4. ロケーションを選択（例: `asia-northeast1`（東京））→「有効にする」

---

## 4. Firebase CLI のインストールとログイン

```bash
npm install -g firebase-tools
firebase login
```

---

## 5. プロジェクトと連携

```bash
cd e:/_html/kakeibo
firebase use --add
```

表示されたリストから手順1で作成したプロジェクトを選択し、エイリアス名（例: `default`）を入力します。

---

## 6. js/firebase.js に設定値を入力

1. Firebase Console → プロジェクト設定（歯車アイコン）→「全般」タブ
2. 「マイアプリ」セクション →「ウェブアプリを追加」（初回）または既存アプリを選択
3. `firebaseConfig` の値をコピー
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

## 7. Firestore セキュリティルールのデプロイ

```bash
firebase deploy --only firestore:rules
```

> `firestore.rules` を変更した際は必ず再デプロイしてください。

---

## 8. Firebase Hosting へのデプロイ

### 8-1. Hosting の有効化（初回のみ）

1. Firebase Console → 左メニュー「構築」→「Hosting」
2. 「始める」をクリック → 画面の指示に従う
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

### 8-3. カスタムドメインの設定（任意）

独自ドメインを使いたい場合は Firebase Console → Hosting → 「カスタムドメインを追加」から設定できます。

---

## 9. ユーザーの作成

→ 詳細は [user_registration.md](./user_registration.md) を参照してください。

### 最初に作成すべきユーザー

| ユーザー名 | パスワード | 備考 |
|---|---|---|
| `admin` | `admin1!` | 管理者。マスター管理にアクセス可能 |
| 各一般ユーザー | 任意 | 家計簿を使用するユーザー |

---

## 10. マスターデータ（項目）の投入

管理者でログイン後、メニューの「マスター管理」から項目・決済方法を追加できます。

初回は Firestore Console で `items` コレクションに直接登録することも可能です：

```
items/{自動ID}
  categoryId: "1"    (収入)
  name:       "給与"
  isHidden:   false
  sortOrder:  0

items/{自動ID}
  categoryId: "2"    (支出)
  name:       "食費"
  isHidden:   false
  sortOrder:  0
```

> `categoryId` は文字列型（`"1"`, `"2"`, `"3"`）で登録してください。数値型では動作しません。

---

## 11. 動作確認チェックリスト

- [ ] `js/firebase.js` の `firebaseConfig` を実際の値に更新した
- [ ] Firestore セキュリティルールをデプロイした（`firebase deploy --only firestore:rules`）
- [ ] Firebase Hosting にデプロイした
- [ ] admin ユーザーを Firebase Console で作成した
- [ ] Firestore に `users/{uid}` ドキュメント（userName: "admin"）を作成した
- [ ] 一般ユーザーを作成した
- [ ] admin でログインし「マスター管理」から項目・方法を追加した
- [ ] 一般ユーザーでログインし収支の登録・検索・グラフ表示が動作する

---

## Firestore データ構造

```
items/{itemId}                      ← グローバル（全ユーザー共通）
  categoryId: string  ("1"|"2"|"3")
  name:       string
  isHidden:   boolean
  sortOrder:  number

users/{uid}
  userName: string
  groupId:  string

users/{uid}/methods/{methodId}      ← 個人の決済方法
  categoryId:    string  ("1"|"2"|"3")
  name:          string
  isGroupShared: boolean
  isHidden:      boolean
  sortOrder:     number

users/{uid}/transactions/{autoId}
  itemId:        string
  itemName:      string   (非正規化)
  methodId:      string
  methodName:    string   (非正規化)
  categoryId:    string   (非正規化)
  amount:        number
  date:          string   (YYYYMMDD)
  memo:          string
  isGroupShared: boolean
  groupId:       string
  createdAt:     Timestamp

users/{uid}/subscriptions/{autoId}
  itemId:           string
  itemName:         string
  methodId:         string
  methodName:       string
  categoryId:       string
  amount:           number
  startDate:        string   (YYYY-MM-DD)
  frequencyType:    string   ("daily"|"weekly"|"monthly"|"yearly")
  frequencyValue:   number
  nextPurchaseDate: string   (YYYYMMDD)
  memo:             string

users/{uid}/settings/itemSortOrder  ← 項目の表示順（ユーザー固有）
  "1": string[]   (収入カテゴリの itemId 順序)
  "2": string[]   (支出カテゴリの itemId 順序)
  "3": string[]   (チャージカテゴリの itemId 順序)

groups/{groupId}/methods/{methodId} ← グループ共有の決済方法
  categoryId: string
  name:       string
  isHidden:   boolean
  sortOrder:  number
```
