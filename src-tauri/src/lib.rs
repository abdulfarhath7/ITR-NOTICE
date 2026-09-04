//! The desktop shell. It owns three things and no more: the sidecar's
//! lifetime, the OS keychain, and the window.

mod secrets;
mod sidecar;

use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

use secrets::{SecretStatus, Slot};
use sidecar::{BackendInfo, SidecarState};

/// Pushed to the UI when the sidecar never came up, so the window can say what
/// happened instead of sitting on a blank screen.
#[derive(Clone, Serialize)]
struct StartupFailure {
    message: String,
}

#[tauri::command]
fn backend_info(state: tauri::State<'_, SidecarState>) -> Result<BackendInfo, String> {
    if let Some(info) = state.info() {
        return Ok(info);
    }
    // The failure event can fire before the webview has a listener, so the
    // reason is kept and handed back here too - the UI asks for this on its
    // very first call and cannot miss it.
    Err(state
        .failure()
        .unwrap_or_else(|| "the backend is not running yet".to_string()))
}

#[tauri::command]
fn secret_status() -> SecretStatus {
    secrets::status()
}

#[tauri::command]
fn secret_set(slot: Slot, value: String) -> Result<(), String> {
    secrets::set(slot, &value)
}

#[tauri::command]
fn secret_get(slot: Slot) -> Result<Option<String>, String> {
    secrets::get(slot)
}

#[tauri::command]
fn secret_delete(slot: Slot) -> Result<(), String> {
    secrets::delete(slot)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        // Registered first, so a second launch focuses this window instead of
        // starting a second sidecar against the same database.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
        builder = builder.plugin(
            // `targets` replaces the plugin's defaults, which already include a
            // stdout writer - appending with `target` instead left every line
            // printed twice in the terminal.
            tauri_plugin_log::Builder::new()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stderr),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        );
    }

    builder = builder
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage(SidecarState::default())
        .invoke_handler(tauri::generate_handler![
            backend_info,
            secret_status,
            secret_set,
            secret_get,
            secret_delete,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // The window is created hidden (tauri.conf.json). It is shown only
            // once /health answers, so the first thing the user sees is a
            // working app rather than a white rectangle.
            tauri::async_runtime::spawn(async move {
                let environment = secrets::environment();
                match sidecar::start(&handle, environment).await {
                    Ok(_) => {
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    Err(error) => {
                        log::error!("sidecar failed to start: {error}");
                        handle
                            .state::<SidecarState>()
                            .set_failure(error.to_string());
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = handle.emit(
                            "sidecar://failed",
                            StartupFailure {
                                message: error.to_string(),
                            },
                        );
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Destroyed = event {
                window.app_handle().state::<SidecarState>().shutdown();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|handle, event| {
            // Belt and braces: whichever way the app ends, the Python process
            // ends with it. An orphaned sidecar holds the port and the browser.
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                handle.state::<SidecarState>().shutdown();
            }
        });
}
