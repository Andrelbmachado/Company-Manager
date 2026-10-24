import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/types";
import { ChangePasswordForm } from "./ChangePasswordForm";

const { changePassword, emit } = vi.hoisted(() => ({ changePassword: vi.fn(), emit: vi.fn() }));
vi.mock("@/lib/auth/password", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/auth/password")>()), changePassword }));
vi.mock("@/lib/events/bus", () => ({ emit }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = {
  user: { id: "u1", name: "Fernanda Lima", email: "financeiro@empresa.local", status: "active", locale: "pt-BR", created_at: "", updated_at: "", must_change_password: 1 },
  membership: { id: "m1", company_id: "c1", user_id: "u1", role: "financeiro", scope: "setor", created_at: "", updated_at: "" },
  company: { id: "c1", name: "Empresa", settings_json: "{}", created_at: "", updated_at: "" },
} as Session;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  changePassword.mockReset().mockResolvedValue(undefined);
  emit.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

async function render(props: Partial<Parameters<typeof ChangePasswordForm>[0]> = {}) {
  const onDone = vi.fn();
  await act(async () => {
    root.render(<ChangePasswordForm session={session} requireCurrent={false} onDone={onDone} {...props} />);
  });
  return onDone;
}

function field(label: string): HTMLInputElement {
  const element = [...container.querySelectorAll("label")].find((item) => item.textContent === label);
  const input = element && document.getElementById(element.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error(`campo ${label} não encontrado`);
  return input;
}

async function type(label: string, value: string) {
  const input = field(label);
  // React escuta o setter nativo + evento "input".
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  const button = container.querySelector<HTMLButtonElement>("button[type=submit]")!;
  await act(async () => {
    button.click();
  });
}

const alertText = () => container.querySelector("[role=alert]")?.textContent ?? "";

describe("ChangePasswordForm", () => {
  it("troca obrigatória: confere a confirmação antes de gravar", async () => {
    const onDone = await render();
    expect(container.textContent).not.toContain("Senha atual");
    await type("Nova senha", "senha-nova-1");
    await type("Confirmar nova senha", "senha-nova-2");
    await submit();
    expect(alertText()).toBe("A confirmação não é igual à nova senha.");
    expect(changePassword).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("recusa senha curta com a mensagem do mínimo", async () => {
    await render();
    await type("Nova senha", "123");
    await type("Confirmar nova senha", "123");
    await submit();
    expect(alertText()).toContain("pelo menos 6 caracteres");
    expect(changePassword).not.toHaveBeenCalled();
  });

  it("grava a senha nova, registra a atividade e avisa quem chamou", async () => {
    const onDone = await render();
    await type("Nova senha", "senha-nova-1");
    await type("Confirmar nova senha", "senha-nova-1");
    await submit();
    expect(changePassword).toHaveBeenCalledWith("u1", "senha-nova-1", {});
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: "user.password_changed", entityId: "u1" }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(alertText()).toBe("");
  });

  it("em Configurações pede a senha atual e mostra o erro de quem confere", async () => {
    changePassword.mockRejectedValueOnce(new Error("A senha atual não confere."));
    const onDone = await render({ requireCurrent: true });
    await type("Senha atual", "errada");
    await type("Nova senha", "senha-nova-1");
    await type("Confirmar nova senha", "senha-nova-1");
    await submit();
    expect(changePassword).toHaveBeenCalledWith("u1", "senha-nova-1", { currentPassword: "errada" });
    expect(alertText()).toBe("A senha atual não confere.");
    expect(onDone).not.toHaveBeenCalled();
  });
});
