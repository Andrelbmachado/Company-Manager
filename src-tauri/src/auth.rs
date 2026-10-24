//! Hash de senha com Argon2id (parâmetros padrão do crate: m=19 MiB, t=2, p=1, o mínimo da OWASP).
//! O resultado é o texto PHC ("$argon2id$v=19$m=...,t=...,p=...$sal$hash"), guardado em users.password_hash.
//! Os comandos rodam fora da thread principal: o Argon2 é caro de propósito.
use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

/// Gera o hash Argon2id com sal aleatório novo.
pub fn hash(password: &str) -> Result<String, String> {
    if password.is_empty() {
        return Err("Informe uma senha.".into());
    }
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| format!("Falha ao gerar o hash da senha: {error}"))
}

/// Confere a senha contra um texto PHC de Argon2 (id, i ou d; os parâmetros vêm do próprio texto).
/// Hash corrompido ou de outro algoritmo nunca confere.
pub fn verify(password: &str, stored: &str) -> bool {
    if password.is_empty() {
        return false;
    }
    match PasswordHash::new(stored) {
        Ok(parsed) if parsed.algorithm.as_str().starts_with("argon2") => {
            Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok()
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn hash_password(password: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || hash(&password))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn verify_password(password: String, hash: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || verify(&password, &hash))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gera_argon2id_com_sal_novo_e_confere() {
        let first = hash("segredo123").unwrap();
        let second = hash("segredo123").unwrap();
        assert!(first.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"), "{first}");
        assert_ne!(first, second);
        assert!(!first.contains("segredo123"));
        assert!(verify("segredo123", &first));
        assert!(verify("segredo123", &second));
        assert!(!verify("segredo124", &first));
        assert!(!verify("", &first));
    }

    #[test]
    fn recusa_senha_vazia_e_hash_invalido() {
        assert!(hash("").is_err());
        for stored in ["", "plain:segredo123", "pbkdf2$sha256$1$AAAA$AAAA", "$argon2id$v=19$m=19456,t=2,p=1$curto", "$scrypt$ln=1,r=8,p=1$c2FsdA$aGFzaA"] {
            assert!(!verify("segredo123", stored), "{stored}");
        }
    }

    #[test]
    fn confere_hash_com_parametros_antigos() {
        let weak = Argon2::new(
            argon2::Algorithm::Argon2id,
            argon2::Version::V0x13,
            argon2::Params::new(4096, 1, 1, None).unwrap(),
        )
        .hash_password(b"segredo123", &SaltString::generate(&mut OsRng))
        .unwrap()
        .to_string();
        assert!(weak.contains("m=4096,t=1,p=1"));
        assert!(verify("segredo123", &weak));
        assert!(!verify("outra", &weak));
    }
}
