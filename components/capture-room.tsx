"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Camera, Circle, CloudUpload, FileVideo2, LoaderCircle, Pause, Play, RotateCcw, ShieldCheck, Sparkles, StopCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import { detectVideoFrames } from "@/lib/client/video-detection";
import { MAX_VIDEO_BYTES, uploadVideo } from "@/lib/client/upload-video";
import type { Room } from "@/lib/types";

export default function CaptureRoom({ roomId }: { roomId: string }) {
  const [room, setRoom] = useState<Room | null>(null); const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState("");
  const [recording, setRecording] = useState(false); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [elapsed, setElapsed] = useState(0); const [camera, setCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null); const streamRef = useRef<MediaStream | null>(null); const recorderRef = useRef<MediaRecorder | null>(null); const chunksRef = useRef<Blob[]>([]); const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const analysisRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState("");
  const stopCamera = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") { recorder.onstop = null; recorder.stop(); }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    setRecording(false); setCamera(false);
  }, []);
  useEffect(() => { mountedRef.current = true; api.room(roomId).then(({room})=>{if(mountedRef.current)setRoom(room);}).catch(e=>{if(mountedRef.current)setError(e.message);}); return () => { mountedRef.current = false; analysisRef.current?.abort(); stopCamera(); }; }, [roomId, stopCamera]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    if (camera && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      void videoRef.current.play().catch(() => setError("Tap the preview to start camera playback."));
    }
  }, [camera]);
  const setVideoFile = (next: File) => {
    if (!next.size || !next.type.startsWith("video/")) { setError("Choose a non-empty video file."); return; }
    if (next.size > MAX_VIDEO_BYTES) { setError("Choose a video smaller than 100 MB."); return; }
    setFile(next); setPreview(URL.createObjectURL(next)); setError("");
  };
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:true});
      if (!mountedRef.current) { stream.getTracks().forEach(track=>track.stop()); return; }
      streamRef.current?.getTracks().forEach(track=>track.stop()); streamRef.current=stream; setCamera(true); setError("");
    } catch { setError("Camera access is unavailable. Check your browser permissions or upload a video instead."); }
  }
  function startRecording() {
    if (!streamRef.current) return;
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("Recording is unavailable in this browser. Upload a video instead.");
      chunksRef.current=[];
      const mimeType=["video/webm;codecs=vp9,opus","video/webm;codecs=vp8,opus","video/webm","video/mp4"].find(t=>MediaRecorder.isTypeSupported(t));
      const recorder=new MediaRecorder(streamRef.current,mimeType?{mimeType}:undefined); recorderRef.current=recorder;
      recorder.ondataavailable=e=>{if(e.data.size)chunksRef.current.push(e.data);};
      recorder.onerror=()=>{stopCamera();setError("Recording failed. Please try again or upload a video.");};
      recorder.onstop=()=>{
        const type=(recorder.mimeType || chunksRef.current[0]?.type || "video/webm").split(";")[0];
        const blob=new Blob(chunksRef.current,{type});
        if (mountedRef.current) setVideoFile(new File([blob],`dwelld-walkthrough.${type.includes("mp4")?"mp4":"webm"}`,{type}));
        stopCamera();
      };
      recorder.start(1000);setElapsed(0);setRecording(true);timerRef.current=setInterval(()=>setElapsed(s=>s+1),1000);
    } catch(e) { setError(e instanceof Error?e.message:"Could not start recording."); }
  }
  function stopRecording(){if(recorderRef.current?.state==="recording")recorderRef.current.stop();setRecording(false);if(timerRef.current)clearInterval(timerRef.current);}
  function clearVideo(){setPreview("");setFile(null);setElapsed(0);}
  const submit = useCallback(async()=>{
    if(!file || analysisRef.current) return;
    const controller = new AbortController(); analysisRef.current = controller;
    const updateProgress = (message: string) => { if (mountedRef.current) setProgress(message); };
    setBusy(true);setError("");
    try {
      const detectionFrames = await detectVideoFrames(file, updateProgress, controller.signal);
      controller.signal.throwIfAborted();
      updateProgress("Uploading your walkthrough…");
      const asset=await uploadVideo(file,{signal:controller.signal,onProgress:percentage=>updateProgress(`Uploading video · ${percentage}%`)});
      controller.signal.throwIfAborted();
      updateProgress("Preparing your damage review…");
      const {inspection}=await api.createInspection(roomId,asset.url,asset.contentType,detectionFrames);
      if (mountedRef.current) window.location.href=`/inspections/${inspection.id}`;
    } catch(e) {
      if (mountedRef.current) {setError(e instanceof Error?e.message:"Could not start your inspection.");setBusy(false);setProgress("");}
    } finally { analysisRef.current = null; }
  },[file,roomId]);
  return <main className="capture-page"><header className="capture-top"><Link href="/" className="brand"><span className="brand-mark">d.</span><span>dwelld<span className="brand-period">.</span></span></Link><div className="secure-note"><ShieldCheck size={15}/> Controlled demo</div></header><div className="capture-wrap"><Link href="/" className="back-link"><ArrowLeft size={15}/> All spaces</Link><div className="capture-title"><div><p className="eyebrow">{room?.name || "YOUR ROOM"}</p><h1>Let’s take a look<br/>around.</h1><p className="lead">A slow walkthrough gives you a record you can come back to. Analysis samples up to three frames, so it may miss areas. Use only authorised demo footage: tenant access controls are not enabled.</p></div><div className="step-badge"><span>01</span> RECORD YOUR ROOM</div></div>
  {error && <div className="notice error-notice">{error}</div>}
  {!preview && !camera && <div className="capture-grid"><button className="capture-option capture-record" onClick={startCamera}><span className="option-icon"><Camera size={21}/></span><span className="option-title">Record a walkthrough</span><span className="option-copy">Use your camera for a walkthrough of up to 2 minutes.</span><span className="option-cta">Open camera <ArrowLeft className="option-arrow" size={16}/></span><span className="record-illustration"><i/><i/><b/></span></button><label className="capture-option capture-upload"><input type="file" accept="video/*" className="sr-only" onChange={e=>{const f=e.currentTarget.files?.[0];if(f)setVideoFile(f);}}/><span className="option-icon upload-icon"><CloudUpload size={21}/></span><span className="option-title">Upload a video</span><span className="option-copy">Already filmed? Choose a video up to 2 minutes long and 100 MB.</span><span className="option-cta">Choose video <ArrowLeft className="option-arrow" size={16}/></span><span className="upload-illustration"><FileVideo2 size={40}/><span>MP4 · MOV · WEBM</span></span></label></div>}
  {camera && <div className="video-stage"><video ref={videoRef} muted playsInline autoPlay onClick={e=>void e.currentTarget.play()}/><div className="camera-hud"><span className="live-dot">● CAMERA LIVE</span><button onClick={stopCamera}><X size={17}/></button></div>{!recording ? <button className="record-control" onClick={startRecording}><Circle size={24} fill="currentColor"/> Start recording</button> : <button className="record-control is-recording" onClick={stopRecording}><StopCircle size={22}/> Stop · {Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,"0")}</button>}</div>}
  {preview && !camera && <div className="video-stage preview-stage"><video src={preview} controls playsInline/><button className="remove-video" disabled={busy} onClick={clearVideo}><X size={15}/> Remove video</button><div className="preview-file"><FileVideo2 size={17}/><span>{file?.name}</span><small>{file ? `${(file.size/1024/1024).toFixed(1)} MB` : ""}</small></div></div>}
  {preview && <div className="submit-row"><div className="privacy-copy"><ShieldCheck size={16}/><span>Media stored in MongoDB. Demo has no tenant access controls.</span></div><button className="button button-dark submit-button" disabled={busy} onClick={()=>void submit()}>{busy?<><LoaderCircle className="spin" size={17}/> {progress || "Preparing inspection…"}</>:<><Sparkles size={17}/> Analyse this video</>}</button></div>}
  {busy&&<p role="status" aria-live="polite" className="privacy-copy">{progress}</p>}
  <div className="capture-tips"><span><span className="tip-number">1</span> Move slowly</span><span><span className="tip-number">2</span> Keep the room well lit</span><span><span className="tip-number">3</span> Show any marks up close</span></div></div></main>;
}
