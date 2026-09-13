import type { Preview } from "../hooks/use-documents";
import { Dialog } from "./dialog";

export default function DocumentPreview({ preview, onClose, onOpen, onSave }: {
  preview: Preview; onClose: () => void; onOpen: () => void; onSave: () => void;
}) {
  return (
    <Dialog wide title={preview.doc.filename ?? "Document"} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onOpen}>Open in viewer</button>
        <button className="btn" onClick={onSave}>Save</button>
      </>
    }>
      <div className="preview-box">
        <iframe className="preview" src={preview.url} title={preview.doc.filename ?? "document"} />
      </div>
    </Dialog>
  );
}
