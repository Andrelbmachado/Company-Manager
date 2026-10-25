use tauri_plugin_sql::{Migration, MigrationKind};

mod window_size;
mod auth;
mod backup;
mod legacy_db;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Olá, {}! Company Manager iniciado.", name)
}

/// Reinicia o app. Usado depois de restaurar um backup: o banco precisa ser reaberto do zero
/// (no front-end: `invoke("restart_app")`, de `@tauri-apps/api/core`).
#[tauri::command]
fn restart_app(app: tauri::AppHandle) {
    app.restart();
}

pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_initial_tables",
            sql: include_str!("../migrations/0001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "assistant_support_inventory",
            sql: include_str!("../migrations/0002_assistant_support_inventory.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "site_prospecting",
            sql: include_str!("../migrations/0003_site_prospecting.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "packages_referral",
            sql: include_str!("../migrations/0004_packages_referral.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "project_stages",
            sql: include_str!("../migrations/0005_project_stages.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "hr",
            sql: include_str!("../migrations/0006_hr.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "payroll",
            sql: include_str!("../migrations/0007_payroll.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "crm_erp_core",
            sql: include_str!("../migrations/0008_crm_erp_core.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "documents_files",
            sql: include_str!("../migrations/0009_documents_files.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "auth_hash",
            sql: include_str!("../migrations/0010_auth_hash.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "crm_hr_extras",
            sql: include_str!("../migrations/0011_crm_hr_extras.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "redesign_modular",
            sql: include_str!("../migrations/0012_redesign_modular.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:company-manager.db", migrations)
                .build(),
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        // Agendas por link iCal (src/lib/calendar/fetcher.ts): o pedido sai do Rust, sem o CORS do webview.
        .plugin(tauri_plugin_http::init())
        .setup(|app| {
            // Mínimo da janela = 1/5 da largura e 1/3 da altura do monitor atual (window_size.rs).
            window_size::apply_to_main_window(app);
            // Antes do front-end abrir o banco: bancos do protótipo têm outro checksum na migration 1 (ver legacy_db.rs).
            use tauri::Manager;
            if let Ok(dir) = app.path().app_config_dir() {
                let db_path = dir.join("company-manager.db");
                match tauri::async_runtime::block_on(legacy_db::repair(&db_path)) {
                    Ok(true) => eprintln!("[db] checksum da migration 1 atualizado (banco do protótipo)"),
                    Ok(false) => {}
                    Err(error) => eprintln!("[db] não foi possível conferir o banco do protótipo: {error}"),
                }
            }
            Ok(())
        })
        .on_window_event(window_size::on_window_event)
        .invoke_handler(tauri::generate_handler![
            greet,
            restart_app,
            auth::hash_password,
            auth::verify_password,
            backup::backup_db,
            backup::restore_db,
            backup::list_backups
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
