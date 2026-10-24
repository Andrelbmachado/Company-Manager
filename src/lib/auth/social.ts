// Login social (GitHub, Google, Microsoft). O botão existe na tela; o fluxo OAuth completo ainda NÃO está implantado:
// ele exige registrar o aplicativo em cada provedor (Client ID) e um servidor para trocar o código por token e
// ligar a conta ao e-mail cadastrado. Enquanto isso, cada botão explica o que falta em vez de fingir que entrou.

export type SocialProvider = "github" | "google" | "microsoft";

export const SOCIAL_PROVIDERS: { id: SocialProvider; label: string }[] = [
  { id: "google", label: "Google" },
  { id: "microsoft", label: "Microsoft" },
  { id: "github", label: "GitHub" },
];

const CLIENT_ID_VARS: Record<SocialProvider, string> = {
  github: "VITE_GITHUB_CLIENT_ID",
  google: "VITE_GOOGLE_CLIENT_ID",
  microsoft: "VITE_MICROSOFT_CLIENT_ID",
};

export function startSocialLogin(provider: SocialProvider): never {
  const label = SOCIAL_PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
  const configured = Boolean((import.meta.env as Record<string, string | undefined>)[CLIENT_ID_VARS[provider]]);
  throw new Error(
    configured
      ? `O aplicativo ${label} está registrado, mas falta o servidor que conclui o login e liga a conta ao seu e-mail. Entre com e-mail e senha por enquanto.`
      : `Login com ${label} ainda não está disponível: falta registrar o aplicativo no ${label} e informar o Client ID (${CLIENT_ID_VARS[provider]}). Entre com e-mail e senha por enquanto.`,
  );
}
