type StatusPanelProps = {
  state: "loading" | "empty" | "error" | "success";
  title: string;
  message: string;
};

export function StatusPanel({ state, title, message }: StatusPanelProps) {
  const live = state === "error" ? "assertive" : "polite";
  return (
    <section className="wdc-status" data-state={state} aria-live={live}>
      <h2>{title}</h2>
      <p>{message}</p>
    </section>
  );
}
