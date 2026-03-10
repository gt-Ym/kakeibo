// 共通ヘッダー読み込み
function loadHeader() {
  const container = document.getElementById("app-header");
  if (!container) return;

  // ヘッダー用のクラスを付与して余白を確保
  document.body.classList.add("has-app-header");

  fetch("header.html")
    .then((response) => {
      if (!response.ok) {
        throw new Error("Failed to load header.html");
      }
      return response.text();
    })
    .then((html) => {
      container.innerHTML = html;
      const userEl = document.getElementById("app-header-user");
      if (userEl) {
        const userName = sessionStorage.getItem("userName") || "";
        if (userName) userEl.textContent = userName;
      }
    })
    .catch((error) => {
      console.error("Header load error:", error);
    });
}

document.addEventListener("DOMContentLoaded", loadHeader);

