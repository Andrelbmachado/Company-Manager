-- Senhas com hash (argon2id no desktop, PBKDF2 no navegador) e troca de senha obrigatória.
-- O formato vem no próprio texto de password_hash ("$argon2id$...", "pbkdf2$...", "plain:..." legado);
-- password_algo é só um espelho para consulta/relatório, mantido pelos gatilhos abaixo (o app não o grava).
ALTER TABLE users ADD COLUMN password_algo TEXT NOT NULL DEFAULT 'plain';
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1));
ALTER TABLE users ADD COLUMN password_changed_at TEXT;

UPDATE users SET password_algo = CASE
  WHEN password_hash GLOB '$argon2id$*' THEN 'argon2id'
  WHEN password_hash GLOB '$argon2*' THEN 'argon2'
  WHEN password_hash GLOB 'pbkdf2$*' THEN 'pbkdf2'
  WHEN password_hash GLOB 'plain:*' THEN 'plain'
  ELSE 'unknown'
END;

CREATE TRIGGER users_password_algo_insert AFTER INSERT ON users
BEGIN
  UPDATE users SET password_algo = CASE
    WHEN NEW.password_hash GLOB '$argon2id$*' THEN 'argon2id'
    WHEN NEW.password_hash GLOB '$argon2*' THEN 'argon2'
    WHEN NEW.password_hash GLOB 'pbkdf2$*' THEN 'pbkdf2'
    WHEN NEW.password_hash GLOB 'plain:*' THEN 'plain'
    ELSE 'unknown'
  END
  WHERE id = NEW.id;
END;

CREATE TRIGGER users_password_algo_update AFTER UPDATE OF password_hash ON users
BEGIN
  UPDATE users SET password_algo = CASE
    WHEN NEW.password_hash GLOB '$argon2id$*' THEN 'argon2id'
    WHEN NEW.password_hash GLOB '$argon2*' THEN 'argon2'
    WHEN NEW.password_hash GLOB 'pbkdf2$*' THEN 'pbkdf2'
    WHEN NEW.password_hash GLOB 'plain:*' THEN 'plain'
    ELSE 'unknown'
  END
  WHERE id = NEW.id;
END;
