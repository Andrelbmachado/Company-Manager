export interface AssistantApiConfig {
  provider: string;
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface AssistantProvider {
  id: string;
  label: string;
  endpoint: string;
  models: string[];
}

export const ASSISTANT_PROVIDERS: AssistantProvider[] = [
  {
    id: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
  },
  {
    id: "azure-openai",
    label: "Azure OpenAI",
    endpoint: "https://SEU-RECURSO.openai.azure.com/openai/v1",
    models: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini", "gpt-4o"],
  },
  {
    id: "openai-compatible",
    label: "API compativel com OpenAI",
    endpoint: "http://localhost:11434/v1",
    models: ["llama3.2", "qwen2.5", "mistral", "gemma3"],
  },
];

const DEFAULT_CONFIG: AssistantApiConfig = {
  provider: "openai",
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "",
};

function storageKey(userId: string): string {
  return `cm_assistant_api_${userId}`;
}

export function getAssistantApiConfig(userId: string): AssistantApiConfig {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    return raw ? { ...DEFAULT_CONFIG, ...JSON.parse(raw) } : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveAssistantApiConfig(userId: string, config: AssistantApiConfig): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(config));
}

export function hasAssistantApiConfig(userId: string): boolean {
  return Boolean(getAssistantApiConfig(userId).apiKey.trim());
}
