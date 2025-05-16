const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const elements = {
  logDir: document.querySelector("#log-dir"),
  openExplorerButton: document.querySelector("#open-explorer"),
  sendButton: document.querySelector("#send-button"),
  dataInput: document.querySelector("#data-input"),
  outputArea: document.querySelector("#output-area"),
  resetButton: document.querySelector("#reset-button"),
};

let isWatching = false;
// 手動でクリックされたブロックを追跡するためのセット
const manuallyHighlightedBlocks = new Set();

window.addEventListener("DOMContentLoaded", async () => {
  await displayLogDir();
  autoStartWatcher();
});

async function displayLogDir() {
  try {
    const logFilePath = await invoke("get_latest_log_file");
    elements.logDir.textContent = logFilePath || "ログファイルが見つかりませんでした。";
  } catch (e) {
    elements.logDir.textContent = `エラー: ${e}`;
  }
}

elements.openExplorerButton.addEventListener("click", async () => {
  const filePath = elements.logDir.textContent;
  if (!filePath || filePath === "ログファイルが見つかりませんでした。") return;

  try {
    await invoke("open_explorer", { path: filePath });
  } catch (e) {
    console.error("エクスプローラーを開く際にエラーが発生しました", e);
  }
});

elements.sendButton.addEventListener("click", async () => {
  const rawInput = elements.dataInput.value.trim();
  if (!rawInput) {
    updateOutput("<p>入力が空です。</p>");
    return;
  }

  try {
    const html = await invoke("split_and_format", { text: rawInput });
    updateOutput(html);
    // HTML更新後に、クリックイベントを追加
    addClickHandlersToBlocks();
    startWatcher();
  } catch (e) {
    updateOutput(`<p>エラー: ${e}</p>`);
  }
});

elements.resetButton.addEventListener("click", async () => {
  try {
    await invoke("send_reset");
  } catch (e) {
    console.error("リセット信号の送信に失敗しました", e);
  }
});

function updateOutput(content) {
  elements.outputArea.innerHTML = content;
}

// 更新後にクリックイベントを追加する関数
function addClickHandlersToBlocks() {
  const blocks = document.querySelectorAll(".data-block");
  blocks.forEach(block => {
    block.addEventListener("click", function() {
      const numberElement = this.querySelector(".number");
      const number = parseInt(numberElement?.textContent.trim(), 10);
      
      // ブロックのID作成
      const blockId = `block-${number}`;
      
      if (manuallyHighlightedBlocks.has(blockId)) {
        // 既に手動で赤くされている場合は元に戻す
        this.style.backgroundColor = '';
        manuallyHighlightedBlocks.delete(blockId);
      } else {
        // 手動で赤くする
        this.style.backgroundColor = 'red';
        manuallyHighlightedBlocks.add(blockId);
      }
    });
  });
}

function extractTargets() {
  return Array.from(document.querySelectorAll(".data-block"))
    .map(block => {
      const number = parseInt(block.querySelector(".number")?.textContent.trim(), 10);
      const value = block.querySelector(".value")?.textContent.trim();
      return { number, value };
    })
    .filter(item => item.value?.length > 0);
}

async function startWatcher() {
  const values = extractTargets();
  if (values.length === 0) {
    console.warn("検索対象が設定されていません。");
    return;
  }

  try {
    isWatching = true;
    await invoke("start_log_watch", { targets: values });
  } catch (e) {
    console.error("ログファイルの監視中にエラーが発生しました", e);
  }
}

function autoStartWatcher() {
  if (document.querySelectorAll(".data-block").length > 0) {
    addClickHandlersToBlocks(); // 初期ロード時にもクリックハンドラを追加
    startWatcher();
  }
}

listen('log-hit', event => {
  console.log('ヒットした number:', event.payload);
  const hitNumber = parseInt(event.payload, 10);

  const blocks = document.querySelectorAll(".data-block");
  blocks.forEach(block => {
    const numberElement = block.querySelector(".number");
    const number = parseInt(numberElement?.textContent.trim(), 10);
    const blockId = `block-${number}`;
    
    if (number === hitNumber) {
      // 手動ハイライトされていない場合のみ色を変更
      if (!manuallyHighlightedBlocks.has(blockId)) {
        block.style.backgroundColor = 'red'; // 背景色を赤に変更
      }
    }
  });
});

listen('reset-hit', () => {
  // 背景色を元に戻す（手動でハイライトされていないもののみ）
  const blocks = document.querySelectorAll(".data-block");
  blocks.forEach(block => {
    const numberElement = block.querySelector(".number");
    const number = parseInt(numberElement?.textContent.trim(), 10);
    const blockId = `block-${number}`;
    
    // 手動でハイライトされていない場合のみリセット
    if (!manuallyHighlightedBlocks.has(blockId)) {
      block.style.backgroundColor = ''; // 色を元に戻す
    }
  });
});