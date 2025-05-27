use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Seek, SeekFrom},
    net::UdpSocket,
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
    collections::{VecDeque, HashSet},
};

use once_cell::sync::Lazy;
use rosc::{encoder::encode, OscMessage, OscPacket, OscType};
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;

#[derive(Debug, Clone, Deserialize)]
struct Target {
    number: usize,
    value: String,
}

// Structure for OSC message queue
#[derive(Debug, Clone)]
struct OscQueueItem {
    number: usize,
}

// Holds the message queue and its last send time
static OSC_QUEUE: Lazy<Mutex<VecDeque<OscQueueItem>>> = Lazy::new(|| Mutex::new(VecDeque::new()));
static LAST_SEND_TIME: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));
static WATCH_THREAD: Lazy<Mutex<Option<std::thread::JoinHandle<()>>>> = Lazy::new(|| Mutex::new(None));
static SHOULD_RUN: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(true));
static IS_RECORDING: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
static IN_ROUND: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
static RECORDED_PLAYERS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

// Minimum interval for sending OSC messages (milliseconds)
const MIN_SEND_INTERVAL_MS: u64 = 500; // 0.5 second interval

fn get_log_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join("AppData\\LocalLow\\VRChat\\VRChat"))
}

fn find_latest_log_file(log_dir: &PathBuf) -> Option<PathBuf> {
    fs::read_dir(log_dir)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let fname = path.file_name()?.to_str()?;
            if fname.starts_with("output_log_") && fname.ends_with(".txt") {
                entry
                    .metadata()
                    .ok()?
                    .modified()
                    .ok()
                    .map(|modified| (modified, path))
            } else {
                None
            }
        })
        .max_by_key(|(modified, _)| *modified)
        .map(|(_, path)| path)
}

#[tauri::command]
fn get_latest_log_file() -> Option<String> {
    get_log_dir()
        .and_then(|log_dir| find_latest_log_file(&log_dir))
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn split_and_format(text: String) -> String {
    let items: Vec<_> = text
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    let half = (items.len() + 1) / 2;

    let format_column = |items: &[&str], offset: usize| {
        items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                format!(
                    r#"<div class="data-block">
                        <div class="number">{}</div>
                        <div class="value">{}</div>
                    </div>"#,
                    i + 1 + offset,
                    item
                )
            })
            .collect::<String>()
    };

    format!(
        r#"<div class="column">{}</div><div class="column">{}</div>"#,
        format_column(&items[..half], 0),
        format_column(&items[half..], half)
    )
}

#[tauri::command]
fn open_explorer(path: String) {
    println!("open_explorer: {}", path);

    let parent_dir = PathBuf::from(&path).parent().map(|p| p.to_path_buf());
    if let Some(dir) = parent_dir {
        if let Err(e) = std::process::Command::new("explorer").arg(dir).status() {
            eprintln!("Error opening Explorer: {}", e);
        }
    } else {
        eprintln!("Could not get parent directory from specified path");
    }
}

#[tauri::command]
fn toggle_recording(enabled: bool) {
    IS_RECORDING.store(enabled, Ordering::SeqCst);
    if enabled {
        // Clear recorded player list when recording starts
        RECORDED_PLAYERS.lock().unwrap().clear();
        IN_ROUND.store(false, Ordering::SeqCst);
        println!("Recording started - cleared recorded player list");
    } else {
        IN_ROUND.store(false, Ordering::SeqCst);
        println!("Recording stopped");
    }
}

fn send_osc_message(addr: &str, args: Vec<OscType>) {
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to bind socket: {}", e);
            return;
        }
    };

    let packet = OscPacket::Message(OscMessage {
        addr: addr.to_string(),
        args,
    });

    if let Ok(buf) = encode(&packet) {
        if let Err(e) = socket.send_to(&buf, "127.0.0.1:9000") {
            eprintln!("Failed to send OSC message: {}", e);
        }
    } else {
        eprintln!("Failed to encode OSC message");
    }
}

// Function to clear the queue
fn clear_osc_queue() {
    let mut queue = OSC_QUEUE.lock().unwrap();
    queue.clear();
    // println!("OSC queue cleared");
}

// Function to add to the queue
fn queue_osc_message(number: usize, window: &tauri::Window) {
    let mut queue = OSC_QUEUE.lock().unwrap();
    queue.push_back(OscQueueItem {
        number,
    });
    
    // Notify the frontend of the number (notify at detection time)
    if let Err(e) = window.emit("log-hit", number) {
        eprintln!("emit error: {}", e);
    }
}

// Thread function to process sending from the queue
fn process_osc_queue(_window: tauri::Window) {
    while SHOULD_RUN.load(Ordering::SeqCst) {
        let should_send = {
            let mut last_send = LAST_SEND_TIME.lock().unwrap();
            let now = Instant::now();
            
            if let Some(last) = *last_send {
                if now.duration_since(last).as_millis() >= MIN_SEND_INTERVAL_MS as u128 {
                    *last_send = Some(now);
                    true
                } else {
                    false
                }
            } else {
                *last_send = Some(now);
                true
            }
        };

        if should_send {
            // Take one from the queue and process
            if let Some(item) = OSC_QUEUE.lock().unwrap().pop_front() {
                // Send OSC
                send_osc_message(
                    "/avatar/parameters/Lunatic_Number",
                    vec![OscType::Int(item.number as i32)],
                );
            }
        }

        // Wait a bit to reduce CPU usage
        thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
fn send_reset(window: tauri::Window) {
    // Clear the queue before reset
    clear_osc_queue();
    
    // Send reset OSC
    send_osc_message(
        "/avatar/parameters/Lunatic_Reset",
        vec![OscType::Bool(true)],
    );

    // Send event to frontend to restore color
    if let Err(e) = window.emit("reset-hit", ()) {
        eprintln!("emit error: {}", e);
    }
}

// Function to add a new player to the recorded list and notify the frontend
fn record_new_player(player_name: &str, targets: &Arc<Vec<Target>>, window: &tauri::Window) {
    let mut recorded = RECORDED_PLAYERS.lock().unwrap();
    
    // Check if already recorded
    if recorded.contains(player_name) {
        return;
    }
    
    // Check if included in existing targets
    if targets.iter().any(|t| t.value == player_name) {
        return;
    }
    
    // Record as a new player
    recorded.insert(player_name.to_string());
    println!("Recorded new player: {}", player_name);
    
    // Notify frontend
    if let Err(e) = window.emit("recording-new-player", player_name) {
        eprintln!("New player notification error: {}", e);
    }
}

#[tauri::command]
fn start_log_watch(targets: Vec<Target>, window: tauri::Window) {
    SHOULD_RUN.store(false, Ordering::SeqCst);
    if let Some(handle) = WATCH_THREAD.lock().unwrap().take() {
        let _ = handle.join();
    }
    SHOULD_RUN.store(true, Ordering::SeqCst);

    // Initialize OSC queue
    clear_osc_queue();
    
    {
        let mut last_send = LAST_SEND_TIME.lock().unwrap();
        *last_send = None;
    }

    // Start OSC queue processing thread
    let queue_window = window.clone();
    thread::spawn(move || {
        process_osc_queue(queue_window);
    });

    if let Some(log_dir) = get_log_dir() {
        if let Some(path) = find_latest_log_file(&log_dir) {
            let targets = Arc::new(targets);
            let handle = thread::spawn({
                let targets = Arc::clone(&targets);
                let window = window.clone();
                move || {
                    let file = match File::open(&path) {
                        Ok(f) => f,
                        Err(_) => return,
                    };
                    let mut reader = BufReader::new(file);
                    let mut position = reader.seek(SeekFrom::End(0)).unwrap_or(0);

                    while SHOULD_RUN.load(Ordering::SeqCst) {
                        thread::sleep(Duration::from_millis(500));
                        reader.seek(SeekFrom::Start(position)).ok();
                        let mut buffer = String::new();

                        while reader.read_line(&mut buffer).unwrap_or(0) > 0 {
                            // Recording feature: Detect "and the round type is" and set round start flag
                            if IS_RECORDING.load(Ordering::SeqCst) && buffer.contains("and the round type is") {
                                if !IN_ROUND.load(Ordering::SeqCst) {
                                    IN_ROUND.store(true, Ordering::SeqCst);
                                    println!("Detected round start");
                                    // Clear recorded player list at round start
                                    RECORDED_PLAYERS.lock().unwrap().clear();
                                    println!("Round start - cleared recorded player list");
                                }
                            }

                            // Detect "RoundOver"
                            if buffer.contains("RoundOver") {
                                // If "RoundOver" is found, clear the queue
                                clear_osc_queue();
                                
                                // If recording and in round
                                if IS_RECORDING.load(Ordering::SeqCst) && IN_ROUND.load(Ordering::SeqCst) {
                                    IN_ROUND.store(false, Ordering::SeqCst);
                                    println!("Detected round end");
                                    
                                    // End recording
                                    IS_RECORDING.store(false, Ordering::SeqCst);
                                    println!("RoundOver detected - stopped recording automatically");
                                    
                                    // Send round-over event to frontend
                                    if let Err(e) = window.emit("round-over", ()) {
                                        eprintln!("round-over emit error: {}", e);
                                    }
                                }
                                
                                // Send OSC reset signal
                                send_osc_message(
                                    "/avatar/parameters/Lunatic_Reset",
                                    vec![OscType::Bool(true)],
                                );
                                
                                // Send reset event to frontend
                                if let Err(e) = window.emit("reset-hit", ()) {
                                    eprintln!("emit error: {}", e);
                                }
                            }

                            // Detect "[DEATH]["
                            if let Some(start) = buffer.find("[DEATH][") {
                                if let Some(end) = buffer[start + 8..].find(']') {
                                    let name = &buffer[start + 8..start + 8 + end];
                                    
                                    // Recording feature: If a new name is found during the round
                                    if IS_RECORDING.load(Ordering::SeqCst) && IN_ROUND.load(Ordering::SeqCst) {
                                        record_new_player(name, &targets, &window);
                                    }
                                    
                                    // Normal processing: If matches an existing target
                                    if let Some(target) = targets.iter().find(|t| t.value == name) {
                                        // Add to queue (not immediate send)
                                        queue_osc_message(target.number, &window);
                                    }
                                }
                            }
                            buffer.clear();
                        }

                        position = reader.seek(SeekFrom::Current(0)).unwrap_or(position);
                    }
                }
            });

            *WATCH_THREAD.lock().unwrap() = Some(handle);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_latest_log_file,
            split_and_format,
            open_explorer,
            start_log_watch,
            send_reset,
            toggle_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}