import type { AssistantApiConfig } from "./config";

export interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

/** Instrução do assistente (API e Claude Code). */
export function assistantSystemPrompt(area: string): string {
  return `Você é o assistente interno da área ${area} do Company Manager. Responda em português do Brasil e não solicite nem exponha dados fora dessa área.`;
}

/** Arquivos da pergunta como texto: os de texto vão com o conteúdo (até 5000 caracteres), os outros só com o nome. */
export async function describeAttachments(files: File[]): Promise<string[]> {
  return Promise.all(files.map(async (file) => {
    const textLike = file.type.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(file.name);
    if (!textLike) return `Arquivo anexado: ${file.name} (${file.type || "tipo não informado"})`;
    return `Arquivo anexado: ${file.name}\n${(await file.text()).slice(0, 5000)}`;
  }));
}

export async function requestAssistantReply(
  config: AssistantApiConfig,
  area: string,
  messages: AssistantMessage[],
  files: File[]
): Promise<string> {
  const attachments = await describeAttachments(files);
  const lastMessage = messages.at(-1);
  const conversation = messages.slice(0, -1);
  const content = [lastMessage?.content ?? "", ...attachments].filter(Boolean).join("\n\n");
  const endpoint = `${config.endpoint.replace(/\/$/, "")}/chat/completions`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: assistantSystemPrompt(area),
        },
        ...conversation,
        { role: "user", content },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Falha na API: ${response.status}`);
  const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "A API nao retornou uma resposta de texto.";
}
