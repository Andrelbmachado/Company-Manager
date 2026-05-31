import type { AssistantApiConfig } from "./config";

interface AssistantMessage {
  role: "user" | "assistant";
  content: string;
}

export async function requestAssistantReply(
  config: AssistantApiConfig,
  area: string,
  messages: AssistantMessage[],
  files: File[]
): Promise<string> {
  const attachments = await Promise.all(files.map(async (file) => {
    const textLike = file.type.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(file.name);
    if (!textLike) return `Arquivo anexado: ${file.name} (${file.type || "tipo nao informado"})`;
    return `Arquivo anexado: ${file.name}\n${(await file.text()).slice(0, 5000)}`;
  }));
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
          content: `Voce e o assistente interno da area ${area}. Responda em portugues do Brasil e nao solicite nem exponha dados fora dessa area.`,
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
