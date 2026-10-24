//! Backup e restauração do banco e dos anexos (Tarefa 10). Por enquanto só o contrato: os comandos já estão
//! registrados no `lib.rs` (a Tarefa 10 troca o corpo deles aqui, sem mexer em arquivo compartilhado) e respondem
//! com um erro claro. Tipos espelhados em `src/types/index.ts` (`BackupInfo`, `RestoreInfo`).
//!
//! Formato combinado: arquivo `.cmbackup` (zip) com `company-manager.db` (cópia consistente, ex.: `VACUUM INTO`)
//! e a pasta `files/` dos anexos. Backups ficam em `$APPDATA/backups/` quando não se escolhe o destino.
//! No front-end: `invoke("backup_db", { destPath, automatic })`, `invoke("restore_db", { srcPath })`,
//! `invoke("list_backups")` (`@tauri-apps/api/core`); depois de restaurar, `invoke("restart_app")`.
use serde::Serialize;

const NOT_AVAILABLE: &str = "Backup e restauração ainda não estão disponíveis nesta versão do app.";

/// Um arquivo de backup.
#[derive(Debug, Clone, Serialize)]
pub struct BackupInfo {
    /// Caminho completo do arquivo `.cmbackup`.
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    /// ISO-8601 (UTC).
    pub created_at: String,
    /// Maior versão de migration aplicada no banco copiado (`_sqlx_migrations`).
    pub schema_version: Option<i64>,
    /// Feito pela rotina diária (mantém os 14 mais recentes) e não por um pedido manual.
    pub automatic: bool,
}

/// Resultado de uma restauração. O app precisa reiniciar para reabrir o banco.
#[derive(Debug, Clone, Serialize)]
pub struct RestoreInfo {
    pub restored_from: String,
    /// Backup automático do estado anterior, feito antes de restaurar.
    pub safety_backup: Option<BackupInfo>,
    pub schema_version: Option<i64>,
    pub restart_required: bool,
}

/// Gera um backup em `dest_path` (ou em `$APPDATA/backups/` quando ausente).
#[tauri::command]
pub async fn backup_db(dest_path: Option<String>, automatic: Option<bool>) -> Result<BackupInfo, String> {
    let _ = (dest_path, automatic);
    Err(NOT_AVAILABLE.into())
}

/// Restaura o backup de `src_path`: valida a versão do schema, faz backup do estado atual e troca o banco.
#[tauri::command]
pub async fn restore_db(src_path: String) -> Result<RestoreInfo, String> {
    let _ = src_path;
    Err(NOT_AVAILABLE.into())
}

/// Backups em `$APPDATA/backups/`, do mais novo para o mais antigo. Vazio enquanto não houver implementação.
#[tauri::command]
pub async fn list_backups() -> Result<Vec<BackupInfo>, String> {
    Ok(Vec::new())
}
