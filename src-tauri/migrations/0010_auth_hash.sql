-- ============================================================
-- 0010_auth_hash: senhas com hash e troca de senha obrigatória
-- ============================================================
-- O algoritmo fica no próprio users.password_hash: "$argon2id$..." (app desktop, comando Rust hash_password),
-- "pbkdf2$sha256$..." (navegador, WebCrypto) ou o legado "plain:<senha>". O login confere qualquer um deles e
-- regrava os antigos no formato atual na próxima entrada, sem pedir nada à pessoa.

-- 1 = a pessoa precisa escolher uma senha nova antes de usar o sistema (senha inicial, redefinição pelo CEO/Administração
-- ou "forçar troca de senha" em Configurações > Usuários e acessos).
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;

-- Última vez que a senha foi escolhida ou redefinida (o rehash automático não conta).
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
