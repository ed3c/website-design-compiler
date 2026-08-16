import type { Config, Slot } from "@puckeditor/core";
import { Button } from "@/components/ui/button";
import { StatusPanel } from "@/components/ui/status-panel";

type StudioProps = {
  ButtonBlock: {
    label: string;
    intent: "primary" | "secondary";
  };
  StatusPanelBlock: {
    state: "loading" | "empty" | "error" | "success";
    title: string;
    message: string;
  };
  Section: {
    surfaceToken: "surface-default" | "surface-muted";
    content: Slot;
  };
};

export const studioConfig: Config<StudioProps> = {
  root: {
    fields: {
      pageTitle: { type: "text", label: "Page title" },
      surfaceToken: {
        type: "select",
        label: "Surface token",
        options: [
          { label: "Default", value: "surface-default" },
          { label: "Muted", value: "surface-muted" }
        ]
      }
    },
    defaultProps: {
      pageTitle: "Governed authoring page",
      surfaceToken: "surface-default"
    },
    render: ({ children, pageTitle, surfaceToken }) => (
      <main data-authoring-root="true" data-surface-token={surfaceToken} aria-label={pageTitle}>
        {children}
      </main>
    )
  },
  components: {
    ButtonBlock: {
      label: "Button",
      defaultProps: { label: "Continue", intent: "primary" },
      fields: {
        label: { type: "text", label: "Label" },
        intent: {
          type: "select",
          label: "Intent",
          options: [
            { label: "Primary", value: "primary" },
            { label: "Secondary", value: "secondary" }
          ]
        }
      },
      render: ({ label, intent }) => <Button intent={intent}>{label}</Button>
    },
    StatusPanelBlock: {
      label: "Status panel",
      defaultProps: {
        state: "success",
        title: "Status",
        message: "Governed content is available."
      },
      fields: {
        state: {
          type: "select",
          label: "State",
          options: [
            { label: "Loading", value: "loading" },
            { label: "Empty", value: "empty" },
            { label: "Error", value: "error" },
            { label: "Success", value: "success" }
          ]
        },
        title: { type: "text", label: "Title" },
        message: { type: "textarea", label: "Message" }
      },
      render: ({ state, title, message }) => <StatusPanel state={state} title={title} message={message} />
    },
    Section: {
      label: "Section",
      defaultProps: { surfaceToken: "surface-default", content: [] },
      fields: {
        surfaceToken: {
          type: "select",
          label: "Surface token",
          options: [
            { label: "Default", value: "surface-default" },
            { label: "Muted", value: "surface-muted" }
          ]
        },
        content: {
          type: "slot",
          allow: ["ButtonBlock", "StatusPanelBlock"]
        }
      },
      render: ({ surfaceToken, content: Content }) => (
        <section data-authoring-section="true" data-surface-token={surfaceToken}>
          <Content allow={["ButtonBlock", "StatusPanelBlock"]} />
        </section>
      )
    }
  }
};
