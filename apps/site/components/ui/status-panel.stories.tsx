import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { StatusPanel } from "./status-panel";

const meta = {
  title: "Governed UI/StatusPanel",
  component: StatusPanel,
  parameters: { layout: "centered", a11y: { test: "error" } },
  tags: ["autodocs", "test"],
  args: {
    title: "Runtime state",
    message: "State evidence remains visible without motion or graphics."
  }
} satisfies Meta<typeof StatusPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = { args: { state: "loading", title: "Loading" } };
export const Empty: Story = { args: { state: "empty", title: "Empty" } };
export const Error: Story = { args: { state: "error", title: "Error", message: "The failure state is announced assertively." } };
export const Success: Story = { args: { state: "success", title: "Success" } };
