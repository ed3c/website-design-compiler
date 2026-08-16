import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { Button } from "./button";

const meta = {
  title: "Governed UI/Button",
  component: Button,
  parameters: { layout: "centered", a11y: { test: "error" } },
  tags: ["autodocs", "test"]
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: { children: "Primary action" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Primary action" });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await expect(button).toBeEnabled();
  }
};

export const Secondary: Story = {
  args: { children: "Secondary action", intent: "secondary" }
};

export const Disabled: Story = {
  args: { children: "Unavailable action", disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Unavailable action" })).toBeDisabled();
  }
};
