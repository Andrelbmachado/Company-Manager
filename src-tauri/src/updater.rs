//! Atualização automática pelo GitHub Releases (tauri-plugin-updater).
//!
//! O front-end (src/lib/updater) chama `update_check` em silêncio (na abertura e a cada 24 h) e, só depois do clique
//! em "Atualizar", `update_install`. O plugin baixa o `.app.tar.gz` e confere a assinatura minisign com a `pubkey` do
//! tauri.conf.json (pacote corrompido ou de outra origem é recusado antes de tocar no app). No macOS a troca do bundle
//! é a do módulo `macos` abaixo (backup ao lado, rollback, o antigo só sai quando o novo abre); depois o app reinicia.
//! O banco e os anexos ficam em Application Support, fora do bundle, então não são tocados.
//!
//! Canal: o endpoint vem do tauri.conf.json (estável = release "latest", que nunca é pre-release). As builds do canal
//! de teste usam tauri.updatetest.conf.json, com outro identificador e outro endpoint.
//!
//! Variáveis de ambiente (testes de ponta a ponta, scripts/updater-e2e.sh):
//! - `CM_UPDATE_ENDPOINT`: troca o endpoint, só no app de teste (identificador `*.updatetest`, que também aceita
//!   http para o servidor local dos cenários de falha). A assinatura continua obrigatória.
//! - `CM_UPDATE_AUTOTEST`: caminho de um arquivo de relatório; o front-end clica sozinho em "Atualizar" e cada etapa
//!   é anotada no arquivo.

use std::io::Write;
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    /// Versão mais nova publicada no canal, ou `None` quando o app já está na última (ou numa mais nova).
    pub available_version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum InstallEvent {
    #[serde(rename_all = "camelCase")]
    Started { content_length: Option<u64> },
    #[serde(rename_all = "camelCase")]
    Progress { chunk_length: usize },
    Installing,
}

fn autotest_path() -> Option<String> {
    std::env::var("CM_UPDATE_AUTOTEST").ok().filter(|path| !path.is_empty())
}

/// Anota uma linha no relatório do teste de ponta a ponta (só quando `CM_UPDATE_AUTOTEST` está definido).
pub fn autotest_log(line: &str) {
    let Some(path) = autotest_path() else { return };
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder();
    let test_app = app.config().identifier.ends_with(".updatetest");
    if let Some(endpoint) = std::env::var("CM_UPDATE_ENDPOINT").ok().filter(|_| test_app) {
        let url = endpoint.parse().map_err(|error| format!("Endereço de atualização inválido: {error}"))?;
        builder = builder.endpoints(vec![url]).map_err(|error| error.to_string())?;
    }
    builder.build().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_autotest_enabled() -> bool {
    autotest_path().is_some()
}

#[tauri::command]
pub fn update_autotest_log(line: String) {
    autotest_log(&line);
}

/// Consulta o canal. Só guarda a atualização se a versão publicada for maior que a instalada (semver; o plugin
/// recusa versões iguais ou menores), então uma release antiga nunca é oferecida.
#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<UpdateCheck, String> {
    let current_version = app.package_info().version.to_string();
    let result = updater(&app)?.check().await;
    let update = match result {
        Ok(update) => update,
        // Endpoint sem release (404): o canal ainda não tem nenhuma versão publicada, então não há o que atualizar.
        Err(tauri_plugin_updater::Error::ReleaseNotFound) => {
            autotest_log("check_no_release");
            None
        }
        Err(error) => {
            autotest_log(&format!("check_error {error}"));
            return Err(error.to_string());
        }
    };
    let check = UpdateCheck {
        current_version: current_version.clone(),
        available_version: update.as_ref().map(|update| update.version.clone()),
        notes: update.as_ref().and_then(|update| update.body.clone()),
        date: update.as_ref().and_then(|update| update.date.map(|date| date.to_string())),
    };
    autotest_log(&format!(
        "check current={current_version} available={}",
        check.available_version.as_deref().unwrap_or("none")
    ));
    *pending.0.lock().map_err(|error| error.to_string())? = update;
    Ok(check)
}

/// Baixa, confere a assinatura e instala a atualização encontrada pelo último `update_check`, mandando o progresso
/// pelo `on_event`. Não reinicia: o front-end mostra "Concluído" e chama `restart_app`.
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    on_event: Channel<InstallEvent>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or_else(|| "Nenhuma atualização pendente. Verifique de novo.".to_string())?;
    let version = update.version.clone();
    autotest_log(&format!("install_start version={version} url={}", update.download_url));

    let mut started = false;
    let mut downloaded: u64 = 0;
    let progress = on_event.clone();
    // `download` só devolve os bytes depois de conferir a assinatura minisign com a pubkey do tauri.conf.json.
    let result = update
        .download(
            |chunk_length, content_length| {
                if !started {
                    started = true;
                    let _ = progress.send(InstallEvent::Started { content_length });
                }
                downloaded += chunk_length as u64;
                let _ = progress.send(InstallEvent::Progress { chunk_length });
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string())
        .and_then(|bytes| {
            autotest_log(&format!("download_verified bytes={}", bytes.len()));
            let _ = on_event.send(InstallEvent::Installing);
            install(&app, &update, &bytes)
        });

    match result {
        Ok(()) => {
            autotest_log(&format!("install_ok version={version} downloaded={downloaded}"));
            Ok(())
        }
        Err(error) => {
            autotest_log(&format!("install_error {error}"));
            // O `Update` foi consumido: "Tentar novamente" no front-end refaz a verificação antes de instalar.
            Err(error)
        }
    }
}

#[cfg(target_os = "macos")]
fn install(app: &AppHandle, update: &Update, bytes: &[u8]) -> Result<(), String> {
    use tauri::Manager;
    let exe = tauri::utils::platform::current_exe().map_err(|error| error.to_string())?;
    let bundle = macos::bundle_of(&exe)?;
    let data_dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    let options = macos::InstallOptions {
        expected_identifier: app.config().identifier.clone(),
        from_version: update.current_version.clone(),
        to_version: update.version.clone(),
        verify_codesign: true,
    };
    let backup = macos::install_bundle(&bundle, bytes, &options, |from, to| std::fs::rename(from, to))?;
    macos::write_pending(&data_dir, &backup, &options)?;
    autotest_log(&format!("swap_ok backup={}", backup.display()));
    Ok(())
}

/// Windows e Linux: instalação do próprio plugin (instalador NSIS/MSI, AppImage).
#[cfg(not(target_os = "macos"))]
fn install(_app: &AppHandle, update: &Update, bytes: &[u8]) -> Result<(), String> {
    update.install(bytes).map_err(|error| error.to_string())
}

/// Na abertura: se esta é a versão nova de uma atualização, apaga a cópia anterior guardada ao lado do app. Só aqui,
/// com a versão nova já rodando, a anterior deixa de ser necessária.
pub fn finish_pending_update(app: &tauri::App) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        let Ok(data_dir) = app.path().app_config_dir() else { return };
        let current = app.package_info().version.to_string();
        if let Some(line) = macos::finish_pending(&data_dir, &current) {
            autotest_log(&line);
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app;
}

/// Troca do `.app` no macOS. O plugin apaga o app antigo assim que move o novo; aqui o antigo fica guardado ao lado
/// (`.<nome>.app.previous-<versão>`) até a versão nova abrir, e volta para o lugar se a troca falhar no meio.
#[cfg(target_os = "macos")]
pub mod macos {
    use std::fs;
    use std::io;
    use std::path::{Path, PathBuf};
    use std::process::Command;

    pub struct InstallOptions {
        pub expected_identifier: String,
        pub from_version: String,
        pub to_version: String,
        pub verify_codesign: bool,
    }

    const PENDING_FILE: &str = "update-previous-app.txt";

    /// `.../Nome.app/Contents/MacOS/binário` → `.../Nome.app`.
    pub fn bundle_of(exe: &Path) -> Result<PathBuf, String> {
        exe.ancestors()
            .nth(3)
            .filter(|path| path.extension().is_some_and(|ext| ext == "app"))
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("O app não está num pacote .app ({})", exe.display()))
    }

    fn plist_value(app: &Path, key: &str) -> Result<String, String> {
        let output = Command::new("/usr/libexec/PlistBuddy")
            .arg("-c")
            .arg(format!("Print :{key}"))
            .arg(app.join("Contents/Info.plist"))
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err(format!("Info.plist sem {key}"));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    fn permission_hint(error: io::Error, dir: &Path) -> String {
        if error.kind() == io::ErrorKind::PermissionDenied {
            format!("Sem permissão para gravar em {}. Mova o app para Aplicativos ou instale a versão nova manualmente.", dir.display())
        } else {
            error.to_string()
        }
    }

    /// Extrai o pacote numa pasta temporária ao lado do app, confere identificador, versão e assinatura do código do
    /// app extraído e só então troca: atual → backup, novo → lugar do atual. Se a segunda etapa falhar, o atual volta.
    /// Devolve o caminho do backup (apagado por `finish_pending` quando a versão nova abrir).
    pub fn install_bundle(
        bundle: &Path,
        bytes: &[u8],
        options: &InstallOptions,
        rename: impl Fn(&Path, &Path) -> io::Result<()>,
    ) -> Result<PathBuf, String> {
        let parent = bundle.parent().ok_or("Pasta do app desconhecida")?;
        let name = bundle.file_name().ok_or("Nome do app desconhecido")?.to_string_lossy().to_string();
        let staging = parent.join(format!(".{name}.update-{}", options.to_version));
        let backup = parent.join(format!(".{name}.previous-{}", options.from_version));

        if staging.exists() {
            fs::remove_dir_all(&staging).map_err(|error| permission_hint(error, parent))?;
        }
        fs::create_dir(&staging).map_err(|error| permission_hint(error, parent))?;
        let result = (|| {
            let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(bytes));
            archive.set_preserve_permissions(true);
            // `unpack` recusa caminhos fora da pasta (../, absolutos).
            archive.unpack(&staging).map_err(|error| format!("Pacote inválido: {error}"))?;
            let new_app = fs::read_dir(&staging)
                .map_err(|error| error.to_string())?
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .find(|path| path.extension().is_some_and(|ext| ext == "app"))
                .ok_or("O pacote não tem um .app")?;

            let identifier = plist_value(&new_app, "CFBundleIdentifier")?;
            if identifier != options.expected_identifier {
                return Err(format!("O pacote é de outro app ({identifier}); esperado {}", options.expected_identifier));
            }
            let version = plist_value(&new_app, "CFBundleShortVersionString")?;
            if version != options.to_version {
                return Err(format!("O pacote traz a versão {version}, não a {}", options.to_version));
            }
            if options.verify_codesign {
                let status = Command::new("codesign").args(["--verify", "--deep"]).arg(&new_app).status().map_err(|error| error.to_string())?;
                if !status.success() {
                    return Err("A assinatura de código do app baixado não confere".into());
                }
            }

            if backup.exists() {
                fs::remove_dir_all(&backup).map_err(|error| permission_hint(error, parent))?;
            }
            rename(bundle, &backup).map_err(|error| permission_hint(error, parent))?;
            if let Err(error) = rename(&new_app, bundle) {
                // Rollback: a versão anterior volta para o lugar.
                return match rename(&backup, bundle) {
                    Ok(()) => Err(format!("Não foi possível instalar a versão nova ({error}); a versão anterior foi mantida.")),
                    Err(restore) => Err(format!(
                        "Não foi possível instalar a versão nova ({error}) nem devolver a anterior ({restore}); ela está em {}",
                        backup.display()
                    )),
                };
            }
            // Ícone e versão novos no Finder/LaunchServices.
            let _ = Command::new("touch").arg(bundle).status();
            Ok(backup.clone())
        })();
        let _ = fs::remove_dir_all(&staging);
        result
    }

    pub fn write_pending(data_dir: &Path, backup: &Path, options: &InstallOptions) -> Result<(), String> {
        fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
        let text = format!("{}\n{}\n{}\n", options.to_version, options.from_version, backup.display());
        fs::write(data_dir.join(PENDING_FILE), text).map_err(|error| error.to_string())
    }

    /// Apaga o backup se a versão rodando é a que foi instalada. Devolve uma linha para o relatório do teste.
    pub fn finish_pending(data_dir: &Path, current_version: &str) -> Option<String> {
        let file = data_dir.join(PENDING_FILE);
        let text = fs::read_to_string(&file).ok()?;
        let mut lines = text.lines();
        let (to, from, backup) = (lines.next()?, lines.next()?, PathBuf::from(lines.next()?));
        if current_version != to {
            return Some(format!("previous_kept running={current_version} expected={to} backup={}", backup.display()));
        }
        let removed = !backup.exists() || fs::remove_dir_all(&backup).is_ok();
        let _ = fs::remove_file(&file);
        Some(format!("previous_removed from={from} to={to} ok={removed}"))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::io::Write;

        fn fake_app(dir: &Path, name: &str, identifier: &str, version: &str) -> PathBuf {
            let app = dir.join(name);
            fs::create_dir_all(app.join("Contents/MacOS")).unwrap();
            fs::write(
                app.join("Contents/Info.plist"),
                format!(r#"<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>{identifier}</string><key>CFBundleShortVersionString</key><string>{version}</string></dict></plist>"#),
            )
            .unwrap();
            fs::write(app.join("Contents/MacOS/company-manager"), version).unwrap();
            app
        }

        fn package(identifier: &str, version: &str) -> Vec<u8> {
            let src = tempdir();
            fake_app(&src, "Teste.app", identifier, version);
            let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
            {
                let mut tar = tar::Builder::new(&mut gz);
                tar.append_dir_all("Teste.app", src.join("Teste.app")).unwrap();
                tar.finish().unwrap();
            }
            gz.flush().unwrap();
            gz.finish().unwrap()
        }

        fn tempdir() -> PathBuf {
            let dir = std::env::temp_dir().join(format!("cm-updater-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&dir).unwrap();
            dir
        }

        fn options(to: &str) -> InstallOptions {
            InstallOptions { expected_identifier: "com.test.app".into(), from_version: "1.0.0".into(), to_version: to.into(), verify_codesign: false }
        }

        fn binary(app: &Path) -> String {
            fs::read_to_string(app.join("Contents/MacOS/company-manager")).unwrap()
        }

        #[test]
        fn troca_o_app_guarda_o_anterior_e_apaga_depois_que_a_nova_abre() {
            let dir = tempdir();
            let app = fake_app(&dir, "Teste.app", "com.test.app", "1.0.0");
            let data = dir.join("data");
            fs::create_dir_all(&data).unwrap();
            fs::write(data.join("company-manager.db"), "dados").unwrap();

            let backup = install_bundle(&app, &package("com.test.app", "1.1.0"), &options("1.1.0"), |a, b| fs::rename(a, b)).unwrap();
            assert_eq!(binary(&app), "1.1.0");
            assert_eq!(binary(&backup), "1.0.0");
            write_pending(&data, &backup, &options("1.1.0")).unwrap();

            // Abriu ainda na versão antiga: o backup fica.
            assert!(finish_pending(&data, "1.0.0").unwrap().starts_with("previous_kept"));
            assert!(backup.exists());
            // Abriu na nova: o backup sai, os dados ficam.
            assert!(finish_pending(&data, "1.1.0").unwrap().starts_with("previous_removed"));
            assert!(!backup.exists());
            assert_eq!(fs::read_to_string(data.join("company-manager.db")).unwrap(), "dados");
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 2, "sobrou pasta temporária");
        }

        #[test]
        fn falha_ao_mover_o_novo_devolve_o_anterior() {
            let dir = tempdir();
            let app = fake_app(&dir, "Teste.app", "com.test.app", "1.0.0");
            let calls = std::cell::Cell::new(0);
            let error = install_bundle(&app, &package("com.test.app", "1.1.0"), &options("1.1.0"), |a, b| {
                calls.set(calls.get() + 1);
                if calls.get() == 2 { Err(io::Error::other("disco cheio")) } else { fs::rename(a, b) }
            })
            .unwrap_err();
            assert!(error.contains("versão anterior foi mantida"), "{error}");
            assert_eq!(binary(&app), "1.0.0");
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        }

        #[test]
        fn recusa_pacote_de_outro_app_ou_de_outra_versao_sem_tocar_no_atual() {
            let dir = tempdir();
            let app = fake_app(&dir, "Teste.app", "com.test.app", "1.0.0");
            let other = install_bundle(&app, &package("com.company.manager", "1.1.0"), &options("1.1.0"), |a, b| fs::rename(a, b)).unwrap_err();
            assert!(other.contains("outro app"), "{other}");
            let version = install_bundle(&app, &package("com.test.app", "0.9.0"), &options("1.1.0"), |a, b| fs::rename(a, b)).unwrap_err();
            assert!(version.contains("0.9.0"), "{version}");
            let corrupt = install_bundle(&app, b"isto nao e um tar.gz", &options("1.1.0"), |a, b| fs::rename(a, b)).unwrap_err();
            assert!(corrupt.contains("Pacote inválido"), "{corrupt}");
            assert_eq!(binary(&app), "1.0.0");
            assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        }
    }
}
