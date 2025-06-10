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
const manuallyHighlightedBlocks = new Set();
let currentData = [];
let recordedNewPlayers = [];

window.addEventListener("DOMContentLoaded", async () => {
  await displayLogDir();
  autoStartWatcher();
});

async function displayLogDir() {
  try {
    const logFilePath = await invoke("get_latest_log_file");
    elements.logDir.textContent = logFilePath || "Log file not found.";
  } catch (e) {
    elements.logDir.textContent = `Error: ${e}`;
  }
}

elements.openExplorerButton.addEventListener("click", async () => {
  const filePath = elements.logDir.textContent;
  if (!filePath || filePath === "Log file not found.") return;

  try {
    await invoke("open_explorer", { path: filePath });
  } catch (e) {
    console.error("Error occurred while opening Explorer", e);
  }
});

elements.dataInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    e.preventDefault();

    const rawInput = elements.dataInput.value.trim();

    if (!rawInput) {
      clearDataAndDisplay();
      return;
    }

    try {
      const html = await invoke("split_and_format", { text: rawInput });
      updateOutput(html);
      currentData = rawInput.split(',').map(str => str.trim()).filter(str => str.length > 0);
      addClickHandlersToBlocks();
      if (isEditMode) {
        enableEditMode();
      }
      startWatcher();
    } catch (e) {
      updateOutput(`<p>Error: ${e}</p>`);
    }
  }
});

elements.sendButton.addEventListener("click", async () => {
  const rawInput = elements.dataInput.value.trim();

  if (!rawInput) {
    clearDataAndDisplay();
    return;
  }

  try {
    const html = await invoke("split_and_format", { text: rawInput });
    updateOutput(html);
    currentData = rawInput.split(',').map(str => str.trim()).filter(str => str.length > 0);
    addClickHandlersToBlocks();
    if (isEditMode) {
      enableEditMode();
    }
    startWatcher();
  } catch (e) {
    updateOutput(`<p>Error: ${e}</p>`);
  }
});

function clearDataAndDisplay() {
  currentData = [];
  updateOutput('');
  manuallyHighlightedBlocks.clear();
  console.log("Data and display cleared");
  stopWatcher();
}

async function stopWatcher() {
  try {
    await invoke("start_log_watch", { targets: [] });
    isWatching = false;
    console.log("Watcher stopped");
  } catch (e) {
    console.error("Error occurred while stopping watcher", e);
  }
}

elements.resetButton.addEventListener("click", async () => {
  try {
    await invoke("send_reset");
  } catch (e) {
    console.error("Failed to send reset signal", e);
  }
});

elements.recordingButton.addEventListener("click", async () => {
  isRecording = !isRecording;
  elements.recordingButton.classList.toggle("recording-active", isRecording);
  elements.recordingButton.textContent = isRecording ? "Recording..." : "Record";

  if (isRecording) {
    recordedNewPlayers = [];
    currentData = [];
    updateInputField();
    updateOutput('');
    console.log("Recording started - data cleared");

    await startWatcherForRecording();
  } else {
    if (recordedNewPlayers.length > 0) {
      integrateNewPlayersFromEmpty();
    }
  }

  try {
    await invoke("toggle_recording", { enabled: isRecording });
    console.log(`Changed recording state: ${isRecording}`);
  } catch (e) {
    console.error("Failed to toggle recording state", e);
  }
});

elements.editButton.addEventListener("click", () => {
  isEditMode = !isEditMode;
  elements.editButton.classList.toggle("edit-active", isEditMode);
  elements.editButton.textContent = isEditMode ? "Editing..." : "Edit";

  if (isEditMode) {
    enableEditMode();
  } else {
    disableEditMode();
  }
});

function updateOutput(content) {
  elements.outputArea.innerHTML = content;
}

function addClickHandlersToBlocks() {
  const blocks = document.querySelectorAll(".data-block");
  blocks.forEach(block => {
    const newBlock = block.cloneNode(true);
    block.parentNode.replaceChild(newBlock, block);
  });

  const newBlocks = document.querySelectorAll(".data-block");
  newBlocks.forEach(block => {
    block.addEventListener("click", function(e) {
      if (isEditMode) return;

      const numberElement = this.querySelector(".number");
      const number = parseInt(numberElement?.textContent.trim(), 10);

      const blockId = `block-${number}`;

      if (manuallyHighlightedBlocks.has(blockId)) {
        this.style.backgroundColor = '';
        manuallyHighlightedBlocks.delete(blockId);
      } else {
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
  const newInput = currentData.join(', ');
  if (newInput) {
    invoke("split_and_format", { text: newInput })
      .then(html => {
        updateOutput(html);
        addClickHandlersToBlocks();
        startWatcher();
      })
      .catch(e => {
        console.error("Error regenerating HTML:", e);
      });
  } else {
    updateOutput('');
    stopWatcher();
  }
}

function renderEditableList() {
  const outputArea = elements.outputArea;

  while (outputArea.firstChild) {
    outputArea.removeChild(outputArea.firstChild);
  }
  for (let i = 0; i < currentData.length; i++) {
    const dataBlock = createEditableBlock(currentData[i], i + 1, i);
    outputArea.appendChild(dataBlock);
  }

  setupDragAndDrop();
}

function createEditableBlock(value, displayNumber, dataIndex) {
  const block = document.createElement("li");  block.className = "data-block";
  block.draggable = true;
  block.dataset.index = dataIndex;
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
    const currentIndex = parseInt(block.dataset.index);
    if (currentIndex >= 0 && currentIndex < currentData.length) {
      currentData.splice(currentIndex, 1);
      updateInputField();
      renderEditableList();
    }
  });

  block.appendChild(numberDiv);
  block.appendChild(valueDiv);
  block.appendChild(deleteButton);

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
    input.select();    const finishEdit = () => {
      const newValue = input.value.trim();
      valueDiv.textContent = newValue;

      const currentIndex = parseInt(block.dataset.index);
      if (currentIndex >= 0 && currentIndex < currentData.length) {
        currentData[currentIndex] = newValue;
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

async function startWatcherForRecording() {
  try {
    isWatching = true;
    await invoke("start_log_watch", { targets: [] });
    console.log("Started log watching for recording");
  } catch (e) {
    console.error("Error occurred while watching log file for recording", e);
  }
}

async function startWatcher() {
  const values = extractTargets();

  if (values.length === 0 && !isRecording) {
    console.warn("No search targets set.");
    return;
  }

  try {
    isWatching = true;
    await invoke("start_log_watch", { targets: values });
    console.log("Started log watching", values.length > 0 ? `(${values.length} targets)` : "(recording mode)");
  } catch (e) {
    console.error("Error occurred while watching log file", e);
  }
}

function autoStartWatcher() {
  if (document.querySelectorAll(".data-block").length > 0) {
    addClickHandlersToBlocks();
    startWatcher();
  }
}

function recordNewPlayer(playerName) {
  console.log("Recording new player:", playerName);

  if (recordedNewPlayers.includes(playerName)) {
    console.log("Player already recorded:", playerName);
    return;
  }

  recordedNewPlayers.push(playerName);
  console.log("Recorded new players:", recordedNewPlayers);
}

function integrateNewPlayersFromEmpty() {
  if (recordedNewPlayers.length === 0) {
    console.log("No new players");
    return;
  }

  console.log("Integrating new players:", recordedNewPlayers);

  const uniqueData = [...new Set(recordedNewPlayers)];

  currentData = uniqueData;

  updateInputField();

  const newInput = currentData.join(', ');
  if (newInput) {
    invoke("split_and_format", { text: newInput })
      .then(html => {
        updateOutput(html);
        addClickHandlersToBlocks();
        if (isEditMode) {
          enableEditMode();
        }
        startWatcher();
      })
      .catch(e => {
        console.error("Error regenerating HTML:", e);
      });
  }

  recordedNewPlayers = [];
}

function endRecording() {
  if (!isRecording) return;

  if (recordedNewPlayers.length > 0) {
    integrateNewPlayersFromEmpty();
  }

  isRecording = false;
  elements.recordingButton.classList.remove("recording-active");
  elements.recordingButton.textContent = "Record";
  console.log("Recording automatically ended");
}

listen('log-hit', event => {
  console.log('Hit number:', event.payload);
  const hitNumber = parseInt(event.payload, 10);

  const blocks = document.querySelectorAll(".data-block");
  blocks.forEach(block => {
    const numberElement = block.querySelector(".number");
    const number = parseInt(numberElement?.textContent.trim(), 10);
    const blockId = `block-${number}`;

    if (number === hitNumber) {
      if (!manuallyHighlightedBlocks.has(blockId)) {
        block.style.backgroundColor = 'red';
      }
    }
  });
});

listen('reset-hit', () => {
  console.log('Received reset signal');
  const blocks = document.querySelectorAll(".data-block");
  blocks.forEach(block => {
    const numberElement = block.querySelector(".number");
    const number = parseInt(numberElement?.textContent.trim(), 10);
    const blockId = `block-${number}`;

    if (!manuallyHighlightedBlocks.has(blockId)) {
      block.style.backgroundColor = '';
    }
  });
});

listen('recording-new-player', event => {
  const playerName = event.payload;
  console.log('New player recorded:', playerName);

  if (isRecording) {
    recordNewPlayer(playerName);
  }
});

listen('round-over', () => {
  console.log('RoundOver detected - automatically ending recording');
  if (isRecording) {
    endRecording();
    invoke("toggle_recording", { enabled: false })
      .catch(e => {
        console.error("Error notifying recording end:", e);
      });
  }
});

function setupDragAndDrop() {
  const outputArea = document.querySelector("#output-area");
  let draggedElement = null;

  outputArea.addEventListener("dragstart", (event) => {
    if (event.target.classList.contains("data-block")) {
      draggedElement = event.target;
      event.target.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    }
  });
  outputArea.addEventListener("dragend", (event) => {
    if (event.target.classList.contains("data-block")) {
      event.target.classList.remove("dragging");
      draggedElement = null;
      document.querySelectorAll(".drop-indicator").forEach(indicator => {
        indicator.remove();
      });
    }
  });

  outputArea.addEventListener("dragover", (event) => {
    event.preventDefault();
      if (!draggedElement) return;

    document.querySelectorAll(".drop-indicator").forEach(indicator => {
      indicator.remove();
    });    const afterElement = getDragAfterElement(outputArea, event.clientY);
    
    const dropIndicator = document.createElement("div");
    dropIndicator.className = "drop-indicator";
    dropIndicator.style.height = "4px";
    dropIndicator.style.backgroundColor = "#007acc";
    dropIndicator.style.margin = "8px 0";
    dropIndicator.style.borderRadius = "2px";

    if (afterElement == null) {
      outputArea.appendChild(dropIndicator);
    } else {
      outputArea.insertBefore(dropIndicator, afterElement);
    }
  });

  outputArea.addEventListener("drop", (event) => {
    event.preventDefault();
      if (!draggedElement) return;

    document.querySelectorAll(".drop-indicator").forEach(indicator => {
      indicator.remove();
    });

    const afterElement = getDragAfterElement(outputArea, event.clientY);
    
    const draggedIndex = parseInt(draggedElement.dataset.index);
    
    const draggedData = currentData[draggedIndex];
    currentData.splice(draggedIndex, 1);
    
    let newIndex;
    if (afterElement == null) {
      newIndex = currentData.length;
    } else {
      const afterIndex = parseInt(afterElement.dataset.index);
      if (afterIndex > draggedIndex) {
        newIndex = afterIndex - 1;
      } else {
        newIndex = afterIndex;
      }
    }
    
    currentData.splice(newIndex, 0, draggedData);
    
    if (afterElement == null) {
      outputArea.appendChild(draggedElement);
    } else {
      outputArea.insertBefore(draggedElement, afterElement);
    }
    
    updateInputField();
    updateDataIndices();
    updateBlockNumbers();
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.data-block:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updateBlockNumbers() {
  const dataBlocks = document.querySelectorAll("#output-area .data-block");
  dataBlocks.forEach((block, index) => {
    const numberDiv = block.querySelector(".number");
    if (numberDiv) {
      numberDiv.textContent = index + 1;
    }
  });
}

function updateDataIndices() {
  const dataBlocks = document.querySelectorAll("#output-area .data-block");
  dataBlocks.forEach((block, index) => {
    block.dataset.index = index;
  });
}
