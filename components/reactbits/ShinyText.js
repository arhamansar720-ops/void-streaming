// Adapted from React Bits (https://reactbits.dev) ShinyText — MIT + Commons Clause.
// Classic CSS variant: a highlight band sweeps across clipped text. Styles live in globals.css (.shinyText).
export default function ShinyText({ text, children, disabled = false, speed = 3, className = "" }) {
  return (
    <span className={`shinyText ${disabled ? "disabled" : ""} ${className}`} style={{ animationDuration: `${speed}s` }}>
      {children ?? text}
    </span>
  );
}
