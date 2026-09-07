/** One line, bottom centre, gone in 3.6s. Port of `#toast`. */
export default function Toast({ message }: { message: string }) {
  return <div id="toast" role="status" aria-live="polite" className={message ? "show" : ""}>{message}</div>;
}
