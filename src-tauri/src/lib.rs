use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use tauri_plugin_sql::{Migration, MigrationKind};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Olá, {}! Company Manager iniciado.", name)
}

/// Argon2id com os parâmetros padrão do crate (m=19 MiB, t=2, p=1, o mínimo da OWASP), no formato PHC
/// ("$argon2id$v=19$m=19456,t=2,p=1$<sal>$<hash>"), que guarda o próprio sal e os parâmetros.
fn argon2_hash(password: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|err| format!("não foi possível gerar o hash da senha: {err}"))
}

/// Confere com os parâmetros gravados no próprio hash (um hash antigo com outros parâmetros continua valendo).
fn argon2_verify(password: &str, hash: &str) -> Result<bool, String> {
    let parsed = PasswordHash::new(hash).map_err(|err| format!("hash de senha inválido: {err}"))?;
    Ok(Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
}

// O argon2 é lento de propósito: roda numa thread de bloqueio para não travar a janela.
#[tauri::command]
async fn hash_password(password: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || argon2_hash(&password))
        .await
        .map_err(|err| format!("falha ao calcular o hash da senha: {err}"))?
}

#[tauri::command]
async fn verify_password(password: String, hash: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || argon2_verify(&password, &hash))
        .await
        .map_err(|err| format!("falha ao conferir a senha: {err}"))?
}

#[cfg(test)]
mod password_tests {
    use super::*;

    #[test]
    fn argon2id_round_trip() {
        let hash = argon2_hash("segredo123").unwrap();
        assert!(hash.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"));
        assert_ne!(hash, argon2_hash("segredo123").unwrap(), "sal novo a cada hash");
        assert!(argon2_verify("segredo123", &hash).unwrap());
        assert!(!argon2_verify("segredo124", &hash).unwrap());
        assert!(argon2_verify("x", "plain:x").is_err());
    }
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
            version: 10,
            description: "auth_hash",
            sql: include_str!("../migrations/0010_auth_hash.sql"),
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
        .invoke_handler(tauri::generate_handler![greet, hash_password, verify_password])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
