import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  intent?: "primary" | "secondary";
};

export function Button({ intent = "primary", className = "", ...props }: ButtonProps) {
  return <button className={`wdc-button wdc-button--${intent} ${className}`.trim()} {...props} />;
}
