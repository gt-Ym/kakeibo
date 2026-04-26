// firebaseDb.js
// Firestore の CRUD 操作をクラスとして提供する。
// firebase.js を先に読み込んでおくこと（db がグローバルに定義済みであること）。

// ─────────────────────────────────────────
// 内部ヘルパー
// ─────────────────────────────────────────

/**
 * Firestore の get を実行し、エラー時は空の結果を返す
 * @param {firebase.firestore.Query|firebase.firestore.DocumentReference} ref
 * @returns {Promise<{docs: Array}>}
 */
function _safeGet(ref) {
  return ref.get().catch(e => {
    console.warn("Firestore取得エラー:", e.message);
    return { docs: [] };
  });
}

// ─────────────────────────────────────────
// ItemRepository
// グローバルコレクション items/{itemId}（全ユーザー共通）
// ─────────────────────────────────────────

class ItemRepository {
  /**
   * @param {string} categoryId  "1"|"2"|"3"
   */
  constructor(categoryId) {
    this.categoryId = categoryId;
  }

  /**
   * カテゴリに一致するアイテム一覧を取得する（非表示を除く、sortOrder順）
   * @returns {Promise<Array<{id: string, categoryId: string, name: string}>>}
   */
  async getAll() {
    const snap = await _safeGet(
      db.collection("items").where("categoryId", "==", this.categoryId)
    );
    return snap.docs
      .map(doc => ({
        id:         doc.id,
        categoryId: doc.data().categoryId,
        name:       doc.data().name,
        isHidden:   doc.data().isHidden   || false,
        sortOrder:  doc.data().sortOrder  ?? 9999,
      }))
      .filter(item => !item.isHidden)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
  }

  /**
   * 管理ページ用: 非表示含む全件を sortOrder 順で返す
   * @param {string} categoryId
   * @returns {Promise<Array>}
   */
  async getAllForManage(categoryId) {
    const snap = await _safeGet(
      db.collection("items").where("categoryId", "==", categoryId)
    );
    return snap.docs
      .map(doc => ({
        id:         doc.id,
        categoryId: doc.data().categoryId,
        name:       doc.data().name,
        isHidden:   doc.data().isHidden  || false,
        sortOrder:  doc.data().sortOrder ?? 9999,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
  }

  /**
   * 項目を追加する（末尾 sortOrder）
   * @param {string} categoryId
   * @param {string} name
   */
  async add(categoryId, name) {
    const existing  = await this.getAllForManage(categoryId);
    const maxOrder  = existing.length > 0
      ? Math.max(...existing.map(i => i.sortOrder === 9999 ? existing.length : i.sortOrder))
      : -1;
    const docRef = await db.collection("items").add({
      categoryId,
      name,
      isHidden:  false,
      sortOrder: maxOrder + 1,
    });
    return docRef.id;
  }

  /**
   * 項目名を更新する
   * @param {string} docId
   * @param {string} name
   */
  async updateName(docId, name) {
    await db.doc(`items/${docId}`).update({ name });
  }

  /**
   * 非表示フラグを切り替える
   * @param {string} docId
   * @param {boolean} isHidden
   */
  async setHidden(docId, isHidden) {
    await db.doc(`items/${docId}`).update({ isHidden });
  }

  /**
   * 並び順を順次更新する
   * @param {string[]} orderedIds  表示順のIDリスト
   */
  async updateSortOrders(orderedIds) {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.doc(`items/${orderedIds[i]}`).update({ sortOrder: i });
    }
  }
}

// ─────────────────────────────────────────
// MethodRepository
// 個人: users/{uid}/methods
// グループ共有: groups/{groupId}/methods
// ─────────────────────────────────────────

class MethodRepository {
  /**
   * @param {string} uid
   * @param {string} categoryId  "1"|"2"|"3"
   */
  constructor(uid, categoryId) {
    this.uid        = uid;
    this.categoryId = categoryId;
    this.groupId    = sessionStorage.getItem("groupId") || null;
  }

  /**
   * カテゴリに一致するメソッド一覧を取得する（個人＋グループ共有、非表示を除く、sortOrder順）
   * @returns {Promise<Array<{id: string, categoryId: string, name: string, isGroupShared: boolean}>>}
   */
  async getAll() {
    const personalSnap = await _safeGet(
      db.collection(`users/${this.uid}/methods`)
        .where("categoryId", "==", this.categoryId)
    );

    let groupDocs = [];
    if (this.groupId) {
      const groupSnap = await _safeGet(
        db.collection(`groups/${this.groupId}/methods`)
          .where("categoryId", "==", this.categoryId)
      );
      groupDocs = groupSnap.docs;
    }

    const personal = personalSnap.docs
      .filter(doc => !doc.data().isHidden)
      .map(doc => ({
        id:            doc.id,
        categoryId:    doc.data().categoryId,
        name:          doc.data().name,
        isGroupShared: doc.data().isGroupShared || false,
        sortOrder:     doc.data().sortOrder ?? 9999,
      }));

    const group = groupDocs
      .filter(doc => !doc.data().isHidden)
      .map(doc => ({
        id:            doc.id,
        categoryId:    doc.data().categoryId,
        name:          doc.data().name,
        isGroupShared: true,
        sortOrder:     doc.data().sortOrder ?? 9999,
      }));

    return [...personal, ...group]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
  }

  /**
   * 管理ページ用: 個人メソッドの非表示含む全件を sortOrder 順で返す
   * @param {string} categoryId
   * @returns {Promise<Array>}
   */
  async getAllForManage(categoryId) {
    // まず categoryId フィルタありで取得
    const snap = await db.collection(`users/${this.uid}/methods`)
      .where("categoryId", "==", categoryId)
      .get();

    if (!snap.empty) {
      return snap.docs
        .map(doc => ({
          id:            doc.id,
          categoryId:    doc.data().categoryId,
          name:          doc.data().name,
          isGroupShared: doc.data().isGroupShared || false,
          isHidden:      doc.data().isHidden      || false,
          sortOrder:     doc.data().sortOrder     ?? 9999,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
    }

    // フィルタ結果が空の場合、categoryId なしで全件取得して categoryId を文字列・数値両方で照合
    const allSnap = await db.collection(`users/${this.uid}/methods`).get();
    const categoryIdNum = Number(categoryId);
    return allSnap.docs
      .filter(doc => {
        const cid = doc.data().categoryId;
        return String(cid) === String(categoryId) || cid === categoryIdNum;
      })
      .map(doc => ({
        id:            doc.id,
        categoryId:    doc.data().categoryId,
        name:          doc.data().name,
        isGroupShared: doc.data().isGroupShared || false,
        isHidden:      doc.data().isHidden      || false,
        sortOrder:     doc.data().sortOrder     ?? 9999,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "ja"));
  }

  /**
   * 個人メソッドを追加する
   * @param {string} categoryId
   * @param {{name: string, isGroupShared: boolean}} data
   */
  async add(categoryId, data) {
    const existing = await this.getAllForManage(categoryId);
    const maxOrder = existing.length > 0
      ? Math.max(...existing.map(m => m.sortOrder === 9999 ? existing.length : m.sortOrder))
      : -1;
    const docRef = await db.collection(`users/${this.uid}/methods`).add({
      categoryId,
      name:          data.name,
      isGroupShared: data.isGroupShared || false,
      isHidden:      false,
      sortOrder:     maxOrder + 1,
    });
    return docRef.id;
  }

  /**
   * 個人メソッドの名前とグループ共有フラグを更新する
   * @param {string} docId
   * @param {{name: string, isGroupShared: boolean}} data
   */
  async updateMethod(docId, data) {
    await db.doc(`users/${this.uid}/methods/${docId}`).update({
      name:          data.name,
      isGroupShared: data.isGroupShared || false,
    });
  }

  /**
   * 個人メソッドの非表示フラグを切り替える
   * @param {string} docId
   * @param {boolean} isHidden
   */
  async setHidden(docId, isHidden) {
    await db.doc(`users/${this.uid}/methods/${docId}`).update({ isHidden });
  }

  /**
   * 個人メソッドの並び順を一括更新する（バッチ書き込み）
   * @param {string[]} orderedIds  表示順のIDリスト
   */
  async updateSortOrders(orderedIds) {
    const batch = db.batch();
    orderedIds.forEach((id, index) => {
      batch.update(db.doc(`users/${this.uid}/methods/${id}`), { sortOrder: index });
    });
    await batch.commit();
  }

  /**
   * methodId から { name, isGroupShared } を解決する（update 時に使用）
   * 個人メソッド → グループメソッドの順に検索する
   * @param {string} methodId
   * @returns {Promise<{name: string, isGroupShared: boolean}>}
   */
  async resolve(methodId) {
    try {
      const doc = await db.doc(`users/${this.uid}/methods/${methodId}`).get();
      if (doc.exists) return { name: doc.data().name, isGroupShared: false };
    } catch (e) {
      console.warn("個人メソッド取得エラー:", e.message);
    }
    if (this.groupId) {
      try {
        const doc = await db.doc(`groups/${this.groupId}/methods/${methodId}`).get();
        if (doc.exists) return { name: doc.data().name, isGroupShared: true };
      } catch (e) {
        console.warn("グループメソッド取得エラー:", e.message);
      }
    }
    return { name: "", isGroupShared: false };
  }
}

// ─────────────────────────────────────────
// TransactionRepository
// users/{uid}/transactions
// ─────────────────────────────────────────

class TransactionRepository {
  /**
   * @param {string} uid
   */
  constructor(uid) {
    this.uid     = uid;
    this.groupId = sessionStorage.getItem("groupId") || null;
  }

  /**
   * トランザクションを追加する
   * @param {Object} data
   *   { itemId, itemName, methodId, methodName, categoryId, amount, date, memo, isGroupShared }
   * @returns {Promise<string>} 追加されたドキュメントID
   */
  async add(data) {
    const doc = {
      itemId:        data.itemId,
      itemName:      data.itemName,
      methodId:      data.methodId,
      methodName:    data.methodName,
      categoryId:    data.categoryId,
      amount:        Number(data.amount),
      date:          data.date,
      memo:          data.memo || "",
      uid:           this.uid,
      userName:      sessionStorage.getItem("userName") || "",
      groupId:       this.groupId || "",
      isGroupShared: data.isGroupShared || false,
      createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
    };
    // USD 入力時の監査用フィールド（amount は常に円）
    if (data.originalCurrency === "USD") {
      doc.originalAmount   = data.originalAmount;
      doc.originalCurrency = "USD";
      doc.exchangeRate     = data.exchangeRate;
    }
    const docRef = await db.collection(`users/${this.uid}/transactions`).add(doc);
    return docRef.id;
  }

  /**
   * トランザクション一覧を取得し、クライアント側でフィルタ・ソートする
   * includeGroup=true の場合、同グループのグループ共有取引も含める
   * @param {Object} filters
   *   { year, month, categoryId, itemId, methodId, minAmount, maxAmount, memo, sortKey, includeGroup }
   * @returns {Promise<Array>}
   */
  async getAll(filters = {}) {
    const snap = await db.collection(`users/${this.uid}/transactions`).get();
    let records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (filters.includeGroup && this.groupId) {
      try {
        const groupSnap = await db.collectionGroup("transactions")
          .where("groupId",       "==", this.groupId)
          .where("isGroupShared", "==", true)
          .get();
        const groupRecords = groupSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(r => r.uid !== this.uid);
        records = [...records, ...groupRecords];
      } catch (e) {
        console.warn("グループ取引の取得をスキップ（インデックス未作成の可能性）:", e.message);
      }
    }

    if (filters.year) {
      const prefix = filters.month
        ? `${filters.year}${filters.month}`
        : `${filters.year}`;
      records = records.filter(r => String(r.date).startsWith(prefix));
    }
    if (filters.categoryId) {
      records = records.filter(r => r.categoryId === String(filters.categoryId));
    }
    if (filters.itemId) {
      records = records.filter(r => r.itemId === filters.itemId);
    }
    if (filters.methodId) {
      records = records.filter(r => r.methodId === filters.methodId);
    }
    if (filters.minAmount !== "" && filters.minAmount != null) {
      records = records.filter(r => Number(r.amount) >= Number(filters.minAmount));
    }
    if (filters.maxAmount !== "" && filters.maxAmount != null) {
      records = records.filter(r => Number(r.amount) <= Number(filters.maxAmount));
    }
    if (filters.memo) {
      const keyword = filters.memo.toLowerCase();
      records = records.filter(r => (r.memo || "").toLowerCase().includes(keyword));
    }

    const sortKey = filters.sortKey || "date_desc";
    records.sort((a, b) => {
      if (sortKey === "date_asc")    return String(a.date).localeCompare(String(b.date));
      if (sortKey === "date_desc")   return String(b.date).localeCompare(String(a.date));
      if (sortKey === "amount_asc")  return Number(a.amount) - Number(b.amount);
      if (sortKey === "amount_desc") return Number(b.amount) - Number(a.amount);
      return String(b.date).localeCompare(String(a.date));
    });

    return records;
  }

  /**
   * グラフ用: カテゴリ・年月でフィルタしたトランザクションを取得する
   * 自分の取引 + グループメンバーのグループ共有取引を含む
   * @param {string} categoryId
   * @param {string} year   例: "2025"
   * @param {string} month  例: "01"（空文字は年全体）
   * @returns {Promise<Array>}
   */
  async getByCategory(categoryId, year, month) {
    const snap = await db.collection(`users/${this.uid}/transactions`)
      .where("categoryId", "==", categoryId)
      .get();
    let records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (this.groupId) {
      try {
        const groupSnap = await db.collectionGroup("transactions")
          .where("groupId",       "==", this.groupId)
          .where("isGroupShared", "==", true)
          .get();
        const groupRecords = groupSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(r => r.uid !== this.uid && r.categoryId === categoryId);
        records = [...records, ...groupRecords];
      } catch (e) {
        console.warn("グループ取引の取得をスキップ:", e.message);
      }
    }

    if (year) {
      const prefix = month ? `${year}${month}` : `${year}`;
      records = records.filter(r => String(r.date).startsWith(prefix));
    }

    return records;
  }

  /**
   * トランザクションを更新する
   * item は items/{itemId} から、method は MethodRepository.resolve() で再取得する
   * @param {string} docId
   * @param {Object} data  { itemId, methodId, amount, date, memo }
   */
  async update(docId, data) {
    const itemDoc    = await db.doc(`items/${data.itemId}`).get();
    const itemName   = itemDoc.exists ? itemDoc.data().name       : "";
    const categoryId = itemDoc.exists ? itemDoc.data().categoryId : "";

    const methodRepo = new MethodRepository(this.uid, categoryId);
    const methodInfo = await methodRepo.resolve(data.methodId);

    await db.doc(`users/${this.uid}/transactions/${docId}`).update({
      itemId:        data.itemId,
      itemName,
      methodId:      data.methodId,
      methodName:    methodInfo.name,
      categoryId,
      amount:        Number(data.amount),
      date:          data.date,
      memo:          data.memo || "",
      groupId:       this.groupId || "",
      isGroupShared: methodInfo.isGroupShared,
    });
  }

  /**
   * トランザクションを削除する
   * @param {string} docId
   */
  async delete(docId) {
    await db.doc(`users/${this.uid}/transactions/${docId}`).delete();
  }
}

// ─────────────────────────────────────────
// MonthlySummaryRepository
// users/{uid}/monthlySummary/{year}/months/{month}
// ─────────────────────────────────────────

class MonthlySummaryRepository {
  /**
   * @param {string} uid
   */
  constructor(uid) {
    this.uid = uid;
  }

  /**
   * 指定年の全トランザクションを集計し monthlySummary に書き込む。
   * 各月ドキュメントのフィールド構成:
   *   { "1": { items: { 項目名: 合計 }, methods: { 方法名: 合計 }, total: 合計 },
   *     "2": { ... }, "3": { ... }, updatedAt: timestamp }
   *
   * @param {string} year  "2026"
   * @returns {Promise<number>} 処理したトランザクション件数
   */
  async buildYear(year) {
    // 1. 年内の全トランザクションを取得（クライアント側フィルタを利用）
    const txRepo  = new TransactionRepository(this.uid);
    const allData = await txRepo.getAll({ year });

    // 2. 月別・カテゴリ別に集計
    const monthly = {};
    for (let m = 1; m <= 12; m++) {
      monthly[String(m).padStart(2, "0")] = {};
    }

    allData.forEach(tx => {
      const date   = String(tx.date || "");
      if (date.length < 6) return;

      const month  = date.slice(4, 6); // "01"〜"12"
      const catId  = String(tx.categoryId || "");
      const nameI  = tx.itemName   || "不明";
      const nameM  = tx.methodName || "不明";
      const amount = Number(tx.amount) || 0;

      if (!monthly[month])        monthly[month]        = {};
      if (!monthly[month][catId]) monthly[month][catId] = { items: {}, methods: {}, total: 0 };

      monthly[month][catId].items[nameI]   = (monthly[month][catId].items[nameI]   || 0) + amount;
      monthly[month][catId].methods[nameM] = (monthly[month][catId].methods[nameM] || 0) + amount;
      monthly[month][catId].total         += amount;
    });

    // 3. 12ヶ月分を Firestore へ並列書き込み
    await Promise.all(
      Object.entries(monthly).map(([month, data]) => {
        const ref = db.doc(`users/${this.uid}/monthlySummary/${year}/months/${month}`);
        return ref.set({ ...data, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      })
    );

    return allData.length;
  }

  /**
   * 指定年月の全トランザクションを集計し monthlySummary の該当月ドキュメントを更新する。
   * 送信・編集・削除後に呼び出してリアルタイムで月次データを最新化する。
   * @param {string} year  "2026"
   * @param {string} month "01"〜"12"
   * @returns {Promise<void>}
   */
  async updateMonth(year, month) {
    const dateFrom = `${year}${month}01`;
    const dateTo   = `${year}${month}31`;
    const snap = await db.collection(`users/${this.uid}/transactions`)
      .where("date", ">=", dateFrom)
      .where("date", "<=", dateTo)
      .get();

    const catSummary = {};
    snap.docs.forEach(doc => {
      const tx     = doc.data();
      const catId  = String(tx.categoryId || "");
      if (!catId) return;
      const nameI  = tx.itemName   || "不明";
      const nameM  = tx.methodName || "不明";
      const amount = Number(tx.amount) || 0;

      if (!catSummary[catId]) catSummary[catId] = { items: {}, methods: {}, total: 0 };
      catSummary[catId].items[nameI]   = (catSummary[catId].items[nameI]   || 0) + amount;
      catSummary[catId].methods[nameM] = (catSummary[catId].methods[nameM] || 0) + amount;
      catSummary[catId].total         += amount;
    });

    const ref = db.doc(`users/${this.uid}/monthlySummary/${year}/months/${month}`);
    await ref.set({ ...catSummary, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  }

  /**
   * 指定年の月次サマリーを全月分（最大12件）取得する
   * @param {string} year
   * @returns {Promise<Object>} { "01": { "1": {...}, ... }, "02": {...}, ... }
   */
  async getYear(year) {
    const snap   = await _safeGet(db.collection(`users/${this.uid}/monthlySummary/${year}/months`));
    const result = {};
    snap.docs.forEach(doc => { result[doc.id] = doc.data(); });
    return result;
  }

  /**
   * 月次集計が存在する年の一覧を昇順で返す。
   * 「全期間」プリセット用に最古年を判定するため使用。
   *
   * 注: Firestore はサブコレクションを書いただけの "ファントム親ドキュメント" を
   *     collection().get() で返さないため、parent コレクション listing は使えない。
   *     代わりに当年〜過去10年分の months サブコレクションを並列に limit(1) でプローブする。
   *
   * @returns {Promise<string[]>} ["2024", "2025", "2026"] 形式
   */
  async listYears() {
    const currentYear  = new Date().getFullYear();
    const PROBE_RANGE  = 10;

    const probes = [];
    for (let y = currentYear; y >= currentYear - PROBE_RANGE; y--) {
      const yearStr = String(y);
      const ref     = db.collection(`users/${this.uid}/monthlySummary/${yearStr}/months`).limit(1);
      probes.push(
        ref.get()
          .then(snap => snap.empty ? null : yearStr)
          .catch(() => null)
      );
    }
    const results = await Promise.all(probes);
    return results.filter(Boolean).sort();
  }
}

// ─────────────────────────────────────────
// BudgetTargetRepository
// users/{uid}/budgetTargets/{itemId}
// ドキュメント構造: { amount, categoryId, itemName }
// ─────────────────────────────────────────

class BudgetTargetRepository {
  /**
   * @param {string} uid
   */
  constructor(uid) {
    this.uid = uid;
  }

  /**
   * 指定 itemId の予算を1件取得する
   * @param {string} itemId
   * @returns {Promise<{itemId: string, amount: number, categoryId: string, itemName: string}|null>}
   */
  async getByItemId(itemId) {
    const doc = await db.doc(`users/${this.uid}/budgetTargets/${itemId}`).get().catch(() => null);
    if (!doc || !doc.exists) return null;
    return { itemId, ...doc.data() };
  }

  /**
   * カテゴリ全件取得（budget.html 表示用）
   * @param {string} categoryId
   * @returns {Promise<Object>} { [itemId]: amount }
   */
  async getByCategoryId(categoryId) {
    const snap = await _safeGet(
      db.collection(`users/${this.uid}/budgetTargets`).where("categoryId", "==", categoryId)
    );
    const result = {};
    snap.docs.forEach(doc => { result[doc.id] = doc.data().amount ?? 0; });
    return result;
  }

  /**
   * 予算を追加・更新する
   * @param {string} itemId
   * @param {{amount: number, categoryId: string, itemName: string}} data
   */
  async set(itemId, data) {
    await db.doc(`users/${this.uid}/budgetTargets/${itemId}`).set(data, { merge: true });
  }
}

// ─────────────────────────────────────────
// SubscriptionRepository
// users/{uid}/subscriptions
// ─────────────────────────────────────────

class SubscriptionRepository {
  /**
   * @param {string} uid
   */
  constructor(uid) {
    this.uid = uid;
  }

  /**
   * サブスクリプションを追加する
   * @param {Object} data
   *   { itemId, itemName, methodId, methodName, categoryId,
   *     amount, startDate, frequencyType, frequencyValue, nextPurchaseDate, memo }
   * @returns {Promise<string>} 追加されたドキュメントID
   */
  async add(data) {
    const doc = {
      itemId:           data.itemId,
      itemName:         data.itemName,
      methodId:         data.methodId,
      methodName:       data.methodName,
      categoryId:       data.categoryId,
      amount:           Number(data.amount),
      startDate:        data.startDate,
      frequencyType:    data.frequencyType,
      frequencyValue:   Number(data.frequencyValue),
      nextPurchaseDate: data.nextPurchaseDate,
      memo:             data.memo || "",
    };
    // USD 入力時の監査用フィールド（amount は常に円）
    if (data.originalCurrency === "USD") {
      doc.originalAmount   = data.originalAmount;
      doc.originalCurrency = "USD";
      doc.exchangeRate     = data.exchangeRate;
    }
    const docRef = await db.collection(`users/${this.uid}/subscriptions`).add(doc);
    return docRef.id;
  }

  /**
   * サブスクリプション一覧を取得する
   * @returns {Promise<Array>}
   */
  async getAll() {
    const snap = await db.collection(`users/${this.uid}/subscriptions`).get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * サブスクリプションを更新する
   * @param {string} docId
   * @param {Object} data  { itemId, itemName, methodId, methodName, amount, nextPurchaseDate, memo }
   */
  async update(docId, data) {
    await db.doc(`users/${this.uid}/subscriptions/${docId}`).update({
      itemId:           data.itemId,
      itemName:         data.itemName,
      methodId:         data.methodId,
      methodName:       data.methodName,
      amount:           Number(data.amount),
      nextPurchaseDate: data.nextPurchaseDate,
      memo:             data.memo || "",
    });
  }

  /**
   * サブスクリプションを削除する
   * @param {string} docId
   */
  async delete(docId) {
    await db.doc(`users/${this.uid}/subscriptions/${docId}`).delete();
  }
}

// ─────────────────────────────────────────
// FavoriteRepository
// users/{uid}/favorites/main
// ドキュメント構造:
//   {
//     items:   { "1": [itemId, ...], "2": [...], "3": [...] },
//     methods: { "1": [methodId, ...], "2": [...], "3": [...] },
//     updatedAt: Timestamp
//   }
// 1ドキュメントに集約: ページロード時の読み取りを1回で済ませる。
// 各配列の最大長は MAX_FAVORITES（クライアント側で制限）。
// ─────────────────────────────────────────

class FavoriteRepository {
  constructor(uid) {
    this.uid    = uid;
    this.docRef = db.doc(`users/${uid}/favorites/main`);
  }

  static MAX_FAVORITES = 5;

  /**
   * お気に入り全体を取得。未作成なら空構造で返す。
   * @returns {Promise<{items: Object, methods: Object}>}
   */
  async get() {
    const snap = await this.docRef.get().catch(() => null);
    const data = (snap && snap.exists) ? snap.data() : {};
    return {
      items:   data.items   || { "1": [], "2": [], "3": [] },
      methods: data.methods || { "1": [], "2": [], "3": [] },
    };
  }

  /**
   * 指定カテゴリのお気に入り配列を上書き保存する（順序を含めて確定）。
   * 種別: "items" | "methods"
   * @param {"items"|"methods"} kind
   * @param {string} categoryId
   * @param {string[]} orderedIds - 並び順保持の ID 配列（最大 MAX_FAVORITES）
   * @returns {Promise<void>}
   */
  async setList(kind, categoryId, orderedIds) {
    if (kind !== "items" && kind !== "methods") {
      throw new Error(`invalid kind: ${kind}`);
    }
    const limited = orderedIds.slice(0, FavoriteRepository.MAX_FAVORITES);
    await this.docRef.set({
      [kind]:    { [categoryId]: limited },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}
