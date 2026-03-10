// sample.js
// 家計簿入力（収入・支出・チャージ）のモーダルウィザード
// Firestore を使用してデータを保存する

let itemsData = [];   // [{ id, categoryId, name }, ...]
let methodsData = []; // [{ id, categoryId, name }, ...]
let currentCategoryId = null;

document.addEventListener("DOMContentLoaded", function () {
  const params = new URLSearchParams(window.location.search);
  const categoryId = params.get("categoryId");
  currentCategoryId = categoryId;
  openModal("modal-loading");
  updatePageTitle(categoryId);

  requireAuth(() => {
    loadMasterData(categoryId).then(() => {
      startInput();
    });
  });
});

function startInput() {
  document.getElementById("modal-date").value = getTodayISO();
  openModal("modal-item");
}

function openModal(modalId) {
  closeAllModals();
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add("active");
    if (modalId === "modal-item")   showRecentItems();
    if (modalId === "modal-method") {
      showRecentMethods();
      const methodTitle = document.querySelector("#modal-method .modal-title");
      if (methodTitle) {
        methodTitle.textContent = currentCategoryId === "1"
          ? "受取方法を選択してください"
          : "決済方法を選択してください";
      }
    }
  }
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay").forEach(m => m.classList.remove("active"));
}

function nextStep(currentStep) {
  if (!validateStep(currentStep)) return;
  const map = { 1: "modal-method", 2: "modal-amount-overlay", 3: "modal-date-overlay", 4: "modal-memo-overlay" };
  if (currentStep === 5) {
    showConfirmModal();
  } else {
    openModal(map[currentStep]);
  }
}

function previousStep(currentStep) {
  const map = { 2: "modal-item", 3: "modal-method", 4: "modal-amount-overlay", 5: "modal-date-overlay" };
  openModal(map[currentStep]);
}

function validateStep(step) {
  if (step === 1 && !document.getElementById("modal-itemId").value)   { alert("項目を選択してください");     return false; }
  if (step === 2 && !document.getElementById("modal-methodId").value) { alert("決済方法を選択してください"); return false; }
  if (step === 3) {
    const v = Number(document.getElementById("modal-amount").value);
    if (!v || v <= 0) { alert("金額を入力してください"); return false; }
  }
  if (step === 4 && !document.getElementById("modal-date").value) { alert("日付を選択してください"); return false; }
  return true;
}

function showConfirmModal() {
  populateConfirmSelects();
  document.getElementById("confirm-itemId").value   = document.getElementById("modal-itemId").value;
  document.getElementById("confirm-methodId").value = document.getElementById("modal-methodId").value;
  document.getElementById("confirm-amount").value   = document.getElementById("modal-amount").value;
  document.getElementById("confirm-date").value     = document.getElementById("modal-date").value;
  document.getElementById("confirm-memo").value     = document.getElementById("modal-memo").value;
  openModal("modal-confirm");
}

function populateConfirmSelects() {
  const itemSelect   = document.getElementById("confirm-itemId");
  const methodSelect = document.getElementById("confirm-methodId");

  itemSelect.innerHTML = "";
  itemsData.forEach(item => {
    const opt       = document.createElement("option");
    opt.value       = item.id;
    opt.textContent = item.name;
    itemSelect.appendChild(opt);
  });

  methodSelect.innerHTML = "";
  methodsData.forEach(method => {
    const opt       = document.createElement("option");
    opt.value       = method.id;
    opt.textContent = method.name;
    methodSelect.appendChild(opt);
  });
}

function backToEdit() {
  document.getElementById("modal-itemId").value   = document.getElementById("confirm-itemId").value;
  document.getElementById("modal-methodId").value = document.getElementById("confirm-methodId").value;
  document.getElementById("modal-amount").value   = document.getElementById("confirm-amount").value;
  document.getElementById("modal-date").value     = document.getElementById("confirm-date").value;
  document.getElementById("modal-memo").value     = document.getElementById("confirm-memo").value;
  openModal("modal-item");
}

/**
 * Firestore へトランザクションを保存する
 */
async function sendData() {
  const uid      = getCurrentUserId();
  const itemId   = document.getElementById("confirm-itemId").value;
  const methodId = document.getElementById("confirm-methodId").value;
  const amount   = Number(document.getElementById("confirm-amount").value);
  const date     = document.getElementById("confirm-date").value.replace(/-/g, ""); // YYYYMMDD
  const memo     = document.getElementById("confirm-memo").value.trim();

  const itemObj   = itemsData.find(i => i.id === itemId)     || {};
  const methodObj = methodsData.find(m => m.id === methodId) || {};

  const btn = document.getElementById("send-btn");
  btn.disabled    = true;
  btn.textContent = "送信中...";

  try {
    const txRepo = new TransactionRepository(uid);
    await txRepo.add({
      itemId,
      itemName:      itemObj.name        || "",
      methodId,
      methodName:    methodObj.name      || "",
      categoryId:    currentCategoryId,
      amount,
      date,
      memo,
      isGroupShared: methodObj.isGroupShared || false,
    });

    await updateMonthlySummaryForDate(uid, date);
    saveRecentInput(itemId, methodId);
    alert("送信しました。");
    window.location.href = "/html/menu.html";
  } catch (err) {
    console.error("送信エラー:", err);
    alert("送信に失敗しました。");
    btn.disabled    = false;
    btn.textContent = "送信する";
  }
}

/**
 * Firestore からカテゴリのマスターデータを取得し、セレクタを更新する
 */
async function loadMasterData(categoryId) {
  const uid = getCurrentUserId();
  if (!uid) {
    alert("ユーザー情報が取得できません。再度ログインしてください。");
    window.location.href = "/html/login.html";
    return;
  }

  try {
    const { items, methods } = await fetchMasterData(uid, categoryId);
    itemsData   = items;
    methodsData = methods;
    populateSelect(document.getElementById("modal-itemId"),   items,   "選択してください");
    populateSelect(document.getElementById("modal-methodId"), methods, "選択してください");
  } catch (err) {
    console.error("マスターデータ取得エラー:", err);
    alert("データの取得に失敗しました。");
  }
}

function updatePageTitle(categoryId) {
  const el = document.getElementById("page-title");
  if (!el) return;
  const map = { "1": "収入入力", "2": "支出入力", "3": "チャージ入力" };
  el.textContent = map[categoryId] || "家計簿入力";
}

function saveRecentInput(itemId, methodId) {
  const itemsKey   = `recentItems_${currentCategoryId}`;
  const methodsKey = `recentMethods_${currentCategoryId}`;

  let ri = JSON.parse(localStorage.getItem(itemsKey) || "[]").filter(id => id !== itemId);
  ri.unshift(itemId);
  localStorage.setItem(itemsKey, JSON.stringify(ri.slice(0, 3)));

  let rm = JSON.parse(localStorage.getItem(methodsKey) || "[]").filter(id => id !== methodId);
  rm.unshift(methodId);
  localStorage.setItem(methodsKey, JSON.stringify(rm.slice(0, 3)));
}

function showRecentItems() {
  const recentItems = JSON.parse(localStorage.getItem(`recentItems_${currentCategoryId}`) || "[]");
  const container   = document.getElementById("recent-items-buttons");
  if (recentItems.length === 0) { container.style.display = "none"; return; }

  container.innerHTML = "";
  recentItems.forEach(itemId => {
    const item = itemsData.find(i => i.id === itemId);
    if (!item) return;
    const btn       = document.createElement("button");
    btn.type        = "button";
    btn.className   = "btn btn-quick";
    btn.onclick     = () => applyRecentItem(itemId);
    btn.textContent = item.name;
    container.appendChild(btn);
  });
  container.style.display = "flex";
}

function showRecentMethods() {
  const recentMethods = JSON.parse(localStorage.getItem(`recentMethods_${currentCategoryId}`) || "[]");
  const container     = document.getElementById("recent-methods-buttons");
  if (recentMethods.length === 0) { container.style.display = "none"; return; }

  container.innerHTML = "";
  recentMethods.forEach(methodId => {
    const method = methodsData.find(m => m.id === methodId);
    if (!method) return;
    const btn       = document.createElement("button");
    btn.type        = "button";
    btn.className   = "btn btn-quick";
    btn.onclick     = () => applyRecentMethod(methodId);
    btn.textContent = method.name;
    container.appendChild(btn);
  });
  container.style.display = "flex";
}

function applyRecentItem(itemId)     { document.getElementById("modal-itemId").value   = itemId; }
function applyRecentMethod(methodId) { document.getElementById("modal-methodId").value = methodId; }
