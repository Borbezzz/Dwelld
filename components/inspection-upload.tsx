"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, FileVideo2, LoaderCircle, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { detectVideoFrames } from "@/lib/client/video-detection";
import { MAX_VIDEO_BYTES, uploadVideo } from "@/lib/client/upload-video";

export default function InspectionUpload({ roomId, roomName, type, onBusy }: {
  roomId: string; roomName: string; type: "move-in" | "move-out"; onBusy: (busy: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState(0);
  const job = useRef<AbortController | null>(null);
  const createdRoom = useRef("");

  useEffect(() => {
    if (!file) { setPreview(""); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => job.current?.abort(), []);
  useEffect(() => { createdRoom.current = ""; }, [roomId, roomName]);

  function chooseFile(next?: File) {
    if (!next) return;
    setError(""); setProgress("");
    if (!next.size) { setError("This video is empty. Choose another recording."); return; }
    if (next.size > MAX_VIDEO_BYTES) {
      setError(`This video is ${(next.size / 1024 / 1024).toFixed(1)} MB. Choose a video under 100 MB, or trim or compress this recording first.`);
      return;
    }
    const extension = next.name.split(".").pop()?.toLowerCase();
    const formats: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };
    const contentType = formats[extension || ""] || next.type.split(";")[0].toLowerCase();
    if (!Object.values(formats).includes(contentType)) {
      setError("This format is not supported. Choose an MP4, MOV or WebM video."); return;
    }
    setFile(next.type === contentType ? next : new File([next], next.name, { type: contentType }));
  }

  async function submit() {
    if (!file || job.current) return;
    const controller = new AbortController();
    job.current = controller; setBusy(true); onBusy(true); setError(""); setStep(1);
    try {
      const frames = await detectVideoFrames(file, setProgress, controller.signal);
      controller.signal.throwIfAborted(); setStep(2);
      const asset = await uploadVideo(file, { signal: controller.signal, onProgress: n => setProgress(`Uploading walkthrough · ${n}%`) });
      controller.signal.throwIfAborted(); setStep(3); setProgress("Starting your inspection…");
      const target = roomId || createdRoom.current || (await api.createRoom(roomName.trim() || "My room")).room.id;
      createdRoom.current = target;
      controller.signal.throwIfAborted();
      const { inspection } = await api.createInspection(target, asset.url, asset.contentType, frames, type);
      window.location.assign(`/inspections/${inspection.id}`);
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not start the inspection. Please retry.");
    } finally {
      job.current = null;
      if (!controller.signal.aborted) { setBusy(false); onBusy(false); setProgress(""); setStep(0); }
    }
  }

  return <section className="inspection-upload" aria-label="Upload a walkthrough" aria-busy={busy}>
    <ol className="upload-steps" aria-label="Inspection steps">
      {["Choose video", "Review & confirm", "Inspect room"].map((label, index) => <li key={label} aria-current={(busy ? 2 : file ? 1 : 0) === index ? "step" : undefined}><span>{file && index === 0 ? <Check size={13} aria-hidden="true" /> : `0${index + 1}`}</span>{label}</li>)}
    </ol>
    <div className="upload-heading"><h3>{file ? "Your walkthrough is ready." : "Bring your room into view."}</h3><p>{file ? "Review your video, then confirm below to upload it and start the inspection." : "Choose a recorded walkthrough, then start your inspection. We’ll check the room for objects and potential damage."}</p></div>
    <label className={`upload-picker ${busy ? "is-busy" : ""}`}>
      <Upload size={22} aria-hidden="true" />
      <span><b>{file ? "Choose a different video" : "Choose a recorded walkthrough"}</b><small>MP4, MOV or WebM · up to 2 minutes · 100 MB</small></span>
      <input className="sr-only" disabled={busy} aria-label={file ? "Choose a different video" : "Choose a recorded walkthrough"} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" onChange={e => { chooseFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
      <ArrowUpRight size={18} aria-hidden="true" />
    </label>
    {file && <div className="upload-file"><FileVideo2 size={20} aria-hidden="true" /><div><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB · Selected for inspection</small></div><button type="button" disabled={busy} aria-label="Remove video" onClick={() => { setFile(null); setError(""); setProgress(""); }}><X size={18} /></button></div>}
    {error && <p className="upload-error" role="alert">{error}</p>}
    <div className="upload-confirm">
      <div><b>{file ? `${type === "move-out" ? "Move-out" : "Move-in"} inspection` : "Ready when you are"}</b><p>{file ? `${roomName.trim() || "Your room"} · Your original video will be saved with the findings.` : "Select a video to enable Start inspection."}</p></div>
      <button type="button" className="landing-primary upload-start" disabled={!file || busy} onClick={() => void submit()}>{busy ? <><LoaderCircle size={17} className="spin" aria-hidden="true" /> Starting inspection…</> : <>Start inspection <ArrowUpRight size={18} aria-hidden="true" /></>}</button>
    </div>
    {busy && <div className="upload-progress" role="status" aria-live="polite"><LoaderCircle className="spin" size={18} aria-hidden="true" /><div><b>{["", "1 of 3 · Preparing video", "2 of 3 · Saving video", "3 of 3 · Starting inspection"][step]}</b><p>{progress}</p><small>Keep this page open. Your results will open automatically.</small></div></div>}
    {preview && <div className="upload-preview"><span>YOUR WALKTHROUGH</span><video src={preview} controls playsInline preload="metadata" aria-label="Walkthrough preview" /><p>You can review and confirm potential damage once the inspection is ready.</p></div>}
  </section>;
}
