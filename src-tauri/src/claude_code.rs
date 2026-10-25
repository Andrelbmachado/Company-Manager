//! Assistente de IA pelo Claude Code instalado no Mac: com o `claude` instalado e logado, o app não precisa de chave de API.
//!
//! - Apps de interface não herdam o PATH do Terminal: o binário é procurado em pastas conhecidas e, por último,
//!   no shell de login (`zsh -lc 'command -v claude'`, texto fixo, sem nada do usuário).
//! - A pergunta roda o binário direto (`Command` com argumentos, nunca via shell), em modo não interativo
//!   (`-p --output-format json`), sem nenhuma ferramenta, com a pergunta pela entrada padrão e o cwd numa pasta vazia do app.
//! - "@caminho" na pergunta faria o `claude` anexar o arquivo (ou a listagem da pasta) mesmo com `--tools ""`: a regra
//!   `deny: ["Read"]` passada em `--settings` bloqueia. "/" no começo viraria comando: a pergunta vai com um espaço de
//!   largura zero antes.
//! - A conversa continua com `--resume <session_id>` (o id fica gravado na conversa do app).
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::Duration;

/// Tempo máximo de uma resposta.
pub const ASK_TIMEOUT: Duration = Duration::from_secs(300);
/// `--version`, `--help` e `auth status`.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
const SHELL_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_PROMPT_BYTES: usize = 1_000_000;
const MAX_SYSTEM_PROMPT_CHARS: usize = 8_000;
const MAX_SESSION_ID_LEN: usize = 100;
const MAX_ERROR_CHARS: usize = 600;
/// Pastas fixas do sistema (depois de ~/.local/bin e ~/.claude/local, antes do nvm).
const SYSTEM_DIRS: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];
/// Nega o Read: sem isso, "@/caminho" (ou "@~", "@../..") na pergunta anexa arquivo ou pasta do disco ao contexto.
const DENY_FILE_READS: &str = r#"{"permissions":{"deny":["Read"]}}"#;
const LOGIN_HINT: &str = "O Claude Code está instalado, mas sem login. Abra o Terminal, rode `claude` e entre na sua conta.";
const TOO_OLD: &str = "Esta versão do Claude Code é antiga demais. Atualize com `claude update` no Terminal.";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ClaudeCodeStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// `None` quando não deu para conferir (versão sem `auth status`): a pergunta mostra o erro, se houver.
    pub logged_in: Option<bool>,
    /// Por que não está disponível (texto para a tela).
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ClaudeCodeReply {
    pub text: String,
    pub session_id: String,
}

/// Opções que a versão instalada aceita (lidas do `claude --help`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CliFlags {
    pub tools: bool,
    pub settings: bool,
    pub permission_prompts: bool,
    pub safe_mode: bool,
    pub strict_mcp_config: bool,
    pub disable_slash_commands: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Lê do `claude --help` as opções que a versão instalada aceita (nome exato, seguido de espaço ou fim de linha).
pub fn parse_cli_flags(help: &str) -> CliFlags {
    let has = |flag: &str| {
        help.lines().any(|line| {
            line.split(|c: char| c.is_whitespace() || c == ',').any(|word| word == flag)
        })
    };
    CliFlags {
        tools: has("--tools"),
        settings: has("--settings"),
        permission_prompts: has("--permission-prompts"),
        safe_mode: has("--safe-mode"),
        strict_mcp_config: has("--strict-mcp-config"),
        disable_slash_commands: has("--disable-slash-commands"),
    }
}

/// Id de sessão do Claude Code (UUID): letras, números e hífen, começando por letra ou número.
pub fn is_valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_SESSION_ID_LEN
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && id.chars().next().is_some_and(|c| c.is_ascii_alphanumeric())
}

/// Argumentos do `claude` para uma pergunta: não interativo, resposta em JSON e nenhuma ferramenta.
/// A pergunta não entra aqui: vai pela entrada padrão (não vira opção nem esbarra no limite de argumentos).
pub fn build_ask_args(flags: &CliFlags, system_prompt: Option<&str>, session_id: Option<&str>) -> Result<Vec<String>, String> {
    if !flags.tools {
        return Err("Esta versão do Claude Code não permite desligar as ferramentas (falta --tools). Atualize com `claude update`.".into());
    }
    if !flags.settings {
        return Err("Esta versão do Claude Code não permite bloquear a leitura de arquivos (falta --settings). Atualize com `claude update`.".into());
    }
    let mut args: Vec<String> = vec!["-p".into(), "--output-format".into(), "json".into()];
    // `--tools ""` tira todas as ferramentas embutidas; dontAsk nega o que não foi liberado antes (nada é liberado).
    args.extend(["--tools".into(), String::new(), "--permission-mode".into(), "dontAsk".into()]);
    args.extend(["--settings".into(), DENY_FILE_READS.into()]);
    if flags.permission_prompts {
        args.extend(["--permission-prompts".into(), "none".into()]);
    }
    // Sem servidores MCP, sem CLAUDE.md, hooks, plugins e skills do usuário, sem comandos de barra.
    if flags.strict_mcp_config {
        args.push("--strict-mcp-config".into());
    }
    if flags.safe_mode {
        args.push("--safe-mode".into());
    }
    if flags.disable_slash_commands {
        args.push("--disable-slash-commands".into());
    }
    if let Some(text) = system_prompt.map(str::trim).filter(|text| !text.is_empty()) {
        if text.chars().count() > MAX_SYSTEM_PROMPT_CHARS {
            return Err("Instrução do assistente grande demais.".into());
        }
        if text.contains('\0') {
            return Err("Instrução do assistente inválida.".into());
        }
        // Com "=", um texto que comece por "-" continua sendo o valor da opção.
        args.push(format!("--system-prompt={text}"));
    }
    if let Some(id) = session_id {
        if !is_valid_session_id(id) {
            return Err("Sessão do Claude Code inválida.".into());
        }
        args.extend(["--resume".into(), id.to_string()]);
    }
    Ok(args)
}

/// "2.1.310 (Claude Code)" → "2.1.310".
pub fn parse_version(output: &str) -> Option<String> {
    let first = output.split_whitespace().next()?;
    let looks_like_version = first.chars().next().is_some_and(|c| c.is_ascii_digit())
        && first.contains('.')
        && first.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+');
    looks_like_version.then(|| first.to_string())
}

/// `claude auth status` (JSON): campo `loggedIn`.
pub fn parse_logged_in(output: &str) -> Option<bool> {
    serde_json::from_str::<Value>(output.trim()).ok()?.get("loggedIn")?.as_bool()
}

fn truncate(text: &str) -> String {
    let text = text.trim();
    if text.chars().count() <= MAX_ERROR_CHARS {
        return text.to_string();
    }
    format!("{}…", text.chars().take(MAX_ERROR_CHARS).collect::<String>().trim_end())
}

fn result_object(value: Value) -> Option<Value> {
    match value {
        Value::Object(_) if value.get("type").and_then(Value::as_str) == Some("result") => Some(value),
        Value::Array(items) => items.into_iter().rev().find_map(result_object),
        _ => None,
    }
}

/// Saída do `claude -p --output-format json`: o objeto `{"type":"result", ...}`, inteiro ou na última linha que o tenha.
fn find_result(stdout: &str) -> Option<Value> {
    if let Some(found) = serde_json::from_str::<Value>(stdout.trim()).ok().and_then(result_object) {
        return Some(found);
    }
    stdout
        .lines()
        .rev()
        .map(str::trim)
        .filter(|line| line.starts_with('{') || line.starts_with('['))
        .find_map(|line| serde_json::from_str::<Value>(line).ok().and_then(result_object))
}

/// Erro do `claude` (em inglês) para a tela: login e limite de uso em pt-BR; o resto com o texto original.
/// "No conversation found" continua no texto: a tela recomeça a sessão quando o lê (lib/assistant/reply.ts).
pub fn friendly_error(raw: &str) -> String {
    let text = truncate(raw);
    let lower = text.to_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| lower.contains(needle));
    if has(&["not logged in", "please run /login", "invalid api key", "oauth token has expired", "authentication_error"]) {
        return LOGIN_HINT.into();
    }
    if has(&["hit your limit", "usage limit reached", "spend limit reached"]) {
        return format!("O limite de uso do Claude Code foi atingido. Tente de novo quando ele renovar ({text}).");
    }
    format!("O Claude Code devolveu um erro: {text}")
}

pub fn parse_ask_output(stdout: &str, stderr: &str) -> Result<ClaudeCodeReply, String> {
    let Some(result) = find_result(stdout) else {
        let message = [stderr, stdout].into_iter().map(str::trim).find(|text| !text.is_empty());
        return Err(message.map(friendly_error).unwrap_or_else(|| "O Claude Code terminou sem resposta.".into()));
    };
    let text = result.get("result").and_then(Value::as_str).unwrap_or("").trim().to_string();
    let subtype = result.get("subtype").and_then(Value::as_str).unwrap_or("success");
    if result.get("is_error").and_then(Value::as_bool).unwrap_or(false) || subtype != "success" {
        return Err(if text.is_empty() { format!("O Claude Code devolveu um erro ({subtype}).") } else { friendly_error(&text) });
    }
    let session_id = result
        .get("session_id")
        .and_then(Value::as_str)
        .filter(|id| is_valid_session_id(id))
        .ok_or("O Claude Code respondeu sem uma sessão válida.")?;
    if text.is_empty() {
        return Err("O Claude Code respondeu sem texto.".into());
    }
    Ok(ClaudeCodeReply { text, session_id: session_id.to_string() })
}

fn version_key(name: &str) -> Vec<u64> {
    name.trim_start_matches('v').split('.').map(|part| part.parse().unwrap_or(0)).collect()
}

/// Onde procurar, em ordem: ~/.local/bin, ~/.claude/local, pastas do sistema e o node mais novo do nvm primeiro.
pub fn candidate_paths(home: &Path, system_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut paths = vec![home.join(".local/bin/claude"), home.join(".claude/local/claude")];
    paths.extend(system_dirs.iter().map(|dir| dir.join("claude")));
    if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
        let mut versions: Vec<String> = entries.flatten().map(|entry| entry.file_name().to_string_lossy().to_string()).collect();
        versions.sort_by(|a, b| version_key(b).cmp(&version_key(a)));
        paths.extend(versions.iter().map(|version| home.join(".nvm/versions/node").join(version).join("bin/claude")));
    }
    paths
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else { return false };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub fn find_claude(home: &Path, system_dirs: &[PathBuf], shell_lookup: impl FnOnce() -> Option<PathBuf>) -> Option<PathBuf> {
    candidate_paths(home, system_dirs).into_iter().find(|path| is_executable_file(path)).or_else(shell_lookup)
}

/// Última linha não vazia do `command -v claude`: só vale um caminho absoluto de arquivo executável (alias e função não).
pub fn parse_shell_lookup(output: &str) -> Option<PathBuf> {
    let line = output.lines().map(str::trim).filter(|line| !line.is_empty()).last()?;
    let path = PathBuf::from(line);
    (path.is_absolute() && is_executable_file(&path)).then_some(path)
}

/// Pergunta ao shell de login do usuário (carrega o .zprofile, onde costuma ficar o PATH). Texto fixo, nada do usuário.
pub fn login_shell_lookup() -> Option<PathBuf> {
    let shell = Path::new("/bin/zsh");
    if !is_executable_file(shell) {
        return None;
    }
    let args = vec!["-lc".to_string(), "command -v claude".to_string()];
    let output = run_with_timeout(shell, &args, None, &std::env::temp_dir(), SHELL_TIMEOUT).ok()?;
    if !output.success {
        return None;
    }
    parse_shell_lookup(&output.stdout)
}

/// PATH do processo filho: a pasta do binário (o `node` do nvm fica ao lado) e as pastas comuns, antes do PATH do app.
fn child_path(bin: &Path) -> std::ffi::OsString {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Some(parent) = bin.parent() {
        dirs.push(parent.to_path_buf());
    }
    dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].iter().map(PathBuf::from));
    if let Some(current) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&current));
    }
    let mut unique: Vec<PathBuf> = Vec::new();
    for dir in dirs {
        if !unique.contains(&dir) {
            unique.push(dir);
        }
    }
    std::env::join_paths(unique).unwrap_or_default()
}

fn read_all(mut source: impl std::io::Read + Send + 'static) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = source.read_to_end(&mut buffer);
        buffer
    })
}

/// Roda o binário direto (sem shell), com a entrada dada, e encerra o processo se passar do tempo.
pub fn run_with_timeout(
    bin: &Path,
    args: &[String],
    stdin_text: Option<&str>,
    cwd: &Path,
    timeout: Duration,
) -> Result<ProcessOutput, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    let mut child = Command::new(bin)
        .args(args)
        .current_dir(cwd)
        .env("PATH", child_path(bin))
        // Aberto de dentro de uma sessão do Claude Code (ex.: `tauri dev` no terminal dele), o filho acharia que é aninhado.
        .env_remove("CLAUDECODE")
        .stdin(if stdin_text.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Não foi possível iniciar {}: {error}", bin.display()))?;

    let writer = match (stdin_text, child.stdin.take()) {
        (Some(text), Some(mut stdin)) => {
            let text = text.to_owned();
            Some(std::thread::spawn(move || {
                let _ = stdin.write_all(text.as_bytes());
            }))
        }
        _ => None,
    };
    let stdout = child.stdout.take().map(read_all);
    let stderr = child.stderr.take().map(read_all);

    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("O Claude Code não respondeu em {} s.", timeout.as_secs().max(1)));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                let _ = child.kill();
                return Err(format!("Falha ao aguardar o Claude Code: {error}"));
            }
        }
    };
    if let Some(writer) = writer {
        let _ = writer.join();
    }
    let collect = |handle: Option<std::thread::JoinHandle<Vec<u8>>>| {
        handle.and_then(|handle| handle.join().ok()).map(|bytes| String::from_utf8_lossy(&bytes).into_owned()).unwrap_or_default()
    };
    Ok(ProcessOutput { success: status.success(), stdout: collect(stdout), stderr: collect(stderr) })
}

/// Uma pergunta ao Claude Code. `session_id` continua a conversa; sem ele, começa uma sessão nova.
pub fn ask(
    bin: &Path,
    flags: &CliFlags,
    cwd: &Path,
    prompt: &str,
    system_prompt: Option<&str>,
    session_id: Option<&str>,
    timeout: Duration,
) -> Result<ClaudeCodeReply, String> {
    if prompt.trim().is_empty() {
        return Err("Mensagem vazia: escreva algo antes de enviar.".into());
    }
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err("Mensagem grande demais para o Claude Code.".into());
    }
    let args = build_ask_args(flags, system_prompt, session_id)?;
    let output = run_with_timeout(bin, &args, Some(&as_plain_message(prompt)), cwd, timeout)?;
    parse_ask_output(&output.stdout, &output.stderr)
}

/// Com "/" no começo o `claude` trata a pergunta como comando ("/x isn't available in this environment") e ela não
/// chega ao modelo. O espaço de largura zero antes não aparece e não é removido por um trim.
fn as_plain_message(prompt: &str) -> String {
    if prompt.starts_with('/') {
        format!("\u{200B}{prompt}")
    } else {
        prompt.to_owned()
    }
}

/// Versão, opções aceitas e login do binário encontrado.
pub fn probe(bin: &Path, cwd: &Path) -> (ClaudeCodeStatus, Option<CliFlags>) {
    let mut status = ClaudeCodeStatus {
        available: false,
        path: Some(bin.to_string_lossy().into_owned()),
        version: None,
        logged_in: None,
        reason: None,
    };
    let run = |args: &[&str]| {
        let args: Vec<String> = args.iter().map(|arg| arg.to_string()).collect();
        run_with_timeout(bin, &args, None, cwd, PROBE_TIMEOUT)
    };
    match run(&["--version"]) {
        Ok(output) => status.version = parse_version(&output.stdout),
        Err(error) => {
            status.reason = Some(error);
            return (status, None);
        }
    }
    if status.version.is_none() {
        status.reason = Some("O arquivo encontrado não respondeu como o Claude Code.".into());
        return (status, None);
    }
    let flags = run(&["--help"]).map(|output| parse_cli_flags(&output.stdout)).unwrap_or_default();
    // Sem --tools não dá para tirar as ferramentas; sem --settings, para bloquear a leitura de arquivo por "@caminho".
    if !flags.tools || !flags.settings {
        status.reason = Some(TOO_OLD.into());
        return (status, None);
    }
    status.logged_in = run(&["auth", "status"]).ok().and_then(|output| parse_logged_in(&output.stdout));
    if status.logged_in == Some(false) {
        status.reason = Some(LOGIN_HINT.into());
        return (status, None);
    }
    status.available = true;
    (status, Some(flags))
}

fn unavailable(reason: &str) -> ClaudeCodeStatus {
    ClaudeCodeStatus { available: false, path: None, version: None, logged_in: None, reason: Some(reason.into()) }
}

struct Detected {
    bin: PathBuf,
    flags: CliFlags,
}

/// Último binário conferido (a pergunta não refaz a detecção a cada mensagem; o status sempre refaz).
static DETECTED: std::sync::Mutex<Option<Detected>> = std::sync::Mutex::new(None);

fn detect(home: &Path, cwd: &Path) -> (ClaudeCodeStatus, Option<Detected>) {
    let system_dirs: Vec<PathBuf> = SYSTEM_DIRS.iter().map(PathBuf::from).collect();
    let Some(bin) = find_claude(home, &system_dirs, login_shell_lookup) else {
        return (unavailable("O Claude Code não foi encontrado neste Mac."), None);
    };
    let (status, flags) = probe(&bin, cwd);
    (status, flags.map(|flags| Detected { bin, flags }))
}

/// Pasta vazia do app usada como cwd do `claude` (as sessões dele ficam associadas a ela, o que permite o --resume).
fn workspace(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|error| format!("Pasta pessoal não encontrada: {error}"))?;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Pasta de dados do app não encontrada: {error}"))?
        .join("claude-code");
    std::fs::create_dir_all(&dir).map_err(|error| format!("Não foi possível criar {}: {error}", dir.display()))?;
    Ok((home, dir))
}

fn remember(detected: Option<Detected>) -> Option<(PathBuf, CliFlags)> {
    let found = detected.as_ref().map(|item| (item.bin.clone(), item.flags));
    if let Ok(mut cache) = DETECTED.lock() {
        *cache = detected;
    }
    found
}

#[tauri::command]
pub async fn claude_code_status(app: tauri::AppHandle) -> Result<ClaudeCodeStatus, String> {
    let (home, dir) = workspace(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (status, detected) = detect(&home, &dir);
        remember(detected);
        status
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn claude_code_ask(
    app: tauri::AppHandle,
    prompt: String,
    session_id: Option<String>,
    system_prompt: Option<String>,
) -> Result<ClaudeCodeReply, String> {
    let (home, dir) = workspace(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cached = DETECTED.lock().ok().and_then(|cache| cache.as_ref().map(|item| (item.bin.clone(), item.flags)));
        let (bin, flags) = match cached {
            Some(found) => found,
            None => {
                let (status, detected) = detect(&home, &dir);
                remember(detected).ok_or_else(|| status.reason.unwrap_or_else(|| "Claude Code indisponível.".into()))?
            }
        };
        ask(&bin, &flags, &dir, &prompt, system_prompt.as_deref(), session_id.as_deref(), ASK_TIMEOUT)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::fs;

    const UUID: &str = "b211ae63-4cce-4686-9792-92c42f2c0621";

    fn all_flags() -> CliFlags {
        CliFlags { tools: true, settings: true, permission_prompts: true, safe_mode: true, strict_mcp_config: true, disable_slash_commands: true }
    }

    /// O mínimo que a pergunta exige: --tools (sem ferramentas) e --settings (sem ler arquivo por "@caminho").
    fn required_flags() -> CliFlags {
        CliFlags { tools: true, settings: true, ..CliFlags::default() }
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cm-claude-test-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[cfg(unix)]
    fn write_file(path: &Path, body: &str, mode: u32) {
        use std::os::unix::fs::PermissionsExt;
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    fn pair(args: &[String], flag: &str) -> Option<String> {
        args.iter().position(|arg| arg == flag).and_then(|index| args.get(index + 1).cloned())
    }

    #[test]
    fn le_as_opcoes_do_help() {
        let help = "  --tools <tools...>  Use \"\" to disable all tools\n  --permission-mode <mode>\n  --safe-mode   Start\n  --strict-mcp-config  Only\n  --disable-slash-commands  Disable\n  --permission-prompts <target>  Who\n  --setting-sources <sources>\n  --settings <file-or-json>  Path";
        assert_eq!(parse_cli_flags(help), all_flags());
        let old = "  --permission-mode <mode>\n  --tools <tools...>\n  --settings <file-or-json>\n";
        assert_eq!(parse_cli_flags(old), required_flags());
        assert_eq!(parse_cli_flags("  --toolsets <x>\n  --setting-sources <sources>"), CliFlags::default());
    }

    #[test]
    fn id_de_sessao_so_com_letras_numeros_e_hifen() {
        assert!(is_valid_session_id(UUID));
        assert!(is_valid_session_id("abc123"));
        for bad in ["", "--help", "-r", "a b", "abc;rm -rf ~", "../etc", "$(whoami)", "id\n", "é123", &"a".repeat(101)] {
            assert!(!is_valid_session_id(bad), "{bad:?} deveria ser recusado");
        }
    }

    #[test]
    fn argumentos_sem_shell_e_sem_ferramentas() {
        let args = build_ask_args(&all_flags(), Some("Você é o assistente da área Comercial."), None).unwrap();
        assert_eq!(args[0], "-p");
        assert_eq!(pair(&args, "--output-format").as_deref(), Some("json"));
        // `--tools ""` desliga todas as ferramentas; o resto nega o que sobrar (MCP, comandos, pedidos de permissão).
        assert_eq!(pair(&args, "--tools").as_deref(), Some(""));
        assert_eq!(pair(&args, "--permission-mode").as_deref(), Some("dontAsk"));
        assert_eq!(pair(&args, "--permission-prompts").as_deref(), Some("none"));
        for flag in ["--strict-mcp-config", "--safe-mode", "--disable-slash-commands"] {
            assert!(args.iter().any(|arg| arg == flag), "falta {flag}");
        }
        assert!(args.contains(&"--system-prompt=Você é o assistente da área Comercial.".to_string()));
        assert!(!args.iter().any(|arg| arg == "--resume"));
        // "@caminho" na pergunta faz o `claude` anexar o arquivo mesmo sem ferramentas: a negação do Read bloqueia.
        let settings: Value = serde_json::from_str(&pair(&args, "--settings").expect("falta --settings")).unwrap();
        assert_eq!(settings["permissions"]["deny"], serde_json::json!(["Read"]));
        // Nada de shell nem de liberar permissões.
        for forbidden in ["sh", "-c", "bash", "zsh", "--dangerously-skip-permissions", "--allowedTools", "--allowed-tools"] {
            assert!(!args.iter().any(|arg| arg == forbidden), "não pode ter {forbidden}");
        }
        assert!(!args.iter().any(|arg| arg.contains("bypassPermissions")));
    }

    #[test]
    fn opcoes_que_a_versao_nao_tem_ficam_de_fora() {
        let args = build_ask_args(&required_flags(), None, None).unwrap();
        assert_eq!(pair(&args, "--tools").as_deref(), Some(""));
        assert_eq!(pair(&args, "--permission-mode").as_deref(), Some("dontAsk"));
        assert_eq!(pair(&args, "--settings").as_deref(), Some(DENY_FILE_READS));
        for flag in ["--permission-prompts", "--safe-mode", "--strict-mcp-config", "--disable-slash-commands"] {
            assert!(!args.iter().any(|arg| arg == flag), "{flag} não existe nessa versão");
        }
        assert!(!args.iter().any(|arg| arg.starts_with("--system-prompt")));
        // Sem --tools não há como garantir "sem ferramentas" e sem --settings, "sem ler arquivo": recusa.
        assert!(build_ask_args(&CliFlags::default(), None, None).is_err());
        assert!(build_ask_args(&CliFlags { tools: true, ..CliFlags::default() }, None, None).is_err());
        assert!(build_ask_args(&CliFlags { settings: true, ..CliFlags::default() }, None, None).is_err());
    }

    #[test]
    fn resume_so_com_id_valido() {
        let args = build_ask_args(&all_flags(), None, Some(UUID)).unwrap();
        assert_eq!(pair(&args, "--resume").as_deref(), Some(UUID));
        for bad in ["--help", "abc; rm -rf ~", "", "a b"] {
            assert!(build_ask_args(&all_flags(), None, Some(bad)).is_err(), "{bad:?} deveria ser recusado");
        }
    }

    #[test]
    fn prompt_de_sistema_vazio_some_e_o_grande_demais_e_recusado() {
        let args = build_ask_args(&all_flags(), Some("   "), None).unwrap();
        assert!(!args.iter().any(|arg| arg.starts_with("--system-prompt")));
        assert!(build_ask_args(&all_flags(), Some(&"x".repeat(MAX_SYSTEM_PROMPT_CHARS + 1)), None).is_err());
        assert!(build_ask_args(&all_flags(), Some("a\0b"), None).is_err());
        // Começar com "-" não vira opção: vai junto do "=".
        let args = build_ask_args(&all_flags(), Some("--help"), None).unwrap();
        assert!(args.contains(&"--system-prompt=--help".to_string()));
    }

    #[test]
    fn versao_e_login() {
        assert_eq!(parse_version("2.1.310 (Claude Code)\n").as_deref(), Some("2.1.310"));
        assert_eq!(parse_version("  1.0.3\n").as_deref(), Some("1.0.3"));
        assert_eq!(parse_version("command not found"), None);
        assert_eq!(parse_version(""), None);
        assert_eq!(parse_logged_in("{\n  \"loggedIn\": true,\n  \"authMethod\": \"claude.ai\"\n}"), Some(true));
        assert_eq!(parse_logged_in("{\"loggedIn\": false}"), Some(false));
        assert_eq!(parse_logged_in("Logged in as x"), None);
    }

    #[test]
    fn le_a_resposta_json() {
        let ok = format!("{{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\" Olá! \",\"session_id\":\"{UUID}\"}}");
        assert_eq!(parse_ask_output(&ok, "").unwrap(), ClaudeCodeReply { text: "Olá!".into(), session_id: UUID.into() });
        // Linhas antes do JSON (avisos) não atrapalham.
        assert!(parse_ask_output(&format!("aviso qualquer\n{ok}\n"), "").is_ok());
        // Formato em lista (versões com --verbose).
        assert!(parse_ask_output(&format!("[{{\"type\":\"system\"}},{ok}]"), "").is_ok());

        let no_session = "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"oi\",\"session_id\":\"x; rm\"}";
        assert!(parse_ask_output(no_session, "").is_err());
        // A tela troca de sessão quando lê "No conversation found" (lib/assistant/reply.ts): o texto original continua.
        let missing = parse_ask_output("", "No conversation found with session ID: 0000\n").unwrap_err();
        assert!(missing.starts_with("O Claude Code devolveu um erro: "), "{missing}");
        assert!(missing.contains("No conversation found with session ID: 0000"), "{missing}");
        assert!(parse_ask_output("", "").unwrap_err().contains("sem resposta"));
        assert!(parse_ask_output("", &"e".repeat(5000)).unwrap_err().chars().count() <= MAX_ERROR_CHARS + 50);
    }

    fn error_result(text: &str) -> String {
        serde_json::json!({ "type": "result", "subtype": "success", "is_error": true, "result": text, "session_id": UUID }).to_string()
    }

    #[test]
    fn erros_do_claude_em_portugues() {
        for text in ["Not logged in · Please run /login", "Invalid API key · Please run /login", "OAuth token has expired. Please obtain a new token or refresh your existing token."] {
            let error = parse_ask_output(&error_result(text), "").unwrap_err();
            assert!(error.contains("sem login") && error.contains("Terminal"), "{text:?} -> {error}");
        }
        for text in ["You've hit your limit · resets 5pm (America/Sao_Paulo)", "Claude AI usage limit reached|1761400000"] {
            let error = parse_ask_output(&error_result(text), "").unwrap_err();
            assert!(error.starts_with("O limite de uso do Claude Code foi atingido"), "{text:?} -> {error}");
            assert!(error.contains(text), "o detalhe (quando volta) fica na mensagem: {error}");
        }
        // Limite de contexto não é limite de uso; o resto vai com o texto original, apresentado em pt-BR.
        let context = parse_ask_output(&error_result("Context limit reached · /compact or /clear to continue"), "").unwrap_err();
        assert_eq!(context, "O Claude Code devolveu um erro: Context limit reached · /compact or /clear to continue");
        assert_eq!(
            parse_ask_output("", "error: unknown option '--xyz'\n").unwrap_err(),
            "O Claude Code devolveu um erro: error: unknown option '--xyz'"
        );
    }

    #[cfg(unix)]
    #[test]
    fn procura_nas_pastas_conhecidas_na_ordem() {
        let home = scratch("home");
        let system = scratch("system");
        let homebrew = system.join("opt/homebrew/bin");
        let usr_local = system.join("usr/local/bin");
        let dirs = vec![homebrew.clone(), usr_local.clone()];
        let shell_called = Cell::new(false);
        let shell = || {
            shell_called.set(true);
            None
        };
        assert_eq!(find_claude(&home, &dirs, shell), None);
        assert!(shell_called.get(), "sem nada nas pastas, pergunta ao shell de login");

        write_file(&usr_local.join("claude"), "#!/bin/sh\n", 0o755);
        assert_eq!(find_claude(&home, &dirs, || None), Some(usr_local.join("claude")));
        write_file(&homebrew.join("claude"), "#!/bin/sh\n", 0o755);
        assert_eq!(find_claude(&home, &dirs, || None), Some(homebrew.join("claude")));
        write_file(&home.join(".claude/local/claude"), "#!/bin/sh\n", 0o755);
        assert_eq!(find_claude(&home, &dirs, || None), Some(home.join(".claude/local/claude")));
        // Arquivo sem permissão de execução não conta.
        write_file(&home.join(".local/bin/claude"), "#!/bin/sh\n", 0o644);
        assert_eq!(find_claude(&home, &dirs, || None), Some(home.join(".claude/local/claude")));
        write_file(&home.join(".local/bin/claude"), "#!/bin/sh\n", 0o755);
        let shell_called = Cell::new(false);
        let found = find_claude(&home, &dirs, || {
            shell_called.set(true);
            None
        });
        assert_eq!(found, Some(home.join(".local/bin/claude")));
        assert!(!shell_called.get(), "achou nas pastas: não abre o shell");
        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&system).ok();
    }

    #[cfg(unix)]
    #[test]
    fn nvm_usa_a_versao_mais_nova_do_node() {
        let home = scratch("nvm");
        for version in ["v9.0.0", "v24.21.0", "v18.2.1"] {
            write_file(&home.join(format!(".nvm/versions/node/{version}/bin/claude")), "#!/bin/sh\n", 0o755);
        }
        fs::create_dir_all(home.join(".nvm/versions/node/v30.0.0/bin")).unwrap(); // node sem claude
        let candidates = candidate_paths(&home, &[]);
        let nvm: Vec<_> = candidates.iter().filter(|path| path.to_string_lossy().contains(".nvm")).collect();
        assert_eq!(nvm.first().map(|path| path.to_string_lossy().contains("v30.0.0")), Some(true));
        assert_eq!(find_claude(&home, &[], || None), Some(home.join(".nvm/versions/node/v24.21.0/bin/claude")));
        fs::remove_dir_all(&home).ok();
    }

    #[cfg(unix)]
    #[test]
    fn resposta_do_shell_de_login_so_vale_caminho_absoluto_executavel() {
        let dir = scratch("shell");
        let bin = dir.join("claude");
        write_file(&bin, "#!/bin/sh\n", 0o755);
        let text = bin.to_string_lossy().to_string();
        assert_eq!(parse_shell_lookup(&format!("{text}\n")), Some(bin.clone()));
        assert_eq!(parse_shell_lookup(&format!("Bem-vindo!\n{text}\n")), Some(bin.clone()));
        assert_eq!(parse_shell_lookup("claude: aliased to npx claude"), None);
        assert_eq!(parse_shell_lookup("bin/claude"), None);
        assert_eq!(parse_shell_lookup(""), None);
        assert_eq!(parse_shell_lookup(&dir.join("nao-existe").to_string_lossy()), None);
        fs::remove_dir_all(&dir).ok();
    }

    /// Claude falso: grava argumentos, entrada, pasta e ambiente, e responde como o `-p --output-format json`.
    #[cfg(unix)]
    fn fake_claude(dir: &Path) -> PathBuf {
        let bin = dir.join("bin/claude");
        write_file(
            &bin,
            r#"#!/bin/sh
out="$(dirname "$0")/.."
: > "$out/args.txt"
for arg in "$@"; do printf '%s\n' "$arg" >> "$out/args.txt"; done
cat > "$out/stdin.txt"
pwd -P > "$out/cwd.txt"
printf '%s\n' "$PATH" > "$out/path.txt"
printf '%s\n' "${CLAUDECODE:-ausente}" > "$out/claudecode.txt"
printf '{"type":"result","subtype":"success","is_error":false,"result":"resposta falsa","session_id":"11111111-2222-3333-4444-555555555555"}\n'
"#,
            0o755,
        );
        bin
    }

    #[cfg(unix)]
    #[test]
    fn pergunta_vai_pela_entrada_padrao_e_nao_pelos_argumentos() {
        let dir = scratch("ask");
        let bin = fake_claude(&dir);
        let workspace = dir.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        let prompt = "-h; rm -rf ~ $(whoami) `id`\nsegunda linha";
        let reply = ask(&bin, &all_flags(), &workspace, prompt, Some("Sistema"), Some(UUID), Duration::from_secs(20)).unwrap();
        assert_eq!(reply, ClaudeCodeReply { text: "resposta falsa".into(), session_id: "11111111-2222-3333-4444-555555555555".into() });

        let args: Vec<String> = fs::read_to_string(dir.join("args.txt")).unwrap().lines().map(String::from).collect();
        assert_eq!(args, build_ask_args(&all_flags(), Some("Sistema"), Some(UUID)).unwrap());
        assert!(!args.iter().any(|arg| arg.contains("rm -rf")), "a pergunta não vira argumento");
        assert_eq!(fs::read_to_string(dir.join("stdin.txt")).unwrap(), prompt);
        assert_eq!(
            PathBuf::from(fs::read_to_string(dir.join("cwd.txt")).unwrap().trim()),
            workspace.canonicalize().unwrap()
        );
        let path = fs::read_to_string(dir.join("path.txt")).unwrap();
        assert!(path.starts_with(&bin.parent().unwrap().to_string_lossy().to_string()), "a pasta do binário vem primeiro no PATH (node do nvm)");
        assert!(path.contains("/usr/bin"));
        assert_eq!(fs::read_to_string(dir.join("claudecode.txt")).unwrap().trim(), "ausente");
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn pergunta_que_comeca_com_barra_vai_para_o_modelo_e_nao_vira_comando() {
        let dir = scratch("slash");
        let bin = fake_claude(&dir);
        ask(&bin, &all_flags(), &dir, "/relatório de vendas do mês", None, None, Duration::from_secs(20)).unwrap();
        let stdin = fs::read_to_string(dir.join("stdin.txt")).unwrap();
        assert!(!stdin.starts_with('/'), "com \"/\" no começo o claude responde \"isn't available in this environment\": {stdin:?}");
        assert_eq!(stdin.trim_start_matches('\u{200B}'), "/relatório de vendas do mês");
        fs::remove_dir_all(&dir).ok();
    }

    /// Claude falso para a detecção: `--version`, `--help` (texto dado) e `auth status`.
    #[cfg(unix)]
    fn fake_probe(dir: &Path, help: &str, logged_in: bool) -> PathBuf {
        let bin = dir.join(format!("probe-{}/claude", uuid::Uuid::new_v4()));
        write_file(
            &bin,
            r#"#!/bin/sh
here="$(dirname "$0")"
case "$1" in
  --version) echo "2.1.310 (Claude Code)" ;;
  --help) cat "$here/help.txt" ;;
  auth) printf '{"loggedIn": %s}\n' "$(cat "$here/logged.txt")" ;;
esac
"#,
            0o755,
        );
        fs::write(bin.with_file_name("help.txt"), help).unwrap();
        fs::write(bin.with_file_name("logged.txt"), if logged_in { "true" } else { "false" }).unwrap();
        bin
    }

    #[cfg(unix)]
    #[test]
    fn deteccao_exige_tools_e_settings_e_login() {
        let dir = scratch("probe");
        let full = "  --tools <tools...>\n  --settings <file-or-json>\n  --permission-mode <mode>\n  --permission-prompts <target>\n  --safe-mode\n  --strict-mcp-config\n  --disable-slash-commands\n";
        let (status, flags) = probe(&fake_probe(&dir, full, true), &dir);
        assert!(status.available, "{status:?}");
        assert_eq!((status.version.as_deref(), status.logged_in), (Some("2.1.310"), Some(true)));
        assert!(flags.is_some());

        // Sem --settings não há como negar a leitura de arquivo por "@caminho": versão antiga demais.
        let (status, flags) = probe(&fake_probe(&dir, "  --tools <tools...>\n  --permission-mode <mode>\n", true), &dir);
        assert!(!status.available, "{status:?}");
        assert!(status.reason.unwrap_or_default().contains("antiga demais"));
        assert!(flags.is_none());

        let (status, flags) = probe(&fake_probe(&dir, full, false), &dir);
        assert!(!status.available);
        assert!(status.reason.unwrap_or_default().contains("sem login"));
        assert!(flags.is_none());
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn pergunta_vazia_ou_grande_demais_nem_roda() {
        let dir = scratch("empty");
        let bin = fake_claude(&dir);
        assert!(ask(&bin, &all_flags(), &dir, "   \n", None, None, Duration::from_secs(5)).is_err());
        assert!(ask(&bin, &all_flags(), &dir, &"x".repeat(MAX_PROMPT_BYTES + 1), None, None, Duration::from_secs(5)).is_err());
        assert!(!dir.join("args.txt").exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn processo_que_passa_do_tempo_e_encerrado() {
        let dir = scratch("timeout");
        let bin = dir.join("slow");
        write_file(&bin, "#!/bin/sh\nsleep 30\n", 0o755);
        let started = std::time::Instant::now();
        let error = run_with_timeout(&bin, &[], None, &dir, Duration::from_millis(300)).unwrap_err();
        assert!(error.contains("não respondeu"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(10));
        fs::remove_dir_all(&dir).ok();
    }

    #[cfg(unix)]
    #[test]
    fn erro_do_processo_vira_mensagem() {
        let dir = scratch("fail");
        let bin = dir.join("claude");
        write_file(&bin, "#!/bin/sh\necho 'No conversation found with session ID: abc' >&2\nexit 1\n", 0o755);
        let error = ask(&bin, &all_flags(), &dir, "oi", None, Some("abc"), Duration::from_secs(10)).unwrap_err();
        assert_eq!(error, "O Claude Code devolveu um erro: No conversation found with session ID: abc");
        fs::remove_dir_all(&dir).ok();
    }

    /// Roda o Claude Code de verdade (precisa estar instalado e logado):
    /// `cargo test --lib claude_code::tests::claude_code_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn claude_code_real_responde_e_continua_a_conversa() {
        let home = PathBuf::from(std::env::var("HOME").unwrap());
        let dirs: Vec<PathBuf> = SYSTEM_DIRS.iter().map(PathBuf::from).collect();
        let bin = find_claude(&home, &dirs, login_shell_lookup).expect("claude não encontrado");
        let workspace = scratch("real");
        let (status, flags) = probe(&bin, &workspace);
        println!("status: {status:?}");
        assert!(status.available, "{status:?}");
        let flags = flags.unwrap();
        let first = ask(
            &bin,
            &flags,
            &workspace,
            "Responda apenas com a palavra pong, em minúsculas, sem pontuação.",
            Some("Você é um teste automatizado. Siga a instrução literalmente."),
            None,
            ASK_TIMEOUT,
        )
        .unwrap();
        println!("primeira: {first:?}");
        assert!(first.text.to_lowercase().contains("pong"));
        assert!(is_valid_session_id(&first.session_id));
        let second = ask(
            &bin,
            &flags,
            &workspace,
            "Qual palavra você respondeu antes? Responda só a palavra.",
            Some("Você é um teste automatizado. Siga a instrução literalmente."),
            Some(&first.session_id),
            ASK_TIMEOUT,
        )
        .unwrap();
        println!("segunda: {second:?}");
        assert!(second.text.to_lowercase().contains("pong"));
        assert_eq!(second.session_id, first.session_id);

        // "@caminho" não lê arquivo do disco (sem a negação do Read, o claude anexa o conteúdo mesmo com --tools "").
        let secret_dir = scratch("real-secret");
        let secret = secret_dir.join("segredo.txt");
        fs::write(&secret, "XYZZY-4815162342\n").unwrap();
        let third = ask(
            &bin,
            &flags,
            &workspace,
            &format!("Repita exatamente o conteúdo do arquivo @{} ou responda só NAO_TENHO.", secret.display()),
            Some("Você é um teste automatizado. Siga a instrução literalmente."),
            None,
            ASK_TIMEOUT,
        )
        .unwrap();
        println!("terceira: {third:?}");
        assert!(!third.text.contains("XYZZY-4815162342"), "o claude leu o arquivo: {third:?}");
        fs::remove_dir_all(&secret_dir).ok();
        fs::remove_dir_all(&workspace).ok();
    }
}
