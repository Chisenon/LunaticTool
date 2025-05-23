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

// OSCメッセージキュー用の構造体
#[derive(Debug, Clone)]
struct OscQueueItem {
    number: usize,
}

// メッセージキューとその最終送信時間を保持
static OSC_QUEUE: Lazy<Mutex<VecDeque<OscQueueItem>>> = Lazy::new(|| Mutex::new(VecDeque::new()));
static LAST_SEND_TIME: Lazy<Mutex<Option<Instant>>> = Lazy::new(|| Mutex::new(None));
static WATCH_THREAD: Lazy<Mutex<Option<std::thread::JoinHandle<()>>>> = Lazy::new(|| Mutex::new(None));
static SHOULD_RUN: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(true));
static IS_RECORDING: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
static IN_ROUND: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
static RECORDED_PLAYERS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));

// OSCメッセージ送信の最小間隔（ミリ秒）
const MIN_SEND_INTERVAL_MS: u64 = 500; // 0.5秒間隔

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
            eprintln!("エクスプローラーを開く際にエラー: {}", e);
        }
    } else {
        eprintln!("指定されたパスから親ディレクトリを取得できませんでした");
    }
}

#[tauri::command]
fn toggle_recording(enabled: bool) {
    IS_RECORDING.store(enabled, Ordering::SeqCst);
    if enabled {
        // レコーディング開始時に記録済みプレイヤーリストをクリア
        RECORDED_PLAYERS.lock().unwrap().clear();
        IN_ROUND.store(false, Ordering::SeqCst);
        println!("レコーディング開始 - 記録済みプレイヤーリストをクリア");
    } else {
        IN_ROUND.store(false, Ordering::SeqCst);
        println!("レコーディング終了");
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

// キューをクリアする関数
fn clear_osc_queue() {
    let mut queue = OSC_QUEUE.lock().unwrap();
    queue.clear();
    // println!("OSCキューをクリアしました");
}

// キューに追加する関数
fn queue_osc_message(number: usize, window: &tauri::Window) {
    let mut queue = OSC_QUEUE.lock().unwrap();
    queue.push_back(OscQueueItem {
        number,
    });
    
    // フロントエンドに number を通知（検出時点で通知）
    if let Err(e) = window.emit("log-hit", number) {
        eprintln!("emit error: {}", e);
    }
}

// キューから送信処理を行うスレッド関数
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
            // キューから一つ取り出して処理
            if let Some(item) = OSC_QUEUE.lock().unwrap().pop_front() {
                // OSC送信
                send_osc_message(
                    "/avatar/parameters/Lunatic_Number",
                    vec![OscType::Int(item.number as i32)],
                );
            }
        }

        // 少し待機してCPU使用率を抑える
        thread::sleep(Duration::from_millis(100));
    }
}

#[tauri::command]
fn send_reset(window: tauri::Window) {
    // リセット前にキューをクリア
    clear_osc_queue();
    
    // リセットOSCを送信
    send_osc_message(
        "/avatar/parameters/Lunatic_Reset",
        vec![OscType::Bool(true)],
    );

    // フロントエンドに色を元に戻すイベントを送信
    if let Err(e) = window.emit("reset-hit", ()) {
        eprintln!("emit error: {}", e);
    }
}

// 新しいプレイヤーを記録済みリストに追加し、フロントエンドに通知する関数
fn record_new_player(player_name: &str, targets: &Arc<Vec<Target>>, window: &tauri::Window) {
    let mut recorded = RECORDED_PLAYERS.lock().unwrap();
    
    // 既に記録済みかチェック
    if recorded.contains(player_name) {
        return;
    }
    
    // 既存のターゲットに含まれているかチェック
    if targets.iter().any(|t| t.value == player_name) {
        return;
    }
    
    // 新しいプレイヤーとして記録
    recorded.insert(player_name.to_string());
    println!("新しいプレイヤーを記録: {}", player_name);
    
    // フロントエンドに通知
    if let Err(e) = window.emit("recording-new-player", player_name) {
        eprintln!("新プレイヤー通知エラー: {}", e);
    }
}

#[tauri::command]
fn start_log_watch(targets: Vec<Target>, window: tauri::Window) {
    SHOULD_RUN.store(false, Ordering::SeqCst);
    if let Some(handle) = WATCH_THREAD.lock().unwrap().take() {
        let _ = handle.join();
    }
    SHOULD_RUN.store(true, Ordering::SeqCst);

    // OSCキューを初期化
    clear_osc_queue();
    
    {
        let mut last_send = LAST_SEND_TIME.lock().unwrap();
        *last_send = None;
    }

    // OSCキュー処理スレッドを起動
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
                            // レコーディング機能: "and the round type is" を検出してラウンド開始フラグを立てる
                            if IS_RECORDING.load(Ordering::SeqCst) && buffer.contains("and the round type is") {
                                if !IN_ROUND.load(Ordering::SeqCst) {
                                    IN_ROUND.store(true, Ordering::SeqCst);
                                    println!("ラウンド開始を検出しました");
                                    // ラウンド開始時に記録済みプレイヤーリストをクリア
                                    RECORDED_PLAYERS.lock().unwrap().clear();
                                    println!("ラウンド開始 - 記録済みプレイヤーリストをクリア");
                                }
                            }

                            // "RoundOver" 検出
                            if buffer.contains("RoundOver") {
                                // "RoundOver" が見つかった場合、キューをクリア
                                clear_osc_queue();
                                
                                // レコーディング中かつラウンド中の場合
                                if IS_RECORDING.load(Ordering::SeqCst) && IN_ROUND.load(Ordering::SeqCst) {
                                    IN_ROUND.store(false, Ordering::SeqCst);
                                    println!("ラウンド終了を検出しました");
                                    
                                    // レコーディング終了処理
                                    IS_RECORDING.store(false, Ordering::SeqCst);
                                    println!("RoundOver検出 - レコーディングを自動終了");
                                    
                                    // フロントエンドにround-overイベントを送信
                                    if let Err(e) = window.emit("round-over", ()) {
                                        eprintln!("round-over emit error: {}", e);
                                    }
                                }
                                
                                // OSCリセット信号を送信
                                send_osc_message(
                                    "/avatar/parameters/Lunatic_Reset",
                                    vec![OscType::Bool(true)],
                                );
                                
                                // フロントエンドにリセットイベントを送信
                                if let Err(e) = window.emit("reset-hit", ()) {
                                    eprintln!("emit error: {}", e);
                                }
                            }

                            // "[DEATH][" パターンを検出
                            if let Some(start) = buffer.find("[DEATH][") {
                                if let Some(end) = buffer[start + 8..].find(']') {
                                    let name = &buffer[start + 8..start + 8 + end];
                                    
                                    // レコーディング機能: ラウンド中に新しい名前を発見した場合
                                    if IS_RECORDING.load(Ordering::SeqCst) && IN_ROUND.load(Ordering::SeqCst) {
                                        record_new_player(name, &targets, &window);
                                    }
                                    
                                    // 通常の処理: 既存のターゲットとマッチした場合
                                    if let Some(target) = targets.iter().find(|t| t.value == name) {
                                        // キューに追加（即時送信ではなく）
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