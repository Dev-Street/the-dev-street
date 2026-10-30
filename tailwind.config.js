import defaultTheme from "tailwindcss/defaultTheme";

const REM_SCALE = 1.6;

/**
 * Multiplies every rem value in a string by REM_SCALE
 * @param {string} value e.g. '0.75rem'
 * @returns {string} e.g. '1.2rem'
 */
const scaleRem = (value) =>
  value.replace(
    /(-?\d*\.?\d+)rem/g,
    (_, number) => `${+(number * REM_SCALE).toFixed(4)}rem`,
  );

/**
 * Recursively scales rem values in a theme scale (strings, arrays or objects)
 * @param {string|Array|Object} values
 */
const scaleValues = (values) => {
  if (typeof values === "string") return scaleRem(values);
  if (Array.isArray(values)) return values.map(scaleValues);

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, scaleValues(value)]),
  );
};

/** @type {import('tailwindcss').Config} */
export default {
  prefix: "tw-",
  content: [
    "./layout/*.liquid",
    "./sections/*.liquid",
    "./snippets/*.liquid",
    "./blocks/*.liquid",
    "./templates/**/*.liquid",
    "./assets/*.js",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    spacing: scaleValues(defaultTheme.spacing),
    fontSize: scaleValues(defaultTheme.fontSize),
    lineHeight: scaleValues(defaultTheme.lineHeight),
    borderRadius: scaleValues(defaultTheme.borderRadius),
    maxWidth: (utils) => scaleValues(defaultTheme.maxWidth(utils)),
    extend: {
      colors: {
        foreground: 'rgba(var(--color-foreground), <alpha-value>)',
        background: 'rgba(var(--color-background), <alpha-value>)',
        'input-border': 'rgba(var(--color-foreground), var(--inputs-border-opacity))',
      },
      borderWidth: {
        input: "var(--inputs-border-width)",
      },
      borderRadius: {
        input: "var(--inputs-radius)",
      },
      fontFamily: {
        body: "var(--font-body-family)",
      },
    },
  },
};
