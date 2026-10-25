/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    // Testes não geram classes; fixtures como o fuso do OFX ("[-3:BRT]") virariam CSS inválido no build.
    "!./src/**/*.test.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ['"Public Sans Variable"', "ui-sans-serif", "system-ui", "sans-serif"],
        display: ['"Bricolage Grotesque Variable"', '"Public Sans Variable"', "ui-sans-serif", "sans-serif"],
      },
      // Tipografia do macOS (tokens em globals.css): text-sm = corpo 13/16 e text-xs = legenda 11/14, então as telas
      // existentes já seguem o padrão; text-base e text-lg viram title 3 e title 2 (títulos de seção e de painel).
      fontSize: {
        xs: ["var(--text-caption)", { lineHeight: "var(--leading-caption)" }],
        sm: ["var(--text-body)", { lineHeight: "var(--leading-body)" }],
        base: ["var(--text-title3)", { lineHeight: "var(--leading-title3)" }],
        lg: ["var(--text-title2)", { lineHeight: "var(--leading-title2)" }],
        caption: ["var(--text-caption)", { lineHeight: "var(--leading-caption)" }],
        callout: ["var(--text-callout)", { lineHeight: "var(--leading-callout)" }],
        body: ["var(--text-body)", { lineHeight: "var(--leading-body)" }],
        headline: ["var(--text-body)", { lineHeight: "var(--leading-body)", fontWeight: "600" }],
        title3: ["var(--text-title3)", { lineHeight: "var(--leading-title3)" }],
        title2: ["var(--text-title2)", { lineHeight: "var(--leading-title2)" }],
        title1: ["var(--text-title1)", { lineHeight: "var(--leading-title1)" }],
        "large-title": ["var(--text-large-title)", { lineHeight: "var(--leading-large-title)" }],
      },
      colors: {
        // Tags de status: fundo sólido e texto com contraste >= 4,5 (amarelo usa texto escuro). São a única cor do
        // tema monocromático (estado); neutral é cinza puro, como o resto da interface.
        status: {
          danger: "#D92D20",
          success: "#15803D",
          warning: "#FACC15",
          "warning-ink": "#1F1700",
          info: "#2B59E0",
          violet: "#6D3FD6",
          orange: "#C2410C",
          neutral: "#525252",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          text: "hsl(var(--primary-text))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
