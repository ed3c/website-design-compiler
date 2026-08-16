import type { Preview } from "@storybook/nextjs-vite";
import "../app/globals.css";

const preview: Preview = {
  parameters: {
    a11y: { test: "error" },
    backgrounds: {
      default: "production-dark",
      values: [{ name: "production-dark", value: "#0b0d10" }]
    },
    viewport: {
      viewports: {
        mobile: { name: "Mobile", styles: { width: "390px", height: "844px" } },
        tablet: { name: "Tablet", styles: { width: "834px", height: "1112px" } },
        desktop: { name: "Desktop", styles: { width: "1440px", height: "1000px" } }
      }
    }
  }
};

export default preview;
