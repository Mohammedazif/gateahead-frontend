import { useRef, useState, type FormEvent } from "react";
import { Dialog } from "../ui/Dialog";

export function GateNameDialog({ initialName, mode, onSave, onClose }: {
  initialName: string;
  mode: "save" | "rename";
  onSave: (name: string) => boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(() => initialName.slice(0, 80));
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const renaming = mode === "rename";
  const label = name.trim();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label) return;
    if (onSave(label)) onClose();
    else setNotice(renaming
      ? "Could not rename this gate on this device. Try again."
      : "Could not save this gate on this device. Try again.");
  }

  return <Dialog title={renaming ? "Rename gate" : "Save gate"} onClose={onClose} initialFocus={input} centered>
    <form className="gate-name-editor" onSubmit={submit}>
      <label className="gate-name">
        Gate name
        <input ref={input} value={name} maxLength={80} required onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => { setName(event.target.value); setNotice(""); }} />
      </label>
      <p className="quiet control-feedback" role="status" aria-atomic="true">{notice}</p>
      <div className="actions">
        <button type="button" className="ghost" onClick={onClose}>Cancel</button>
        <button type="submit" className="solid" disabled={!label}>{renaming ? "Save changes" : "Save gate"}</button>
      </div>
    </form>
  </Dialog>;
}
