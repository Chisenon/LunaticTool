<div align="center">
  <img src="src-tauri\icons\icon.png" alt="App Icon" width="124" style="display:inline; vertical-align:middle;">

  # LunaticTool  
  A real-time log monitoring tool that automatically detects and notifies events related to specified player names.

  # [Download](https://github.com/Chisenon/LunaticTool/releases/latest/download/LunaticTool.zip "Download the latest version")

  [View All Releases](https://github.com/Chisenon/LunaticTool/releases)
</div>

<p align="center">
<img src="resources\preview.png" alt="Preview" title="LunaticTool Preview" width="300">
</p>

---

# 🛠️ Main Features
- **VRChat Log Monitoring**  
  Monitors specified player names (comma-separated) in real time and instantly notifies when relevant events occur.
- **OSC Transmission**  
  Sends OSC messages upon detection. Supports avatar parameter control in VRChat.
- **Recording Mode**  
  Automatically logs new player names from the start to the end of a round, allowing you to merge them into the watch list afterward.
- **Edit Mode**  
  Easily modify, delete, or reorder entries in the watch list using a GUI.
- **Explorer Integration**  
  Open the VRChat log directory with a single click.
- **UI Highlighting**  
  Automatically highlights relevant blocks in red when events are detected. Manual highlighting and unhighlighting are also supported.

---

# 🚀 How to Use
1. **Launch the app, enter the player names you want to monitor (comma-separated), and click the "Set" button**  
   Example: `Alice, Bob, Charlie`
2. **Log monitoring will start automatically. When an event is detected, the relevant UI blocks will be highlighted in red.**
3. **At the end of a round, highlights are reset and the tool waits for the next round to begin.**

---

# ⚙️ Button Descriptions
- `Set`  
  Updates the watch list with the input and starts log monitoring.
- `OSC Reset`  
  Sends a reset signal via OSC and clears any UI highlights.
- `Recording`  
  Automatically logs new player names from the beginning to the end of a round. These can be merged into the watch list afterward.
- `Edit`  
  Opens the GUI for editing or deleting the watch list.
- `Open`  
  Opens the VRChat log file directory in Explorer.

---

# 💡 Notes & Tips
- **Edit Mode**  
  Click the “×” button on a block to delete it, or click the name to edit it.
- **Manual Highlighting**  
  Click a block to manually toggle red highlighting.
- **Automatic Round Detection**  
  Automatically detects log entries such as "and the round type is" or "RoundOver" to determine when to start/stop recording.

---

# 🌐 Supported Environment
- Windows 10/11
- VRChat (Log files must be located at `AppData\LocalLow\VRChat\VRChat`)

---

# 📫 Support & Contact
- **GitHub Issues:** [LunaticTool Issues](https://github.com/Chisenon/LunaticTool/issues)  
- **Discord:** `chisenon`

---

# ⚠️ Disclaimer
> This is an unofficial fan-made tool for VRChat and *Terrors of Nowhere*.  
>  
> Please use it responsibly for personal purposes only.

---

## 💻 Recommended IDE Setup
- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
