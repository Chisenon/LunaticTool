<div align="center">
  <img src="src-tauri\icons\icon.png" alt="App Icon" width="124" style="display:inline; vertical-align:middle;">

  # LunaticTool
  A tool that monitors log files in real-time and automatically detects and notifies events related to specified player names.

  # [Download](https://github.com/Chisenon/LunaticTool/releases/latest/download/LunaticTool.zip "Download the latest version")

  [View Releases](https://github.com/Chisenon/LunaticTool/releases)
</div>

<p align="center">
<img src="resources\preview.png" alt="Preview" title="LunaticTool Preview" width="300">
</p>

# 🛠️ Main Features
- **VRChat Log Monitoring**  
  Monitors specified player names (comma-separated) in real-time and immediately notifies when events occur.
- **OSC Transmission**  
  Automatically sends OSC messages upon detection. Supports parameter control of VRChat avatars.
- **Recording Mode**  
  Automatically records new player names from the start to the end of a round. Can merge them into the list at the end.
- **Edit Mode**  
  Easily edit, delete, or reorder the watch list via GUI.
- **Explorer Integration**  
  Open the VRChat log directory with one click.
- **UI Highlighting**  
  Automatically highlights relevant blocks in red when events are detected. Manual highlight/unhighlight is also supported.

# 🚀 How to Use
1. **After launching, enter the player names you want to monitor (comma-separated) and click the "Set" button**  
   Example: `Alice, Bob, Charlie`
2. **Log monitoring starts automatically, and the UI is highlighted in red when a relevant event occurs**
3. **Highlights are reset at the end of the round, and the tool waits for the next round to start**

# ⚙️ Description of Each Button
- `Set`  
  Updates the watch list with the input and starts log monitoring.
- `OSC Reset`  
  Sends a reset signal via OSC and resets UI highlights.
- `Recording`  
  Automatically records new player names from the start to the end of a round. Merges them into the list at the end.
- `Edit`  
  Allows editing or deleting the watch list via GUI.
- `Open`  
  Opens the VRChat log file directory in Explorer.

# 💡 Notes & Tips
- **Edit Mode**  
  Click the “×” button on a block to delete it, or click the name to edit.
- **Manual Highlighting**  
  Click a block to manually toggle red highlighting.
- **Automatic Round Detection**  
  Automatically detects "and the round type is", "RoundOver", etc. in logs to start/stop recording automatically.

# 🌐 Supported Environment
- Windows 10/11
- VRChat (Log files must be output to `AppData\LocalLow\VRChat\VRChat`)

# 📫 Support & Contact
- **GitHub Issues:** [LunaticTool Issues](https://github.com/Chisenon/LunaticTool/issues)
- **Discord:** `chisenon`

# ⚠️ warning
> This tool is a fan tool for VRChat and Terrors of Nowhere.
> 
> Please use it within personal limits.

---

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
