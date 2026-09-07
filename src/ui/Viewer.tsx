/** The document modal. Read it here rather than in a tab: the point of the
 *  table is that you never leave it. Port of `#viewer`. */
export interface ViewerProps {
  show: boolean;
  label: string;
  src: string;          // a blob: URL, revoked by the caller on close
  onSave: () => void;
  onClose: () => void;
}

export default function Viewer(p: ViewerProps) {
  return (
    <div className={"modal" + (p.show ? " show" : "")} role="dialog" aria-modal="true"
         aria-label="Notice PDF"
         onClick={(ev) => { if (ev.target === ev.currentTarget) p.onClose(); }}>
      <div className="sheet">
        <div className="head">
          <strong>Notice</strong>
          <span className="mut mono">{p.label}</span>
          <span className="grow" />
          <button className="ghost" onClick={p.onSave}>Save</button>
          <button className="ghost" onClick={p.onClose} autoFocus>Close</button>
        </div>
        {/* about:blank on close stops the PDF plugin running behind the page */}
        <iframe title="Notice PDF" src={p.show && p.src ? p.src : "about:blank"} />
      </div>
    </div>
  );
}
