//! Backup e restauração do banco e dos anexos (Tarefa 10). Os comandos estão registrados no `lib.rs`; o corpo fica aqui.
//! Tipos espelhados em `src/types/index.ts` (`BackupInfo`, `RestoreInfo`); `kind` e `files_count` são campos a mais
//! que o front-end lê em `src/lib/backup/backup.ts`.
//!
//! Formato `.cmbackup`: zip com `manifest.json`, `company-manager.db` (cópia consistente com `VACUUM INTO`) e a pasta
//! `files/` dos anexos. Sem destino escolhido, os backups ficam em `$APPDATA/backups/`. O automático (um por dia, pedido
//! pelo front-end ao abrir o app) mantém os 14 mais recentes; o "antes de restaurar" também.
//!
//! Restaurar: lê e confere TUDO antes de mexer em qualquer coisa (zip íntegro, manifesto, `PRAGMA integrity_check`,
//! migrations do backup iguais às do banco atual e nenhuma mais nova), faz o backup de segurança do estado atual,
//! copia os anexos e só então grava o banco do backup por cima do atual com a API de backup do SQLite (uma transação:
//! ou entra inteiro ou nada muda). Depois o app reinicia (`restart_app`) e o `tauri-plugin-sql` aplica as migrations
//! que faltarem a um backup mais antigo.
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Nome do banco do app (o mesmo de `sqlite:company-manager.db` no `lib.rs`).
pub const DB_FILE: &str = "company-manager.db";
pub const EXTENSION: &str = "cmbackup";
/// Backups automáticos (e os feitos antes de restaurar) que ficam guardados.
pub const KEEP_AUTOMATIC: usize = 14;

const MANIFEST_FILE: &str = "manifest.json";
const FILES_PREFIX: &str = "files";
const FORMAT: &str = "company-manager-backup";
const FORMAT_VERSION: u32 = 1;

/// Uma operação de cada vez: um backup não roda no meio de uma restauração (e vice-versa).
static OPERATION: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackupKind {
    /// Pedido pela pessoa (botão ou "salvar cópia em...").
    #[serde(rename = "manual")]
    Manual,
    /// Rotina diária.
    #[serde(rename = "automatico")]
    Automatic,
    /// Cópia do estado anterior, feita pela restauração.
    #[serde(rename = "antes_da_restauracao")]
    PreRestore,
}

impl BackupKind {
    fn file_suffix(self) -> &'static str {
        match self {
            BackupKind::Manual => "manual",
            BackupKind::Automatic => "automatico",
            BackupKind::PreRestore => "antes-de-restaurar",
        }
    }
}

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
    pub kind: BackupKind,
    /// Arquivos de anexo dentro do backup.
    pub files_count: u64,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    format: String,
    format_version: u32,
    created_at: String,
    schema_version: Option<i64>,
    kind: BackupKind,
    app_version: String,
    files_count: u64,
}

/// Onde ficam o banco, os anexos e os backups.
#[derive(Debug, Clone)]
pub struct Paths {
    pub db: PathBuf,
    pub files_dir: PathBuf,
    pub backups_dir: PathBuf,
}

impl Paths {
    /// O `tauri-plugin-sql` abre o banco em `app_config_dir`; anexos e backups ficam em `app_data_dir` (`$APPDATA`).
    /// No macOS as duas são `~/Library/Application Support/com.company.manager/`.
    fn of(app: &tauri::AppHandle) -> Result<Self, String> {
        let config = app.path().app_config_dir().map_err(|e| format!("Pasta do banco não encontrada: {e}"))?;
        let data = app.path().app_data_dir().map_err(|e| format!("Pasta de dados do app não encontrada: {e}"))?;
        Ok(Paths { db: config.join(DB_FILE), files_dir: data.join(FILES_PREFIX), backups_dir: data.join("backups") })
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Comandos Tauri
// ---------------------------------------------------------------------------------------------------------------

/// Gera um backup em `dest_path` (ou em `$APPDATA/backups/` quando ausente).
#[tauri::command]
pub async fn backup_db(app: tauri::AppHandle, dest_path: Option<String>, automatic: Option<bool>) -> Result<BackupInfo, String> {
    let paths = Paths::of(&app)?;
    let kind = if automatic.unwrap_or(false) { BackupKind::Automatic } else { BackupKind::Manual };
    blocking(move || {
        let _guard = lock();
        create_backup(&paths, dest_path.as_deref().map(Path::new), kind)
    })
    .await
}

/// Restaura o backup de `src_path`: valida a versão do schema, faz backup do estado atual e troca o banco.
#[tauri::command]
pub async fn restore_db(app: tauri::AppHandle, src_path: String) -> Result<RestoreInfo, String> {
    let paths = Paths::of(&app)?;
    blocking(move || {
        let _guard = lock();
        restore_backup(&paths, Path::new(&src_path))
    })
    .await
}

/// Backups em `$APPDATA/backups/`, do mais novo para o mais antigo.
#[tauri::command]
pub async fn list_backups(app: tauri::AppHandle) -> Result<Vec<BackupInfo>, String> {
    let paths = Paths::of(&app)?;
    blocking(move || list_backups_in(&paths.backups_dir)).await
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job).await.map_err(|e| format!("Falha interna no backup: {e}"))?
}

fn lock() -> std::sync::MutexGuard<'static, ()> {
    OPERATION.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

// ---------------------------------------------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------------------------------------------

const NOT_A_BACKUP: &str = "O arquivo não é um backup do Company Manager (.cmbackup).";
const CORRUPTED: &str = "O backup está corrompido ou incompleto e não pode ser restaurado. O banco atual não foi alterado.";
const NEWER_APP: &str = "Este backup foi feito por uma versão mais nova do Company Manager. Atualize o app antes de restaurar.";

/// Cria um `.cmbackup` com o banco (cópia consistente) e os anexos. `dest` sem a extensão `.cmbackup` a ganha.
pub fn create_backup(paths: &Paths, dest: Option<&Path>, kind: BackupKind) -> Result<BackupInfo, String> {
    if !paths.db.is_file() {
        return Err("O banco de dados ainda não foi criado: conclua a configuração inicial do app antes de fazer backup.".into());
    }
    fs::create_dir_all(&paths.backups_dir).map_err(|e| format!("Não foi possível criar a pasta de backups: {e}"))?;
    let (secs, millis) = now();
    let dest = match dest {
        Some(path) => with_backup_extension(path),
        None => unique_backup_path(&paths.backups_dir, secs, kind),
    };

    let staging = Staging::new(&paths.backups_dir)?;
    let snapshot = staging.path.join(DB_FILE);
    snapshot_db(&paths.db, &snapshot)?;
    let schema_version = schema_version_of(&snapshot)?;
    let attachments = list_files(&paths.files_dir)?;
    let manifest = Manifest {
        format: FORMAT.into(),
        format_version: FORMAT_VERSION,
        created_at: iso_utc(secs, millis),
        schema_version,
        kind,
        app_version: env!("CARGO_PKG_VERSION").into(),
        files_count: attachments.len() as u64,
    };
    write_zip(&dest, &manifest, &snapshot, &attachments)?;
    drop(staging);

    if kind != BackupKind::Manual {
        prune(&paths.backups_dir, kind, KEEP_AUTOMATIC);
    }
    info_for(&dest, &manifest)
}

/// Backups de uma pasta (os `.cmbackup` com manifesto legível), do mais novo para o mais antigo.
pub fn list_backups_in(dir: &Path) -> Result<Vec<BackupInfo>, String> {
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(dir).map_err(|e| format!("Não foi possível ler a pasta de backups: {e}"))?;
    let mut list = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let hidden = path.file_name().and_then(|n| n.to_str()).map_or(true, |n| n.starts_with('.'));
        if hidden || !has_backup_extension(&path) || !path.is_file() {
            continue;
        }
        // Arquivo que não abre como backup (cópia pela metade, outro programa) fica fora da lista.
        let Ok(manifest) = File::open(&path).map_err(|_| ()).and_then(|file| ZipArchive::new(file).map_err(|_| ())).and_then(|mut zip| read_manifest(&mut zip).map_err(|_| ())) else {
            continue;
        };
        if let Ok(info) = info_for(&path, &manifest) {
            list.push(info);
        }
    }
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.file_name.cmp(&a.file_name)));
    Ok(list)
}

/// Mantém os `keep` mais recentes do tipo; os manuais nunca são apagados aqui.
fn prune(dir: &Path, kind: BackupKind, keep: usize) {
    let Ok(list) = list_backups_in(dir) else { return };
    for info in list.into_iter().filter(|info| info.kind == kind).skip(keep) {
        if let Err(error) = fs::remove_file(&info.path) {
            eprintln!("[backup] não foi possível apagar o backup antigo {}: {error}", info.path);
        }
    }
}

/// Cópia consistente do banco aberto (o app pode estar gravando): `VACUUM INTO` lê um retrato único do banco.
fn snapshot_db(db: &Path, dest: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Não foi possível abrir o banco para o backup: {e}"))?;
    conn.busy_timeout(Duration::from_secs(15)).map_err(|e| e.to_string())?;
    let dest = dest.to_str().ok_or("Caminho da pasta de backups inválido.")?;
    conn.execute("VACUUM INTO ?1", [dest]).map_err(|e| format!("Não foi possível copiar o banco: {e}"))?;
    Ok(())
}

fn write_zip(dest: &Path, manifest: &Manifest, db: &Path, attachments: &[(PathBuf, String)]) -> Result<(), String> {
    let file_name = dest.file_name().and_then(|n| n.to_str()).ok_or("Nome de arquivo do backup inválido.")?;
    let partial = dest.with_file_name(format!("{file_name}.part"));
    let result = (|| -> Result<(), String> {
        let file = File::create(&partial).map_err(|e| format!("Não foi possível gravar o backup em {}: {e}", dest.display()))?;
        let mut zip = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let json = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
        zip.start_file(MANIFEST_FILE, options).map_err(zip_error)?;
        zip.write_all(&json).map_err(io_error)?;
        add_file(&mut zip, DB_FILE, db, options)?;
        for (path, rel) in attachments {
            add_file(&mut zip, &format!("{FILES_PREFIX}/{rel}"), path, options)?;
        }
        let file = zip.finish().map_err(zip_error)?;
        file.sync_all().map_err(io_error)?;
        fs::rename(&partial, dest).map_err(|e| format!("Não foi possível gravar o backup em {}: {e}", dest.display()))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    result
}

fn add_file(zip: &mut ZipWriter<File>, name: &str, path: &Path, options: SimpleFileOptions) -> Result<(), String> {
    let size = fs::metadata(path).map_err(io_error)?.len();
    zip.start_file(name, options.large_file(size >= u32::MAX as u64)).map_err(zip_error)?;
    let mut source = File::open(path).map_err(|e| format!("Não foi possível ler {}: {e}", path.display()))?;
    io::copy(&mut source, zip).map_err(io_error)?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------
// Restauração
// ---------------------------------------------------------------------------------------------------------------

/// Restaura `src` por cima do banco e dos anexos atuais. Qualquer problema no arquivo vira erro antes de mudar algo.
pub fn restore_backup(paths: &Paths, src: &Path) -> Result<RestoreInfo, String> {
    let file = File::open(src).map_err(|e| format!("Não foi possível abrir o arquivo {}: {e}", src.display()))?;
    let mut archive = ZipArchive::new(file).map_err(|_| NOT_A_BACKUP.to_string())?;
    read_manifest(&mut archive)?;
    if !paths.db.is_file() {
        return Err("O banco atual do app não foi encontrado; abra o app normalmente antes de restaurar.".into());
    }

    // 1. Tudo é extraído e conferido numa pasta temporária: nada do app muda se algo estiver errado.
    fs::create_dir_all(&paths.backups_dir).map_err(|e| format!("Não foi possível criar a pasta de backups: {e}"))?;
    let staging = Staging::new(&paths.backups_dir)?;
    let staged_db = staging.path.join(DB_FILE);
    extract_entry(&mut archive, DB_FILE, &staged_db)?;
    let schema_version = validate_db(&staged_db, &paths.db)?;
    let staged_files = staging.path.join(FILES_PREFIX);
    extract_attachments(&mut archive, &staged_files)?;

    // 2. Cópia do estado atual, para desfazer a restauração.
    let safety = create_backup(paths, None, BackupKind::PreRestore)
        .map_err(|e| format!("Não foi possível guardar uma cópia do estado atual antes de restaurar: {e}"))?;

    // 3. Anexos (endereçados pelo conteúdo: só acrescenta ou repõe) e, por último, o banco, numa transação só.
    move_tree(&staged_files, &paths.files_dir)?;
    copy_into_live(&staged_db, &paths.db)?;
    drop(staging);

    Ok(RestoreInfo {
        restored_from: src.to_string_lossy().into_owned(),
        safety_backup: Some(safety),
        schema_version,
        restart_required: true,
    })
}

/// Lê e confere o manifesto. Formato mais novo que este app entende vira erro claro (pedir para atualizar o app).
fn read_manifest(archive: &mut ZipArchive<File>) -> Result<Manifest, String> {
    let mut text = String::new();
    {
        let entry = archive.by_name(MANIFEST_FILE).map_err(|_| NOT_A_BACKUP.to_string())?;
        entry.take(1024 * 1024).read_to_string(&mut text).map_err(|_| CORRUPTED.to_string())?;
    }
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|_| NOT_A_BACKUP.to_string())?;
    if value.get("format").and_then(|f| f.as_str()) != Some(FORMAT) {
        return Err(NOT_A_BACKUP.into());
    }
    if value.get("format_version").and_then(|v| v.as_u64()).map_or(true, |v| v > FORMAT_VERSION as u64) {
        return Err(NEWER_APP.into());
    }
    serde_json::from_value(value).map_err(|_| NOT_A_BACKUP.to_string())
}

fn extract_entry(archive: &mut ZipArchive<File>, name: &str, dest: &Path) -> Result<(), String> {
    let mut entry = match archive.by_name(name) {
        Ok(entry) => entry,
        Err(zip::result::ZipError::FileNotFound) => return Err("O backup está incompleto (sem o banco de dados) e não pode ser restaurado.".into()),
        Err(_) => return Err(CORRUPTED.into()),
    };
    let mut out = File::create(dest).map_err(io_error)?;
    // O leitor do zip confere o CRC ao chegar ao fim: byte alterado vira erro aqui.
    io::copy(&mut entry, &mut out).map_err(|_| CORRUPTED.to_string())?;
    out.sync_all().map_err(io_error)
}

/// Extrai `files/...` para `dest`. Recusa caminho absoluto, `..`, link simbólico e nomes estranhos (zip slip).
fn extract_attachments(archive: &mut ZipArchive<File>, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(io_error)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|_| CORRUPTED.to_string())?;
        let name = entry.name().to_string();
        let Some(rest) = name.strip_prefix(&format!("{FILES_PREFIX}/")) else {
            continue;
        };
        let invalid = || format!("O backup tem um caminho de anexo inválido ({name}) e não pode ser restaurado. O banco atual não foi alterado.");
        if entry.is_symlink() {
            return Err(invalid());
        }
        let Some(rel) = safe_relative(rest.trim_end_matches('/')) else {
            if rest.is_empty() || rest == "/" {
                continue;
            }
            return Err(invalid());
        };
        let target = dest.join(rel);
        if entry.is_dir() || name.ends_with('/') {
            fs::create_dir_all(&target).map_err(io_error)?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(io_error)?;
        }
        let mut out = File::create(&target).map_err(io_error)?;
        io::copy(&mut entry, &mut out).map_err(|_| CORRUPTED.to_string())?;
    }
    Ok(())
}

/// Caminho relativo seguro (`a/b/c`): sem raiz, sem `.`/`..`, sem barra invertida, `:` ou NUL.
fn safe_relative(rel: &str) -> Option<PathBuf> {
    if rel.is_empty() || rel.starts_with('/') || rel.contains(['\\', ':', '\0']) {
        return None;
    }
    let mut path = PathBuf::new();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return None;
        }
        path.push(part);
    }
    Some(path)
}

/// Confere o banco do backup e devolve a versão do schema dele.
fn validate_db(staged: &Path, live: &Path) -> Result<Option<i64>, String> {
    let conn = open_read_only(staged).map_err(|_| CORRUPTED.to_string())?;
    let check: String = conn.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(|_| CORRUPTED.to_string())?;
    if check != "ok" {
        return Err(CORRUPTED.into());
    }
    let tables: i64 = conn
        .query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name IN ('companies', '_sqlx_migrations')", [], |row| row.get(0))
        .map_err(|_| CORRUPTED.to_string())?;
    if tables < 2 {
        return Err("O arquivo não é um backup do Company Manager (o banco não tem as tabelas do app).".into());
    }
    let backup = migrations_of(&conn)?;
    if backup.iter().any(|migration| !migration.success) {
        return Err("O backup tem uma atualização de banco que não terminou e não pode ser restaurado.".into());
    }

    let live = migrations_of(&open_read_only(live).map_err(|e| format!("Não foi possível ler o banco atual: {e}"))?)?;
    let backup_max = backup.iter().map(|migration| migration.version).max();
    let live_max = live.iter().map(|migration| migration.version).max();
    if backup_max > live_max {
        return Err(format!(
            "Este backup é de uma versão mais nova do Company Manager (banco na versão {}; este app vai até a {}). Atualize o app antes de restaurar.",
            backup_max.unwrap_or(0),
            live_max.unwrap_or(0)
        ));
    }
    // Mesmo número com conteúdo diferente = migrations de outra cópia do app; o plugin SQL recusaria abrir esse banco.
    for migration in &backup {
        if !live.iter().any(|current| current.version == migration.version && current.checksum == migration.checksum) {
            return Err(format!(
                "Este backup foi feito por outra cópia do Company Manager (a atualização {} do banco é diferente) e não pode ser restaurado aqui.",
                migration.version
            ));
        }
    }
    Ok(backup_max)
}

struct AppliedMigration {
    version: i64,
    checksum: Vec<u8>,
    success: bool,
}

fn migrations_of(conn: &Connection) -> Result<Vec<AppliedMigration>, String> {
    if !has_migrations_table(conn)? {
        return Ok(Vec::new());
    }
    let mut statement = conn.prepare("SELECT version, checksum, success FROM _sqlx_migrations ORDER BY version").map_err(|_| CORRUPTED.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(AppliedMigration { version: row.get(0)?, checksum: row.get(1)?, success: row.get::<_, i64>(2)? != 0 })
        })
        .map_err(|_| CORRUPTED.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|_| CORRUPTED.to_string())
}

fn has_migrations_table(conn: &Connection) -> Result<bool, String> {
    conn.query_row("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'", [], |row| row.get::<_, i64>(0))
        .map(|count| count > 0)
        .map_err(|_| CORRUPTED.to_string())
}

fn schema_version_of(db: &Path) -> Result<Option<i64>, String> {
    let conn = open_read_only(db).map_err(|e| format!("Não foi possível ler a cópia do banco: {e}"))?;
    if !has_migrations_table(&conn)? {
        return Ok(None);
    }
    conn.query_row("SELECT max(version) FROM _sqlx_migrations WHERE success = 1", [], |row| row.get::<_, Option<i64>>(0))
        .map_err(|e| format!("Não foi possível ler a versão do banco: {e}"))
}

/// Grava o banco do backup por cima do atual com a API de backup do SQLite: transação única no destino (ou entra tudo,
/// ou nada muda) e funciona com o banco aberto pelo app; as outras conexões passam a ver o conteúdo novo.
fn copy_into_live(staged: &Path, live: &Path) -> Result<(), String> {
    let source = open_read_only(staged).map_err(|_| CORRUPTED.to_string())?;
    let mut target = Connection::open_with_flags(live, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|e| format!("Não foi possível abrir o banco atual: {e}"))?;
    target.busy_timeout(Duration::from_secs(15)).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&source, &mut target).map_err(|e| format!("Não foi possível restaurar o banco: {e}"))?;
    let deadline = std::time::Instant::now() + Duration::from_secs(30);
    loop {
        match backup.step(-1).map_err(|e| format!("Não foi possível restaurar o banco: {e}"))? {
            rusqlite::backup::StepResult::Done => return Ok(()),
            rusqlite::backup::StepResult::More => continue,
            _ if std::time::Instant::now() > deadline => {
                return Err("O banco está ocupado e não pôde ser restaurado agora. Feche outras janelas do app e tente de novo.".into())
            }
            _ => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

/// Move os arquivos de `src` para `dest` (mesma árvore), repondo os que já existem.
fn move_tree(src: &Path, dest: &Path) -> Result<(), String> {
    for (path, rel) in list_files(src)? {
        let target = dest.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("Não foi possível restaurar os anexos: {e}"))?;
        }
        if fs::rename(&path, &target).is_err() {
            fs::copy(&path, &target).map_err(|e| format!("Não foi possível restaurar o anexo {}: {e}", target.display()))?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------------------------------------------

/// Pasta temporária (dentro da pasta de backups, mesmo disco do app) apagada ao sair do escopo.
struct Staging {
    path: PathBuf,
}

impl Staging {
    fn new(parent: &Path) -> Result<Self, String> {
        let path = parent.join(format!(".tmp-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).map_err(|e| format!("Não foi possível criar a pasta temporária do backup: {e}"))?;
        Ok(Staging { path })
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn open_read_only(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
}

/// Arquivos comuns de uma pasta, recursivo (sem links simbólicos nem `.DS_Store`), com o caminho relativo em `a/b/c`.
fn list_files(dir: &Path) -> Result<Vec<(PathBuf, String)>, String> {
    fn walk(dir: &Path, prefix: &str, out: &mut Vec<(PathBuf, String)>) -> Result<(), String> {
        let entries = fs::read_dir(dir).map_err(|e| format!("Não foi possível ler {}: {e}", dir.display()))?;
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            let Ok(meta) = fs::symlink_metadata(&path) else { continue };
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if meta.is_dir() {
                walk(&path, &rel, out)?;
            } else if meta.is_file() && name != ".DS_Store" {
                out.push((path, rel));
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    if dir.is_dir() {
        walk(dir, "", &mut files)?;
    }
    files.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(files)
}

fn info_for(path: &Path, manifest: &Manifest) -> Result<BackupInfo, String> {
    let size_bytes = fs::metadata(path).map_err(io_error)?.len();
    Ok(BackupInfo {
        path: path.to_string_lossy().into_owned(),
        file_name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        size_bytes,
        created_at: manifest.created_at.clone(),
        schema_version: manifest.schema_version,
        automatic: manifest.kind == BackupKind::Automatic,
        kind: manifest.kind,
        files_count: manifest.files_count,
    })
}

fn has_backup_extension(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(EXTENSION))
}

fn with_backup_extension(path: &Path) -> PathBuf {
    if has_backup_extension(path) {
        return path.to_path_buf();
    }
    let mut name = path.as_os_str().to_owned();
    name.push(format!(".{EXTENSION}"));
    PathBuf::from(name)
}

/// `company-manager-AAAAMMDD-HHMMSS-<tipo>.cmbackup`, com `-2`, `-3`... se já existir.
fn unique_backup_path(dir: &Path, secs: i64, kind: BackupKind) -> PathBuf {
    let base = format!("company-manager-{}-{}", file_stamp(secs), kind.file_suffix());
    let mut candidate = dir.join(format!("{base}.{EXTENSION}"));
    let mut counter = 2;
    while candidate.exists() {
        candidate = dir.join(format!("{base}-{counter}.{EXTENSION}"));
        counter += 1;
    }
    candidate
}

fn io_error(error: io::Error) -> String {
    format!("Erro de arquivo no backup: {error}")
}

fn zip_error(error: zip::result::ZipError) -> String {
    format!("Erro ao montar o arquivo de backup: {error}")
}

// ---------------------------------------------------------------------------------------------------------------
// Datas (UTC, sem depender de crate de calendário)
// ---------------------------------------------------------------------------------------------------------------

fn now() -> (i64, u32) {
    let elapsed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    (elapsed.as_secs() as i64, elapsed.subsec_millis())
}

/// (ano, mês, dia, hora, minuto, segundo) em UTC. Algoritmo "days from civil" de Howard Hinnant.
fn civil(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day, (rem / 3_600) as u32, (rem % 3_600 / 60) as u32, (rem % 60) as u32)
}

/// `AAAA-MM-DDTHH:MM:SS.mmmZ`.
fn iso_utc(secs: i64, millis: u32) -> String {
    let (y, mo, d, h, mi, s) = civil(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}.{millis:03}Z")
}

/// `AAAAMMDD-HHMMSS` (nome de arquivo).
fn file_stamp(secs: i64) -> String {
    let (y, mo, d, h, mi, s) = civil(secs);
    format!("{y:04}{mo:02}{d:02}-{h:02}{mi:02}{s:02}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    /// Pastas de um "app" de teste em um diretório temporário próprio (apagado no fim).
    struct Sandbox {
        root: PathBuf,
        paths: Paths,
    }

    impl Sandbox {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("cm-backup-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(root.join("config")).unwrap();
            let paths = Paths {
                db: root.join("config").join(DB_FILE),
                files_dir: root.join("data").join("files"),
                backups_dir: root.join("data").join("backups"),
            };
            Sandbox { root, paths }
        }

        /// Banco com as migrations reais do app e a tabela de controle do sqlx.
        fn with_app_db(self) -> Self {
            create_app_db(&self.paths.db, &[]);
            self
        }

        fn conn(&self) -> Connection {
            Connection::open(&self.paths.db).unwrap()
        }

        fn backups(&self) -> Vec<PathBuf> {
            match fs::read_dir(&self.paths.backups_dir) {
                Ok(entries) => entries
                    .map(|entry| entry.unwrap().path())
                    .filter(|path| path.extension().and_then(|e| e.to_str()) == Some(EXTENSION))
                    .collect(),
                Err(_) => Vec::new(),
            }
        }

        fn attachment(&self, rel: &str) -> PathBuf {
            self.paths.files_dir.join(rel)
        }
    }

    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    /// Migrations de `src-tauri/migrations` em ordem numérica.
    fn migrations() -> Vec<(i64, String, String)> {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("migrations");
        let mut files: Vec<(i64, String, String)> = fs::read_dir(dir)
            .unwrap()
            .filter_map(|entry| {
                let path = entry.ok()?.path();
                let name = path.file_name()?.to_str()?.to_string();
                let version: i64 = name.split('_').next()?.parse().ok()?;
                Some((version, name, fs::read_to_string(&path).ok()?))
            })
            .collect();
        files.sort_by_key(|(version, _, _)| *version);
        files
    }

    /// Cria um banco como o do app: migrations aplicadas e registradas em `_sqlx_migrations` (checksum fictício por versão).
    /// `extra_versions` acrescenta (ou troca o checksum de) versões, para simular outra versão ou outra cópia do app.
    fn create_app_db(path: &Path, extra_versions: &[(i64, &[u8])]) {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL);",
        )
        .unwrap();
        for (version, name, sql) in migrations() {
            conn.execute_batch(&sql).unwrap_or_else(|e| panic!("migration {name}: {e}"));
            conn.execute(
                "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?1, ?2, 1, ?3, 0)",
                params![version, name, checksum(version)],
            )
            .unwrap();
        }
        for (version, sum) in extra_versions {
            conn.execute(
                "INSERT OR REPLACE INTO _sqlx_migrations (version, description, success, checksum, execution_time) VALUES (?1, 'extra', 1, ?2, 0)",
                params![version, sum.to_vec()],
            )
            .unwrap();
        }
    }

    fn checksum(version: i64) -> Vec<u8> {
        format!("checksum-{version}").into_bytes()
    }

    fn latest_version() -> i64 {
        migrations().last().unwrap().0
    }

    fn insert_company(conn: &Connection, id: &str, name: &str) {
        conn.execute("INSERT INTO companies (id, name) VALUES (?1, ?2)", params![id, name]).unwrap();
    }

    fn company_names(conn: &Connection) -> Vec<String> {
        let mut statement = conn.prepare("SELECT name FROM companies ORDER BY name").unwrap();
        let names = statement.query_map([], |row| row.get::<_, String>(0)).unwrap().map(|row| row.unwrap()).collect();
        names
    }

    fn write_attachment(sandbox: &Sandbox, rel: &str, content: &str) {
        let path = sandbox.attachment(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    /// Zip montado à mão (manifesto + banco + entradas extras), para os casos de arquivo adulterado.
    fn handmade_backup(path: &Path, manifest: Option<&str>, db: Option<&[u8]>, extra: &[(&str, &[u8])]) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        if let Some(manifest) = manifest {
            zip.start_file(MANIFEST_FILE, options).unwrap();
            zip.write_all(manifest.as_bytes()).unwrap();
        }
        if let Some(db) = db {
            zip.start_file(DB_FILE, options).unwrap();
            zip.write_all(db).unwrap();
        }
        for (name, content) in extra {
            zip.start_file(*name, options).unwrap();
            zip.write_all(content).unwrap();
        }
        zip.finish().unwrap();
    }

    fn valid_manifest(schema_version: i64) -> String {
        format!(
            r#"{{"format":"{FORMAT}","format_version":1,"created_at":"2026-10-24T10:00:00.000Z","schema_version":{schema_version},"kind":"manual","app_version":"0.1.0","files_count":0}}"#
        )
    }

    /// O banco atual continua igual e nenhum backup de segurança foi feito.
    fn assert_untouched(sandbox: &Sandbox, backups_before: usize) {
        assert_eq!(company_names(&sandbox.conn()), vec!["Empresa Atual".to_string()]);
        assert_eq!(sandbox.backups().len(), backups_before, "não deveria ter feito backup de segurança");
    }

    #[test]
    fn backup_e_restauracao_trazem_de_volta_dado_apagado_e_anexo() {
        let sandbox = Sandbox::new().with_app_db();
        insert_company(&sandbox.conn(), "c1", "Empresa Original");
        write_attachment(&sandbox, "c1/ab/ab12", "contrato assinado");

        let info = create_backup(&sandbox.paths, None, BackupKind::Manual).unwrap();
        assert!(Path::new(&info.path).exists());
        assert!(info.file_name.ends_with(".cmbackup"));
        assert_eq!(info.kind, BackupKind::Manual);
        assert!(!info.automatic);
        assert_eq!(info.schema_version, Some(latest_version()));
        assert_eq!(info.files_count, 1);
        assert!(info.size_bytes > 0);
        assert!(info.created_at.ends_with('Z'));

        // Apaga o dado e o anexo, e cria algo novo que não existia no backup.
        sandbox.conn().execute("DELETE FROM companies", []).unwrap();
        insert_company(&sandbox.conn(), "c2", "Empresa Depois");
        fs::remove_file(sandbox.attachment("c1/ab/ab12")).unwrap();

        let restored = restore_backup(&sandbox.paths, Path::new(&info.path)).unwrap();
        assert!(restored.restart_required);
        assert_eq!(restored.schema_version, Some(latest_version()));
        assert_eq!(restored.restored_from, info.path);
        assert_eq!(company_names(&sandbox.conn()), vec!["Empresa Original".to_string()]);
        assert_eq!(fs::read_to_string(sandbox.attachment("c1/ab/ab12")).unwrap(), "contrato assinado");

        // O estado anterior (com a "Empresa Depois") ficou guardado num backup de segurança, que também restaura.
        let safety = restored.safety_backup.expect("backup de segurança");
        assert_eq!(safety.kind, BackupKind::PreRestore);
        assert!(!safety.automatic);
        let undo = restore_backup(&sandbox.paths, Path::new(&safety.path)).unwrap();
        assert!(undo.safety_backup.is_some());
        assert_eq!(company_names(&sandbox.conn()), vec!["Empresa Depois".to_string()]);
    }

    #[test]
    fn restaurar_com_o_banco_aberto_por_outra_conexao_funciona() {
        // No app, o pool do tauri-plugin-sql continua com o banco aberto durante a restauração.
        let sandbox = Sandbox::new().with_app_db();
        insert_company(&sandbox.conn(), "c1", "Empresa Original");
        let info = create_backup(&sandbox.paths, None, BackupKind::Manual).unwrap();
        let pool = sandbox.conn();
        pool.execute("DELETE FROM companies", []).unwrap();

        restore_backup(&sandbox.paths, Path::new(&info.path)).unwrap();
        assert_eq!(company_names(&pool), vec!["Empresa Original".to_string()]);
    }

    #[test]
    fn restaurar_arquivo_que_nao_e_backup_falha_sem_mexer_em_nada() {
        let sandbox = Sandbox::new().with_app_db();
        insert_company(&sandbox.conn(), "c1", "Empresa Atual");
        let bogus = sandbox.root.join("planilha.cmbackup");
        fs::write(&bogus, "isto não é um zip").unwrap();

        let error = restore_backup(&sandbox.paths, &bogus).unwrap_err();
        assert!(error.contains("não é um backup"), "{error}");
        assert_untouched(&sandbox, 0);

        let missing = restore_backup(&sandbox.paths, &sandbox.root.join("nao-existe.cmbackup")).unwrap_err();
        assert!(missing.contains("abrir"), "{missing}");
        assert_untouched(&sandbox, 0);
    }

    #[test]
    fn restaurar_backup_corrompido_falha_sem_mexer_em_nada() {
        let sandbox = Sandbox::new().with_app_db();
        insert_company(&sandbox.conn(), "c1", "Empresa Atual");
        let good = create_backup(&sandbox.paths, None, BackupKind::Manual).unwrap();

        // Arquivo cortado pela metade (download/cópia interrompida).
        let bytes = fs::read(&good.path).unwrap();
        let truncated = sandbox.root.join("cortado.cmbackup");
        fs::write(&truncated, &bytes[..bytes.len() / 2]).unwrap();
        assert!(restore_backup(&sandbox.paths, &truncated).is_err());

        // Banco dentro do zip que não é SQLite.
        let garbage = sandbox.root.join("lixo.cmbackup");
        handmade_backup(&garbage, Some(&valid_manifest(latest_version())), Some(b"isto nao e um banco sqlite, so texto qualquer"), &[]);
        let error = restore_backup(&sandbox.paths, &garbage).unwrap_err();
        assert!(error.contains("corrompido"), "{error}");

        // Bytes do banco alterados depois de gravados (o CRC do zip não confere).
        let db = fs::read(&sandbox.paths.db).unwrap();
        let flipped = sandbox.root.join("adulterado.cmbackup");
        handmade_backup(&flipped, Some(&valid_manifest(latest_version())), Some(&db), &[]);
        let mut tampered = fs::read(&flipped).unwrap();
        let middle = tampered.len() / 2;
        tampered[middle] ^= 0xFF;
        fs::write(&flipped, &tampered).unwrap();
        assert!(restore_backup(&sandbox.paths, &flipped).is_err());

        // Zip sem manifesto ou sem banco.
        let no_manifest = sandbox.root.join("sem-manifesto.cmbackup");
        handmade_backup(&no_manifest, None, Some(&db), &[]);
        assert!(restore_backup(&sandbox.paths, &no_manifest).unwrap_err().contains("não é um backup"));
        let no_db = sandbox.root.join("sem-banco.cmbackup");
        handmade_backup(&no_db, Some(&valid_manifest(latest_version())), None, &[]);
        assert!(restore_backup(&sandbox.paths, &no_db).is_err());

        assert_untouched(&sandbox, 1);
    }

    #[test]
    fn restaurar_backup_de_versao_futura_ou_de_outra_copia_do_app_falha() {
        let sandbox = Sandbox::new().with_app_db();
        insert_company(&sandbox.conn(), "c1", "Empresa Atual");

        // Banco de uma versão mais nova do app: tem uma migration que este app não conhece.
        let future = Sandbox::new();
        create_app_db(&future.paths.db, &[(latest_version() + 1, b"futura")]);
        let future_backup = create_backup(&future.paths, None, BackupKind::Manual).unwrap();
        assert_eq!(future_backup.schema_version, Some(latest_version() + 1));
        let error = restore_backup(&sandbox.paths, Path::new(&future_backup.path)).unwrap_err();
        assert!(error.contains("mais nova"), "{error}");

        // Manifesto de um formato mais novo.
        let db = fs::read(&sandbox.paths.db).unwrap();
        let newer_format = sandbox.root.join("formato-novo.cmbackup");
        handmade_backup(&newer_format, Some(&valid_manifest(latest_version()).replace("\"format_version\":1", "\"format_version\":99")), Some(&db), &[]);
        assert!(restore_backup(&sandbox.paths, &newer_format).unwrap_err().contains("mais nova"));

        // Outra cópia do app (migration 1 com conteúdo diferente): o plugin SQL recusaria abrir o banco depois.
        let other = Sandbox::new();
        create_app_db(&other.paths.db, &[(1, b"outra-copia")]);
        let other_backup = create_backup(&other.paths, None, BackupKind::Manual).unwrap();
        let error = restore_backup(&sandbox.paths, Path::new(&other_backup.path)).unwrap_err();
        assert!(error.contains("outra cópia"), "{error}");

        assert_untouched(&sandbox, 0);
    }

    #[test]
    fn backup_antigo_restaura_e_as_migrations_novas_ficam_para_o_reinicio() {
        let sandbox = Sandbox::new().with_app_db();
        insert_company(&sandbox.conn(), "c1", "Empresa Atual");

        let old = Sandbox::new();
        create_app_db(&old.paths.db, &[]);
        let old_conn = Connection::open(&old.paths.db).unwrap();
        insert_company(&old_conn, "c-old", "Empresa Antiga");
        old_conn.execute("DELETE FROM _sqlx_migrations WHERE version = ?1", [latest_version()]).unwrap();
        drop(old_conn);
        let old_backup = create_backup(&old.paths, None, BackupKind::Manual).unwrap();
        assert_eq!(old_backup.schema_version, Some(latest_version() - 1));

        let restored = restore_backup(&sandbox.paths, Path::new(&old_backup.path)).unwrap();
        assert_eq!(restored.schema_version, Some(latest_version() - 1));
        assert_eq!(company_names(&sandbox.conn()), vec!["Empresa Antiga".to_string()]);
    }

    #[test]
    fn zip_com_caminho_fora_da_pasta_de_anexos_e_recusado() {
        let sandbox = Sandbox::new().with_app_db();
        insert_company(&sandbox.conn(), "c1", "Empresa Atual");
        let db = fs::read(&sandbox.paths.db).unwrap();
        let evil = sandbox.root.join("malicioso.cmbackup");
        handmade_backup(&evil, Some(&valid_manifest(latest_version())), Some(&db), &[("files/../../../fora.txt", b"x")]);

        let error = restore_backup(&sandbox.paths, &evil).unwrap_err();
        assert!(error.contains("inválido"), "{error}");
        assert!(!sandbox.root.join("fora.txt").exists());
        assert!(!sandbox.root.join("data").join("fora.txt").exists());
        assert_untouched(&sandbox, 0);
    }

    #[test]
    fn automatico_mantem_os_14_mais_recentes_e_nao_apaga_os_manuais() {
        let sandbox = Sandbox::new().with_app_db();
        let manual = create_backup(&sandbox.paths, None, BackupKind::Manual).unwrap();
        for _ in 0..(KEEP_AUTOMATIC + 2) {
            create_backup(&sandbox.paths, None, BackupKind::Automatic).unwrap();
        }

        let list = list_backups_in(&sandbox.paths.backups_dir).unwrap();
        let automatic: Vec<_> = list.iter().filter(|info| info.kind == BackupKind::Automatic).collect();
        assert_eq!(automatic.len(), KEEP_AUTOMATIC);
        assert!(automatic.iter().all(|info| info.automatic));
        assert!(list.iter().any(|info| info.path == manual.path));
        assert_eq!(list.len(), KEEP_AUTOMATIC + 1);
        // Do mais novo para o mais antigo: o manual foi o primeiro a ser feito.
        assert_eq!(list.last().unwrap().path, manual.path);
        assert!(list.windows(2).all(|pair| pair[0].created_at >= pair[1].created_at));
    }

    #[test]
    fn destino_escolhido_ganha_a_extensao_e_nao_aparece_na_lista_da_pasta_do_app() {
        let sandbox = Sandbox::new().with_app_db();
        let chosen = sandbox.root.join("Meu backup");
        let info = create_backup(&sandbox.paths, Some(&chosen), BackupKind::Manual).unwrap();
        assert_eq!(PathBuf::from(&info.path), sandbox.root.join("Meu backup.cmbackup"));
        assert!(Path::new(&info.path).exists());
        assert!(list_backups_in(&sandbox.paths.backups_dir).unwrap().is_empty());
        // Nenhum arquivo temporário sobrou (nem ao lado do destino, nem na pasta de backups).
        let leftovers: Vec<_> = fs::read_dir(&sandbox.root).unwrap().map(|e| e.unwrap().file_name()).filter(|name| name.to_string_lossy().contains("part")).collect();
        assert!(leftovers.is_empty(), "{leftovers:?}");
        let staging: Vec<_> = fs::read_dir(&sandbox.paths.backups_dir).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert!(staging.is_empty(), "{staging:?}");
    }

    #[test]
    fn sem_banco_nao_ha_backup_e_pasta_vazia_lista_nada() {
        let sandbox = Sandbox::new();
        let error = create_backup(&sandbox.paths, None, BackupKind::Automatic).unwrap_err();
        assert!(error.contains("banco"), "{error}");
        assert!(list_backups_in(&sandbox.paths.backups_dir).unwrap().is_empty());
    }

    #[test]
    fn datas_em_utc() {
        assert_eq!(iso_utc(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(1_792_815_994, 7), "2026-10-24T04:26:34.007Z");
        assert_eq!(file_stamp(1_792_815_994), "20261024-042634");
        assert_eq!(iso_utc(951_782_400, 0), "2000-02-29T00:00:00.000Z");
    }
}
