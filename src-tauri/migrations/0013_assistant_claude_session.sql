-- Assistente de IA pelo Claude Code local (src-tauri/src/claude_code.rs): id da sessão do `claude` usada pela conversa,
-- para a próxima pergunta continuar com --resume. NULL = sem sessão (conversa pela API ou ainda sem resposta do Claude Code).
ALTER TABLE assistant_conversations ADD COLUMN claude_session_id TEXT;
