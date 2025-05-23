const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const elements = {
  logDir: document.querySelector("#log-dir"),
  openExplorerButton: document.querySelector("#open-explorer"),
  sendButton: document.querySelector("#send-button"),
  dataInput: document.querySelector("#data-input"),
  outputArea: document.querySelector("#output-area"),
  resetButton: document.querySelector("#reset-button"),
  recordingButton: document.querySelector("#recording-button"),
  editButton: document.querySelector("#edit-button"),
};

let isWatching = false;
let isRecording = false;
let isEditMode = false;
// 手動でクリックされたブロックを追跡するためのセット
const manuallyHighlightedBlocks = new Set();
let currentData = [];
// レコーディング用の変数
let recordedNewPlayers = []; // レコーディング中に追加された新しいプレイヤー

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

// data-inputにエンターキーイベントを追加
elements.dataInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault(); // デフォルトの動作を防ぐ
    
    const rawInput = elements.dataInput.value.trim();
    
    // 入力が空の場合はリストをクリア
    if (!rawInput) {
      clearDataAndDisplay();
      return;
    }

    try {
      const html = await invoke("split_and_format", { text: rawInput });
      updateOutput(html);
      // 現在のデータを保存
      currentData = rawInput.split(',').map(str => str.trim()).filter(str => str.length > 0);
      // HTML更新後に、クリックイベントを追加
      addClickHandlersToBlocks();
      // エディットモードが有効な場合は再有効化
      if (isEditMode) {
        enableEditMode();
      }
      startWatcher();
    } catch (e) {
      updateOutput(`<p>エラー: ${e}</p>`);
    }
  }
});

elements.sendButton.addEventListener("click", async () => {
  const rawInput = elements.dataInput.value.trim();
  
  // 入力が空の場合はリストをクリア
  if (!rawInput) {
    clearDataAndDisplay();
    return;
  }

  try {
    const html = await invoke("split_and_format", { text: rawInput });
    updateOutput(html);
    // 現在のデータを保存
    currentData = rawInput.split(',').map(str => str.trim()).filter(str => str.length > 0);
    // HTML更新後に、クリックイベントを追加
    addClickHandlersToBlocks();
    // エディットモードが有効な場合は再有効化
    if (isEditMode) {
      enableEditMode();
    }
    startWatcher();
  } catch (e) {
    updateOutput(`<p>エラー: ${e}</p>`);
  }
});

// データとディスプレイをクリアする関数
function clearDataAndDisplay() {
  currentData = [];
  updateOutput('');
  manuallyHighlightedBlocks.clear();
  console.log("データとディスプレイをクリアしました");
  
  // ウォッチャーを停止
  stopWatcher();
}

// ウォッチャーを停止する関数
async function stopWatcher() {
  try {
    // 空の配列でウォッチャーを開始することで実質的に停止
    await invoke("start_log_watch", { targets: [] });
    isWatching = false;
    console.log("ウォッチャーを停止しました");
  } catch (e) {
    console.error("ウォッチャー停止中にエラーが発生しました", e);
  }
}

elements.resetButton.addEventListener("click", async () => {
  try {
    await invoke("send_reset");
  } catch (e) {
    console.error("リセット信号の送信に失敗しました", e);
  }
});

elements.recordingButton.addEventListener("click", async () => {
  isRecording = !isRecording;
  elements.recordingButton.classList.toggle("recording-active", isRecording);
  elements.recordingButton.textContent = isRecording ? "レコーディング中" : "レコーディング";
  
  // レコーディング開始時の処理
  if (isRecording) {
    recordedNewPlayers = []; // 新プレイヤーリストをクリア
    currentData = []; // 現在のデータをクリア
    updateInputField(); // 入力欄もクリア
    updateOutput(''); // 表示もクリア
    console.log("レコーディング開始 - データをクリア");
    
    // 空のデータでもウォッチャーを確実に開始
    await startWatcherForRecording();
  } else {
    // レコーディング終了時に新しいプレイヤーがいれば統合
    if (recordedNewPlayers.length > 0) {
      integrateNewPlayersFromEmpty();
    }
  }
  
  try {
    await invoke("toggle_recording", { enabled: isRecording });
    console.log(`レコーディング状態を変更: ${isRecording}`);
  } catch (e) {
    console.error("レコーディング状態の切り替えに失敗しました", e);
  }
});

elements.editButton.addEventListener("click", () => {
  isEditMode = !isEditMode;
  elements.editButton.classList.toggle("edit-active", isEditMode);
  elements.editButton.textContent = isEditMode ? "エディット中" : "エディット";
  
  if (isEditMode) {
    enableEditMode();
  } else {
    disableEditMode();
  }
});

function updateOutput(content) {
  elements.outputArea.innerHTML = content;
}

// 更新後にクリックイベントを追加する関数
function addClickHandlersToBlocks() {
  const blocks = document.querySelectorAll(".data-block");
  blocks.forEach(block => {
    // 既存のイベントリスナーを削除（重複防止）
    const newBlock = block.cloneNode(true);
    block.parentNode.replaceChild(newBlock, block);
  });
  
  // 新しいブロックにイベントを追加
  const newBlocks = document.querySelectorAll(".data-block");
  newBlocks.forEach(block => {
    // 通常のクリックイベント
    block.addEventListener("click", function(e) {
      if (isEditMode) return; // エディットモードではクリックを無効化
      
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

function enableEditMode() {
  renderEditableList();
}

function disableEditMode() {
  // 通常のブロック表示に戻す
  const newInput = currentData.join(', ');
  if (newInput) {
    invoke("split_and_format", { text: newInput })
      .then(html => {
        updateOutput(html);
        addClickHandlersToBlocks();
        // ウォッチャーを再開して監視データを更新
        startWatcher();
      })
      .catch(e => {
        console.error("HTML再生成エラー:", e);
      });
  } else {
    updateOutput('');
    // データが空の場合はウォッチャーを停止
    stopWatcher();
  }
}

// エディット可能なリスト表示（縦二列形式）
function renderEditableList() {
  const outputArea = elements.outputArea;
  
  // 既存の内容をクリア
  while (outputArea.firstChild) {
    outputArea.removeChild(outputArea.firstChild);
  }
  
  // コンテナを作成
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.flexWrap = "wrap";
  container.style.gap = "4px";
  container.style.alignContent = "flex-start";
  container.style.width = "100%";
  
  // 左右のカラムを作成
  const leftColumn = document.createElement("div");
  const rightColumn = document.createElement("div");
  leftColumn.style.flex = "1";
  leftColumn.style.display = "flex";
  leftColumn.style.flexDirection = "column";
  leftColumn.style.gap = "4px";
  rightColumn.style.flex = "1";
  rightColumn.style.display = "flex";
  rightColumn.style.flexDirection = "column";
  rightColumn.style.gap = "4px";
  
  container.appendChild(leftColumn);
  container.appendChild(rightColumn);
  outputArea.appendChild(container);
  
  // データを左右のカラムに振り分け（縦二列形式）
  const half = Math.ceil(currentData.length / 2);
  
  // 左カラム（1番から half番まで）
  for (let i = 0; i < half; i++) {
    if (i < currentData.length) {
      const dataBlock = createEditableBlock(currentData[i], i + 1, i);
      leftColumn.appendChild(dataBlock);
    }
  }
  
  // 右カラム（half+1番から最後まで）
  for (let i = half; i < currentData.length; i++) {
    const dataBlock = createEditableBlock(currentData[i], i + 1, i);
    rightColumn.appendChild(dataBlock);
  }
}

function createEditableBlock(value, displayNumber, dataIndex) {
  const block = document.createElement("div");
  block.className = "data-block";
  block.style.display = "flex";
  block.style.alignItems = "center";
  block.style.border = "2px solid black";
  block.style.padding = "2px";
  block.style.backgroundColor = "white";
  
  const numberDiv = document.createElement("div");
  numberDiv.className = "number";
  numberDiv.textContent = displayNumber;
  numberDiv.style.color = "black";
  numberDiv.style.fontWeight = "bold";
  numberDiv.style.width = "30px";
  numberDiv.style.height = "30px";
  numberDiv.style.display = "flex";
  numberDiv.style.alignItems = "center";
  numberDiv.style.justifyContent = "center";
  numberDiv.style.marginRight = "4px";
  numberDiv.style.flexShrink = "0";
  
  const valueDiv = document.createElement("div");
  valueDiv.className = "value";
  valueDiv.textContent = value;
  valueDiv.style.color = "black";
  valueDiv.style.padding = "4px 6px";
  valueDiv.style.display = "flex";
  valueDiv.style.alignItems = "center";
  valueDiv.style.justifyContent = "center";
  valueDiv.style.flex = "1";
  valueDiv.style.minWidth = "0";
  valueDiv.style.whiteSpace = "nowrap";
  valueDiv.style.overflow = "hidden";
  valueDiv.style.textOverflow = "ellipsis";
  valueDiv.style.textAlign = "center";
  valueDiv.style.backgroundColor = "#f0f0f0";
  valueDiv.style.border = "1px dashed #ccc";
  valueDiv.style.cursor = "text";
  
  // 削除ボタンを追加
  const deleteButton = document.createElement("button");
  deleteButton.textContent = "×";
  deleteButton.style.marginLeft = "4px";
  deleteButton.style.padding = "2px 6px";
  deleteButton.style.backgroundColor = "#ff4444";
  deleteButton.style.color = "white";
  deleteButton.style.border = "none";
  deleteButton.style.borderRadius = "3px";
  deleteButton.style.cursor = "pointer";
  deleteButton.style.fontSize = "12px";
  
  deleteButton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dataIndex >= 0 && dataIndex < currentData.length) {
      currentData.splice(dataIndex, 1);
      updateInputField();
      renderEditableList();
    }
  });
  
  block.appendChild(numberDiv);
  block.appendChild(valueDiv);
  block.appendChild(deleteButton);
  
  // ダブルクリックで編集
  valueDiv.addEventListener("click", (e) => {
    e.stopPropagation();
    
    if (valueDiv.querySelector("input")) return;
    
    const currentText = valueDiv.textContent.trim();
    const input = document.createElement("input");
    input.type = "text";
    input.value = currentText;
    input.style.width = "100%";
    input.style.background = "transparent";
    input.style.border = "none";
    input.style.textAlign = "center";
    input.style.fontSize = "inherit";
    input.style.color = "inherit";
    
    valueDiv.innerHTML = "";
    valueDiv.appendChild(input);
    input.focus();
    input.select();
    
    const finishEdit = () => {
      const newValue = input.value.trim();
      valueDiv.textContent = newValue;
      
      // データを更新
      if (dataIndex >= 0 && dataIndex < currentData.length) {
        currentData[dataIndex] = newValue;
        updateInputField();
      }
    };
    
    input.addEventListener("blur", finishEdit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        finishEdit();
      } else if (e.key === "Escape") {
        valueDiv.textContent = currentText;
      }
    });
  });
  
  return block;
}

function updateInputField() {
  elements.dataInput.value = currentData.join(', ');
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

// レコーディング専用のウォッチャー開始関数
async function startWatcherForRecording() {
  try {
    isWatching = true;
    // 空の配列でもウォッチャーを開始
    await invoke("start_log_watch", { targets: [] });
    console.log("レコーディング用ログ監視を開始しました");
  } catch (e) {
    console.error("レコーディング用ログファイルの監視中にエラーが発生しました", e);
  }
}

async function startWatcher() {
  const values = extractTargets();
  
  // レコーディング中は空でもOK、通常時は値が必要
  if (values.length === 0 && !isRecording) {
    console.warn("検索対象が設定されていません。");
    return;
  }

  try {
    isWatching = true;
    await invoke("start_log_watch", { targets: values });
    console.log("ログ監視を開始しました", values.length > 0 ? `(${values.length}個のターゲット)` : "(レコーディングモード)");
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

// 新しいプレイヤーをレコーディングリストに追加（即座にリストに反映しない）
function recordNewPlayer(playerName) {
  console.log("新しいプレイヤーをレコーディング:", playerName);
  
  // 既に記録済みかチェック
  if (recordedNewPlayers.includes(playerName)) {
    console.log("プレイヤーは既に記録済みです:", playerName);
    return;
  }
  
  // 新しいプレイヤーリストに追加
  recordedNewPlayers.push(playerName);
  console.log("記録された新プレイヤー:", recordedNewPlayers);
}

// 空の状態から新プレイヤーを統合する関数
function integrateNewPlayersFromEmpty() {
  if (recordedNewPlayers.length === 0) {
    console.log("新しいプレイヤーはいません");
    return;
  }
  
  console.log("新プレイヤーを統合:", recordedNewPlayers);
  
  // 新しいプレイヤーのみを使用（初期データは空だったため）
  const uniqueData = [...new Set(recordedNewPlayers)];
  
  // データを更新
  currentData = uniqueData;
  
  // UI を更新
  updateInputField();
  
  // HTML を再生成
  const newInput = currentData.join(', ');
  if (newInput) {
    invoke("split_and_format", { text: newInput })
      .then(html => {
        updateOutput(html);
        addClickHandlersToBlocks();
        if (isEditMode) {
          enableEditMode();
        }
        // ウォッチャーを再開して監視データを更新
        startWatcher();
      })
      .catch(e => {
        console.error("HTML再生成エラー:", e);
      });
  }
  
  // 記録済み新プレイヤーリストをクリア
  recordedNewPlayers = [];
}

// レコーディング終了処理
function endRecording() {
  if (!isRecording) return;
  
  // 新プレイヤーがいれば統合
  if (recordedNewPlayers.length > 0) {
    integrateNewPlayersFromEmpty();
  }
  
  isRecording = false;
  elements.recordingButton.classList.remove("recording-active");
  elements.recordingButton.textContent = "レコーディング";
  console.log("レコーディングが自動終了されました");
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
        block.style.backgroundColor = 'red';
      }
    }
  });
});

listen('reset-hit', () => {
  console.log('リセット信号を受信');
  // 背景色を元に戻す
  const blocks = document.querySelectorAll(".data-block");
  blocks.forEach(block => {
    const numberElement = block.querySelector(".number");
    const number = parseInt(numberElement?.textContent.trim(), 10);
    const blockId = `block-${number}`;
    
    // 手動でハイライトされていない場合のみリセット
    if (!manuallyHighlightedBlocks.has(blockId)) {
      block.style.backgroundColor = '';
    }
  });
});

listen('recording-new-player', event => {
  const playerName = event.payload;
  console.log('新しいプレイヤーが記録されました:', playerName);
  
  if (isRecording) {
    recordNewPlayer(playerName);
  }
});

// RoundOver時の自動レコーディング終了を監視
listen('round-over', () => {
  console.log('RoundOver検出 - レコーディングを自動終了');
  if (isRecording) {
    endRecording();
    invoke("toggle_recording", { enabled: false })
      .catch(e => {
        console.error("レコーディング終了通知エラー:", e);
      });
  }
});