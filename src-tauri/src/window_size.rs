//! Tamanho mínimo da janela: 1/5 da largura e 1/3 da altura do monitor em que ela está (pedido do André), com um
//! piso para monitores muito pequenos. Calculado no setup e de novo quando a janela muda de monitor ou de escala.
//! O `tauri.conf.json` usa o piso como `minWidth`/`minHeight`, para a janela nunca nascer com um mínimo maior.

use std::sync::Mutex;
use tauri::{LogicalSize, Manager, Monitor, Runtime, Window, WindowEvent};

/// Piso da largura mínima (pontos lógicos): abaixo disso nem o trilho da sidebar e o conteúdo cabem.
pub const MIN_WIDTH_FLOOR: f64 = 240.0;
/// Piso da altura mínima (pontos lógicos).
pub const MIN_HEIGHT_FLOOR: f64 = 200.0;

/// Último mínimo aplicado (em pontos inteiros): `Moved` chega muitas vezes durante um arraste.
static LAST_APPLIED: Mutex<Option<(u32, u32)>> = Mutex::new(None);

/// Mínimo para um monitor de `width` × `height` pontos lógicos: 1/5 da largura e 1/3 da altura, arredondados para
/// baixo (a janela pode chegar exatamente a essa fração), nunca abaixo do piso.
pub fn min_size_for(width: f64, height: f64) -> (f64, f64) {
    let min_width = (width / 5.0).floor().max(MIN_WIDTH_FLOOR);
    let min_height = (height / 3.0).floor().max(MIN_HEIGHT_FLOOR);
    (min_width, min_height)
}

fn monitor_logical_size(monitor: &Monitor) -> (f64, f64) {
    let size = monitor.size().to_logical::<f64>(monitor.scale_factor());
    (size.width, size.height)
}

/// Aplica o mínimo do monitor atual (ou do principal, se o atual não for conhecido) à janela.
pub fn apply_min_size<R: Runtime>(window: &Window<R>) -> tauri::Result<()> {
    let monitor = match window.current_monitor()? {
        Some(monitor) => Some(monitor),
        None => window.primary_monitor()?,
    };
    let Some(monitor) = monitor else { return Ok(()) };
    let (width, height) = monitor_logical_size(&monitor);
    let (min_width, min_height) = min_size_for(width, height);
    let key = (min_width as u32, min_height as u32);
    let mut last = LAST_APPLIED.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if *last == Some(key) {
        return Ok(());
    }
    window.set_min_size(Some(LogicalSize::new(min_width, min_height)))?;
    *last = Some(key);
    Ok(())
}

/// Chamado no `setup` do Tauri: aplica o mínimo à janela principal.
pub fn apply_to_main_window<R: Runtime, M: Manager<R>>(manager: &M) {
    let Some(webview_window) = manager.get_webview_window("main") else { return };
    let window = webview_window.as_ref().window();
    if let Err(error) = apply_min_size(&window) {
        eprintln!("[janela] não foi possível definir o tamanho mínimo: {error}");
    }
}

/// Janela mudou de monitor (arrastada) ou de escala: recalcula o mínimo para o monitor novo.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if matches!(event, WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. }) {
        if let Err(error) = apply_min_size(window) {
            eprintln!("[janela] não foi possível atualizar o tamanho mínimo: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn um_quinto_da_largura_e_um_terco_da_altura() {
        // MacBook Air 13" (1470 × 956 pontos) e MacBook Pro 14" (1512 × 982).
        assert_eq!(min_size_for(1470.0, 956.0), (294.0, 318.0));
        assert_eq!(min_size_for(1512.0, 982.0), (302.0, 327.0));
        // Monitor externo 2560 × 1440.
        assert_eq!(min_size_for(2560.0, 1440.0), (512.0, 480.0));
    }

    #[test]
    fn arredonda_para_baixo_para_a_janela_chegar_a_fracao() {
        let (width, height) = min_size_for(1441.0, 901.0);
        assert!(width <= 1441.0 / 5.0 && width == width.floor());
        assert!(height <= 901.0 / 3.0 && height == height.floor());
    }

    #[test]
    fn monitor_muito_pequeno_usa_o_piso() {
        assert_eq!(min_size_for(800.0, 480.0), (MIN_WIDTH_FLOOR, MIN_HEIGHT_FLOOR));
        assert_eq!(min_size_for(0.0, 0.0), (MIN_WIDTH_FLOOR, MIN_HEIGHT_FLOOR));
    }

    #[test]
    fn o_piso_nao_impede_a_fracao_num_monitor_de_1280_por_800() {
        let (width, height) = min_size_for(1280.0, 800.0);
        assert_eq!((width, height), (256.0, 266.0));
    }
}
