// login.js
// Firebase Authentication を使ったログイン・認証チェック・ログアウト処理
// ユーザー名 + パスワードでログインできるよう、内部では
// {userName}@kakeibo.local を Email として Firebase Auth に登録・利用する。

async function login() {
  const userNameInput = document.getElementById("userName").value.trim();
  const passwordInput = document.getElementById("password").value;
  const errorEl       = document.getElementById("login-error");
  const submitButton  = document.querySelector('.btn-primary[type="submit"]');

  if (errorEl) errorEl.textContent = "";

  if (submitButton) {
    submitButton.disabled    = true;
    submitButton.textContent = "ログイン中...";
  }

  try {
    // ユーザー名から内部 Email を構築
    const email = `${userNameInput}@kakeibo.com`;

    // Firebase Auth でサインイン
    const cred = await auth.signInWithEmailAndPassword(email, passwordInput);
    const uid  = cred.user.uid;

    // Firestore からユーザー情報（userName, groupId）を取得
    const userDoc  = await db.collection("users").doc(uid).get();
    const userName = userDoc.exists ? (userDoc.data().userName || userNameInput) : userNameInput;
    const groupId  = userDoc.exists ? (userDoc.data().groupId  || "")            : "";

    // ドキュメントが存在しない、または userName が未設定の場合は作成・補完
    // ※ Firestore のセキュリティルールで get() による管理者チェックが機能するために必要
    if (!userDoc.exists) {
      await db.collection("users").doc(uid).set({ userName, groupId });
    } else if (!userDoc.data().userName) {
      await db.collection("users").doc(uid).update({ userName });
    }

    // セッションストレージに保存（ページ遷移間の高速チェック用）
    sessionStorage.setItem("isLoggedIn", "true");
    sessionStorage.setItem("userId",     uid);
    sessionStorage.setItem("userName",   userName);
    sessionStorage.setItem("groupId",    groupId);

    window.location.href = "/html/menu.html";

  } catch (error) {
    console.error("Login Error:", error);
    if (errorEl) {
      if (error.code === "auth/user-not-found" || error.code === "auth/wrong-password" ||
          error.code === "auth/invalid-credential") {
        errorEl.textContent = "ユーザー名またはパスワードが正しくありません。";
      } else {
        errorEl.textContent = "ログインエラーが発生しました。";
      }
    }
    if (submitButton) {
      submitButton.disabled    = false;
      submitButton.textContent = "ログイン";
    }
  }
}

// ログイン状態をチェックする（各ページの onload から呼び出す）
function checkAuth() {
  if (sessionStorage.getItem("isLoggedIn") !== "true") {
    window.location.href = "/html/login.html";
  }
}

// ログアウト
async function logout() {
  try {
    await auth.signOut();
  } catch (e) {
    console.warn("signOut error:", e);
  }
  sessionStorage.clear();
  window.location.href = "/html/login.html";
}
