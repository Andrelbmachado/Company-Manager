-- Pacotes Básico / Essencial / Premium com preços por segmento da Proposta Comercial e programa de indicação.

-- Escopo base do gerenciador por segmento (Essencial e Premium).
ALTER TABLE package_prices ADD COLUMN feature_note TEXT;

-- Segmento de preço do lead (a Proposta separa "Pet shop / banho e tosa / hotel" de "Pet/Veterinária").
ALTER TABLE leads ADD COLUMN pricing_segment TEXT;

-- Programa de indicação: quem indicou e o status do benefício.
-- referral_status: NULL = não é indicação; 'pendente' até o indicado fechar (assinar e pagar); 'concedido' depois do fechamento.
-- Benefícios (só no fechamento): 1 mês grátis de mensalidade para quem indicou; 10% de desconto no setup para o indicado.
ALTER TABLE leads ADD COLUMN referred_by TEXT;
ALTER TABLE leads ADD COLUMN referral_status TEXT;
