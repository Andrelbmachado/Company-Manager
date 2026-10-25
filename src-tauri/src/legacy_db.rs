//! Bancos criados pela primeira versão do app (protótipo de 21/10/2026). A `0001_init.sql` daquela versão terminava
//! com uma conta demo embutida; a atual não tem esse trecho, então o checksum gravado em `_sqlx_migrations` não bate e
//! o plugin SQL se recusa a abrir o banco ("migration 1 was previously applied but has been modified"): nenhum login
//! funciona. As tabelas criadas pelas duas versões são idênticas, então basta regravar o checksum da versão 1 com o
//! da migration atual antes do front-end abrir o banco; as migrations seguintes aplicam normalmente.
use std::path::Path;

use sqlx::migrate::{Migration, MigrationType};
use sqlx::sqlite::SqliteConnectOptions;
use sqlx::{ConnectOptions, Connection};

/// Checksum (SHA-384) da `0001_init.sql` do protótipo, com a conta demo no fim.
const LEGACY_0001_CHECKSUM: &str =
    "dc14daa003fabe12acfc5c6f5a9c50607984f05e68b3203d86e7fe2af6bf5f0ea32a4dfd4f0100003491282f59a762b0";

/// Checksum da `0001_init.sql` atual, calculado como o sqlx calcula ao aplicar a migration.
fn current_0001_checksum() -> Vec<u8> {
    Migration::new(
        1,
        "create_initial_tables".into(),
        MigrationType::Simple,
        include_str!("../migrations/0001_init.sql").into(),
        false,
    )
    .checksum
    .into_owned()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Regrava o checksum da versão 1 se o banco em `db_path` veio do protótipo. Banco inexistente, novo ou já atual: nada muda.
/// Retorna se corrigiu.
pub async fn repair(db_path: &Path) -> Result<bool, sqlx::Error> {
    if !db_path.exists() {
        return Ok(false);
    }
    let mut conn = SqliteConnectOptions::new().filename(db_path).connect().await?;
    let has_table: Option<(String,)> =
        sqlx::query_as("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_sqlx_migrations'")
            .fetch_optional(&mut conn)
            .await?;
    if has_table.is_none() {
        conn.close().await?;
        return Ok(false);
    }
    let row: Option<(Vec<u8>,)> = sqlx::query_as("SELECT checksum FROM _sqlx_migrations WHERE version = 1")
        .fetch_optional(&mut conn)
        .await?;
    let fixed = match row {
        Some((checksum,)) if hex(&checksum) == LEGACY_0001_CHECKSUM => {
            sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = 1")
                .bind(current_0001_checksum())
                .execute(&mut conn)
                .await?;
            true
        }
        _ => false,
    };
    conn.close().await?;
    Ok(fixed)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn db_with_checksum(path: &Path, checksum: &[u8]) {
        let mut conn = SqliteConnectOptions::new().filename(path).create_if_missing(true).connect().await.unwrap();
        sqlx::query("CREATE TABLE _sqlx_migrations (version BIGINT PRIMARY KEY, description TEXT, installed_on TEXT, success BOOLEAN, checksum BLOB, execution_time BIGINT)")
            .execute(&mut conn)
            .await
            .unwrap();
        sqlx::query("INSERT INTO _sqlx_migrations VALUES (1, 'create_initial_tables', '2026-10-21', 1, ?, 0)")
            .bind(checksum.to_vec())
            .execute(&mut conn)
            .await
            .unwrap();
        conn.close().await.unwrap();
    }

    async fn stored_checksum(path: &Path) -> Vec<u8> {
        let mut conn = SqliteConnectOptions::new().filename(path).connect().await.unwrap();
        let (checksum,): (Vec<u8>,) =
            sqlx::query_as("SELECT checksum FROM _sqlx_migrations WHERE version = 1").fetch_one(&mut conn).await.unwrap();
        checksum
    }

    fn legacy_bytes() -> Vec<u8> {
        (0..LEGACY_0001_CHECKSUM.len()).step_by(2).map(|i| u8::from_str_radix(&LEGACY_0001_CHECKSUM[i..i + 2], 16).unwrap()).collect()
    }

    fn temp_db(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("cm-legacy-{}-{name}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[tokio::test]
    async fn banco_do_prototipo_recebe_o_checksum_atual() {
        let path = temp_db("prototipo");
        db_with_checksum(&path, &legacy_bytes()).await;
        assert!(repair(&path).await.unwrap());
        assert_eq!(stored_checksum(&path).await, current_0001_checksum());
        // Segunda vez: já está atual, nada muda.
        assert!(!repair(&path).await.unwrap());
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn checksum_desconhecido_nao_e_alterado() {
        let path = temp_db("outro");
        db_with_checksum(&path, &[7u8; 48]).await;
        assert!(!repair(&path).await.unwrap());
        assert_eq!(stored_checksum(&path).await, vec![7u8; 48]);
        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn sem_banco_ou_sem_tabela_de_migrations_nada_muda() {
        let path = temp_db("ausente");
        assert!(!repair(&path).await.unwrap());
        assert!(!path.exists());
    }
}
