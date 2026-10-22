import { describe, it, expect } from "vitest";
import {
  totalPayablesOpen,
  totalReceivablesOpen,
  projectedBalance,
} from "./finance";
import type { Payable, Receivable } from "@/types";

function payable(amount: number, status: Payable["status"]): Payable {
  return {
    id: `p-${amount}-${status}`,
    company_id: "c1",
    description: "teste",
    amount,
    status,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

function receivable(amount: number, status: Receivable["status"]): Receivable {
  return {
    id: `r-${amount}-${status}`,
    company_id: "c1",
    amount,
    status,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
}

describe("totalPayablesOpen", () => {
  it("soma apenas contas com status 'aberta' ou 'aprovada'", () => {
    const list = [
      payable(100, "aberta"),
      payable(50, "aprovada"),
      payable(200, "paga"),
      payable(30, "cancelada"),
      payable(70, "vencida"),
    ];
    expect(totalPayablesOpen(list)).toBe(150);
  });

  it("retorna 0 para lista vazia", () => {
    expect(totalPayablesOpen([])).toBe(0);
  });

  it("retorna 0 quando nenhuma conta está em aberto", () => {
    expect(totalPayablesOpen([payable(100, "paga")])).toBe(0);
  });
});

describe("totalReceivablesOpen", () => {
  it("soma apenas contas com status 'aberta'", () => {
    const list = [
      receivable(100, "aberta"),
      receivable(50, "aberta"),
      receivable(200, "recebida"),
      receivable(30, "vencida"),
    ];
    expect(totalReceivablesOpen(list)).toBe(150);
  });

  it("não considera 'aprovada' como receber em aberto (diferente de pagar)", () => {
    expect(totalReceivablesOpen([receivable(100, "aprovada")])).toBe(0);
  });

  it("retorna 0 para lista vazia", () => {
    expect(totalReceivablesOpen([])).toBe(0);
  });
});

describe("projectedBalance", () => {
  it("saldo = receber em aberto - pagar em aberto", () => {
    const payables = [payable(100, "aberta"), payable(50, "aprovada")]; // 150
    const receivables = [receivable(400, "aberta")]; // 400
    expect(projectedBalance(payables, receivables)).toBe(250);
  });

  it("saldo negativo quando pagar supera receber", () => {
    const payables = [payable(500, "aberta")];
    const receivables = [receivable(100, "aberta")];
    expect(projectedBalance(payables, receivables)).toBe(-400);
  });

  it("saldo zero sem contas", () => {
    expect(projectedBalance([], [])).toBe(0);
  });
});
