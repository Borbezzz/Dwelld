"use client";
import Link from 'next/link';
import QRCode from 'qrcode';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,Check,Camera,Copy,RefreshCw,Smartphone,Square,Wifi,X,Plus} from 'lucide-react';
import {api} from '@/lib/api';
import {parseVideoMarkers,type VideoMarker} from '@/lib/client/live-markers';
import {SignalQueue,NegotiationCandidates} from '@/lib/client/live-signaling';
import {liveRequest,randomToken,uploadLiveVideo} from '@/lib/client/live-api';
import {captureEvidence,startLiveDetection,type LiveFrame} from '@/lib/client/live-detection';
import type {InspectionSession,LiveObject,LiveFinding,LiveSessionCreated,LiveState} from '@/lib/live/types';
import type {Room} from '@/lib/types';
import LiveFeed from './live-feed';
import LiveDamagePreview from './live-damage-preview';
import dynamic from 'next/dynamic';
import {isFurniture,furnitureNames} from '@/lib/spatial/furniture';
const LiveRoomView=dynamic(()=>import('./live-room-view'),{ssr:false});
import type {StreamChunk} from './live-room-view';
import PixelLoader from '../pixel-loader';
import BrandLogo from '../brand-logo';
import InspectionUpload from '../inspection-upload';
import RoomHistory from '../room-history';

type Credentials={token:string;pairingToken?:string;iceServers:RTCIceServer[]};
type ConnectionPhase='Waiting for phone'|'Phone paired'|'Camera permission required'|'Establishing video'|'Connected'|'Connection failed'|'Reconnecting';
const fallbackIce=[{urls:'stun:stun.l.google.com:19302'}];
export default function LiveWorkspace(props:Parameters<typeof LiveWorkspaceInner>[0]) {
 return <LiveWorkspaceInner key={[props.sessionId||'new',props.initialRoomId,props.initialType,props.newRoom,props.baselineId,props.continueFrom,props.phone].join(':')} {...props}/>;
}
function LiveWorkspaceInner({sessionId,phone=false,initialRoomId='',newRoom=false,lockRoom=false,initialType='move-in',baselineId='',continueFrom=''}:{sessionId?:string;phone?:boolean;initialRoomId?:string;newRoom?:boolean;lockRoom?:boolean;initialType?:'move-in'|'move-out';baselineId?:string;continueFrom?:string}) {
 const [id,setId]=useState(sessionId||''),[credentials,setCredentials]=useState<Credentials|null>(null),[session,setSession]=useState<InspectionSession|null>(null);
 const [captureMode,setCaptureMode]=useState<'phone'|'upload'>('phone'),[uploadBusy,setUploadBusy]=useState(false);
 const [inspectionType,setInspectionType]=useState<'move-in'|'move-out'>(initialType);
 const [baseline,setBaseline]=useState(baselineId);
 const [rooms,setRooms]=useState<Room[]>([]),[roomId,setRoomId]=useState(initialRoomId),[roomName,setRoomName]=useState('');
 const [inventory,setInventory]=useState<LiveObject[]>([]),[objects,setObjects]=useState<LiveObject[]>([]),[findings,setFindings]=useState<LiveFinding[]>([]);
 const [selected,setSelected]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(''),[qr,setQr]=useState(''),[pairUrl,setPairUrl]=useState('');
 const [connectionPhase,setConnectionPhase]=useState<ConnectionPhase>('Waiting for phone'),[diagnostics,setDiagnostics]=useState<string[]>([]);
 const negotiation=useRef(''),signalQueue=useRef(new SignalQueue()),processedSignals=useRef(new Set<string>()),negotiating=useRef(false),videoReceived=useRef(false);
 const lastNativeMarkerTime=useRef(-1);
 const [receivedFps,setReceivedFps]=useState<number|null>(null);
 const [videoMarkers,setVideoMarkers]=useState<VideoMarker[]>([]),[markerAt,setMarkerAt]=useState(0);
 const [connected,setConnected]=useState(false),[camera,setCamera]=useState(false),[recording,setRecording]=useState(false),[elapsed,setElapsed]=useState(0),[ratio,setRatio]=useState(16/9),[latency,setLatency]=useState<number|null>(null);
 const [pollError,setPollError]=useState(''),[clockNow,setClockNow]=useState(Date.now());
 const [analysis,setAnalysis]=useState(''),[savedId,setSavedId]=useState(''),[evidence,setEvidence]=useState<{url:string;finding:LiveFinding}|null>(null);
 const [manual,setManual]=useState<{blob:Blob;url:string;timestamp:number;observationId:string;point?:{x:number;y:number}}|null>(null),[description,setDescription]=useState(''),[facing,setFacing]=useState<'environment'|'user'>('environment');
 const remoteStream=useRef<MediaStream|null>(null);
 const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),peer=useRef<RTCPeerConnection|null>(null),channel=useRef<RTCDataChannel|null>(null),recorder=useRef<MediaRecorder|null>(null),chunks=useRef<Blob[]>([]);
 const elapsedRef=useRef(0),started=useRef(0),lastFrame=useRef<LiveFrame|null>(null),stopDetection=useRef<(()=>void)|null>(null),analysisJob=useRef<Promise<unknown>|null>(null),lastAnalysis=useRef(0),lastPublish=useRef(0),totalBytes=useRef(0),stopping=useRef(false),startingScan=useRef(false),mounted=useRef(true);
 const markerJob=useRef<Promise<void>|null>(null);
 const [roomStream,setRoomStream]=useState<StreamChunk[]>([]),[streamElements,setStreamElements]=useState<NonNullable<InspectionSession['nativeLive']>['elements']>(undefined);
 const iceBuffer=useRef(new NegotiationCandidates()),stopRef=useRef<()=>Promise<void>>(async()=>{}),busyStarted=useRef(Date.now());
 const headers:Record<string,string>=credentials?{Authorization:`Bearer ${credentials.token}`} : {};
 const event=useCallback((type:string,payload:Record<string,unknown>={})=>id&&credentials?liveRequest(id,credentials.token,'/events',{method:'POST',body:JSON.stringify({eventId:crypto.randomUUID(),type,payload})}):Promise.resolve(),[id,credentials]);
 // Diagnostics intentionally contain states only: never SDP, candidates, URLs or credentials.
 const diagnose=useCallback((message:string)=>setDiagnostics(previous=>[...previous.slice(-11),`${new Date().toLocaleTimeString()} · ${message}`]),[]);
 const signal=useCallback((type:string,data:unknown)=>{
  const payload={eventId:crypto.randomUUID(),type,data};
  const send=()=>liveRequest(id,credentials!.token,'/signal',{method:'POST',body:JSON.stringify(payload)});
  return signalQueue.current.send(send);
 },[id,credentials]);
 const attachRemoteVideo=useCallback((element:HTMLVideoElement|null)=>{
  video.current=element;
  if(element&&remoteStream.current){if(element.srcObject!==remoteStream.current)element.srcObject=remoteStream.current;void element.play().catch(()=>setError('Tap Reconnect video to resume playback.'));}
 },[]);
 const makePeer=useCallback((generation:string)=>{
  peer.current?.close();setConnected(false);videoReceived.current=false;negotiation.current=generation;iceBuffer.current.activate(generation);
  const pc=new RTCPeerConnection({iceServers:credentials?.iceServers||fallbackIce});peer.current=pc;
  // Hold candidates until the local description is queued, preserving offer/answer order.
  const candidates:RTCIceCandidateInit[]=[];let descriptionSent=false;
  const sendCandidate=(candidate:RTCIceCandidateInit)=>void signal('ice',{negotiationId:generation,candidate}).catch(()=>setError('Could not send a video connection update. Reconnect video.'));
  pc.onicecandidate=e=>{if(e.candidate){if(descriptionSent)sendCandidate(e.candidate.toJSON());else candidates.push(e.candidate.toJSON())}};
  pc.onicegatheringstatechange=()=>{if(peer.current===pc)diagnose(`ICE gathering: ${pc.iceGatheringState}`)};
  pc.oniceconnectionstatechange=()=>{if(peer.current===pc)diagnose(`ICE connection: ${pc.iceConnectionState}`)};
  pc.onconnectionstatechange=()=>{if(peer.current!==pc)return;diagnose(`Peer: ${pc.connectionState}`);if(pc.connectionState==='failed'||pc.connectionState==='disconnected'){setConnected(false);setConnectionPhase('Connection failed');if(pc.connectionState==='failed')setError('Video connection failed. Reconnect, or try both devices on the same Wi-Fi. Different networks may require a configured TURN relay.');}else if(pc.connectionState==='connected'&&phone){setConnected(true);setConnectionPhase('Connected')}};
  pc.ontrack=e=>{if(peer.current!==pc)return;videoReceived.current=true;remoteStream.current=e.streams[0]||new MediaStream([e.track]);diagnose('Remote video track received');attachRemoteVideo(video.current);};
  pc.ondatachannel=e=>{if(peer.current!==pc){e.channel.close();return;}channel.current=e.channel;e.channel.onmessage=message=>{if(peer.current!==pc)return;try{const data=JSON.parse(message.data);if(data.type==='native-marks'&&Number.isFinite(data.timestamp)&&data.timestamp>lastNativeMarkerTime.current){lastNativeMarkerTime.current=data.timestamp;setVideoMarkers(parseVideoMarkers(data.markers));setMarkerAt(Date.now());}if(data.type==='detections'&&Array.isArray(data.objects)&&data.objects.length<=100){setObjects(data.objects);setLatency(data.latencyMs);setElapsed(Math.floor(data.timestampSeconds));}}catch{}}};
  return {pc,sendDescription:async(type:'offer'|'answer')=>{await signal(type,{negotiationId:generation,description:pc.localDescription});descriptionSent=true;candidates.forEach(sendCandidate);diagnose(`${type==='offer'?'Offer':'Answer'} sent`);}};
 },[credentials,signal,phone,diagnose,attachRemoteVideo]);
 const offer=useCallback(async()=>{if(!stream.current||negotiating.current)return;negotiating.current=true;setConnectionPhase('Establishing video');try{const {pc,sendDescription}=makePeer(crypto.randomUUID());stream.current.getTracks().forEach(t=>pc.addTrack(t,stream.current!));channel.current=pc.createDataChannel('detections');await pc.setLocalDescription(await pc.createOffer());await sendDescription('offer');}finally{negotiating.current=false}},[makePeer]);
 useEffect(()=>{const element=video.current;if(!element)return;const playing=()=>{if(!phone&&videoReceived.current){setConnected(true);setConnectionPhase('Connected');diagnose('Remote video playing')}};element.addEventListener('playing',playing);return()=>element.removeEventListener('playing',playing)},[phone,diagnose]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;stopDetection.current?.();peer.current?.close();stream.current?.getTracks().forEach(t=>t.stop());if(recorder.current?.state==='recording'){recorder.current.onstop=null;recorder.current.stop();}}},[]);
 useEffect(()=>{
  if(!connected||!session?.nativeCapture||!credentials||savedId)return;
  const controller=new AbortController();let active=true,running=false,previous:{frames:number;at:number}|null=null;
  const sample=async()=>{if(running||!active||!peer.current)return;running=true;try{
   const stats=await peer.current.getStats();
   const report=[...stats.values()].find(r=>r.type==='inbound-rtp'&&(r.kind==='video'||r.mediaType==='video'||r.framesDecoded!=null));
   if(!report||!active)return;
   const frames=Number(report.framesDecoded||0),at=Number(report.timestamp);
   const fps=Number.isFinite(report.framesPerSecond)?Number(report.framesPerSecond):previous&&at>previous.at?(frames-previous.frames)*1000/(at-previous.at):null;
   previous={frames,at};if(fps==null||!Number.isFinite(fps)||fps<0||fps>240)return;
   setReceivedFps(Math.round(fps));
   await liveRequest(id,credentials.token,'/video-health',{method:'POST',signal:controller.signal,body:JSON.stringify({fps,decoded:frames,dropped:Number(report.framesDropped||0)})});
  }catch{}finally{running=false}};
  void sample();const timer=setInterval(()=>void sample(),3000);return()=>{active=false;controller.abort();clearInterval(timer)};
 },[connected,session?.nativeCapture,credentials,savedId,id]);
 useEffect(()=>{if(!markerAt)return;const timer=setTimeout(()=>setVideoMarkers([]),1500);return()=>clearTimeout(timer);},[markerAt]);
 useEffect(()=>{if(!savedId)return;
  stopDetection.current?.();stopDetection.current=null;
  channel.current?.close();channel.current=null;peer.current?.close();peer.current=null;
  stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;
  if(video.current)video.current.srcObject=null;remoteStream.current=null;
  setConnected(false);setCamera(false);setRecording(false);setQr('');setPairUrl('');
  if(phone){sessionStorage.removeItem(`dwelld-live-phone-${id}`);sessionStorage.removeItem(`dwelld-live-phone-${id}-claim`);}
 },[savedId,id,phone]);
 useEffect(()=>{if(!phone&&!id)api.rooms().then(x=>{setRooms(x.rooms);setRoomId(initialRoomId||(newRoom?'':x.rooms[0]?.id||''))}).catch(e=>setError(e.message));},[phone,id,initialRoomId,newRoom]);
 useEffect(()=>{if(id&&!phone&&!baseline){const b=sessionStorage.getItem(`dwelld-baseline-${id}`);if(b)setBaseline(b);}},[id,phone,baseline]);
 useEffect(()=>{
  if(!id)return;
  let active=true;const controller=new AbortController();
  const key=`dwelld-live-${phone?'phone':'desktop'}-${id}`;
  const restore=sessionStorage.getItem(key);
  if(restore){try{setCredentials(JSON.parse(restore));return}catch{sessionStorage.removeItem(key)}}
  if(!phone){setError('Open this inspection in the browser where it was created, or start a new one.');return;}
  const pairingToken=new URLSearchParams(location.hash.slice(1)).get('token');
  if(!pairingToken){setError('Scan a new pairing QR code on your laptop.');return;}
  const phoneToken=randomToken(),deviceId=crypto.randomUUID();
  // Persist claim inputs before sending so a network retry does not claim a second device.
  const claimKey=key+'-claim';let claim={pairingToken,phoneToken,deviceId};try{const previous=sessionStorage.getItem(claimKey);if(previous)claim=JSON.parse(previous)}catch{}
  sessionStorage.setItem(claimKey,JSON.stringify(claim));
  fetch(`/api/live/${id}/pair`,{signal:controller.signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(claim)}).then(async r=>{const data=await r.json();if(!active)return;if(!r.ok)throw new Error(data.error||'Pairing expired. Scan a new code.');const c={token:claim.phoneToken,iceServers:data.iceServers||fallbackIce};sessionStorage.setItem(key,JSON.stringify(c));history.replaceState(null,'',location.pathname);setCredentials(c);setSession(data.session);setConnectionPhase('Camera permission required');diagnose('Phone paired');}).catch(e=>{if(active)setError(e.message)});
  return()=>{active=false;controller.abort()};
 },[id,phone,diagnose]);
 useEffect(()=>{if(!id||!credentials?.pairingToken||phone)return;const url=`${location.origin}/connect/${id}#token=${credentials.pairingToken}`;setPairUrl(url);if(location.protocol!=='https:')setError('This local address cannot pair a phone camera securely. Open the deployed HTTPS site on your laptop and create the inspection there.');QRCode.toDataURL(url,{width:280,margin:2,color:{dark:'#304539',light:'#ffffff'}}).then(setQr);},[id,credentials,phone]);
 useEffect(()=>{
  if(!id||!credentials||savedId)return;const controller=new AbortController();let active=true,cursor='',running=false,initialPoll=true;const processed=processedSignals.current;
  const poll=async()=>{if(running||!active)return;running=true;try{const data=await liveRequest<LiveState>(id,credentials.token,`?after=${cursor}`,{signal:controller.signal});if(!active)return;setPollError('');setSession(data.session);setInventory(data.objects);setFindings(data.findings);if(initialPoll){initialPoll=false;if(!phone&&data.session.paired&&!peer.current&&data.session.status!=='saved'){setConnectionPhase('Reconnecting');await signal('restart',{});}}if(data.session.status==='saved'&&data.session.inspectionId){setSavedId(data.session.inspectionId);return;}
   // A reopened desktop answers only the latest offer, never each historical negotiation.
   const latestOffer=!phone?[...data.signals].reverse().find(s=>s.type==='offer'):undefined;
   for(const s of data.signals){cursor=s.id;if(processed.has(s.id))continue;
    const payload=s.data as {negotiationId?:string;description?:RTCSessionDescriptionInit;candidate?:RTCIceCandidateInit};
    if(s.type==='offer'&&!phone&&s.id===latestOffer?.id&&payload.negotiationId&&payload.description){setConnectionPhase('Establishing video');diagnose('Offer received');const {pc,sendDescription}=makePeer(payload.negotiationId);await pc.setRemoteDescription(payload.description);for(const candidate of iceBuffer.current.drain(payload.negotiationId))await pc.addIceCandidate(candidate);await pc.setLocalDescription(await pc.createAnswer());await sendDescription('answer');}
    else if(s.type==='answer'&&phone&&peer.current&&payload.negotiationId===negotiation.current&&payload.description&&peer.current.signalingState==='have-local-offer'){await peer.current.setRemoteDescription(payload.description);diagnose('Answer received');for(const candidate of iceBuffer.current.drain(negotiation.current))await peer.current.addIceCandidate(candidate);}
    else if(s.type==='ice'&&payload.negotiationId&&payload.candidate){if(payload.negotiationId===negotiation.current&&peer.current?.remoteDescription)await peer.current.addIceCandidate(payload.candidate);else iceBuffer.current.add(payload.negotiationId,payload.candidate);}
    else if(s.type==='restart'&&phone&&stream.current){setConnectionPhase('Reconnecting');await offer();}
    processed.add(s.id);
   }
   if(phone&&data.session.stopRequested&&!stopping.current&&recorder.current?.state==='recording')void stopRef.current();
  }catch(e){if(active)setPollError(e instanceof Error?e.message:'Connection interrupted. Retrying…')}finally{running=false}};
  void poll();const interval=setInterval(()=>void poll(),1500);return()=>{active=false;controller.abort();clearInterval(interval)};
 },[id,credentials,phone,makePeer,signal,offer,diagnose,savedId]);
 useEffect(()=>{
  if(phone||!id||!credentials||!session?.nativeCapture||savedId)return;const controller=new AbortController();let active=true,cursor=0,running=false;
  const pull=async()=>{if(running||!active)return;running=true;try{const data=await liveRequest<{chunks:StreamChunk[];elements:NonNullable<InspectionSession['nativeLive']>['elements'];saved:boolean}>(id,credentials.token,`/stream?after=${cursor}`,{signal:controller.signal});if(!active)return;if(data.chunks.length){cursor=data.chunks[data.chunks.length-1].seq;setRoomStream(prev=>[...prev,...data.chunks].slice(-400));}if(data.elements?.length)setStreamElements(data.elements);}catch{}finally{running=false}};
  void pull();const timer=setInterval(()=>void pull(),1000);return()=>{active=false;controller.abort();clearInterval(timer)};
 },[phone,id,credentials,session?.nativeCapture,savedId]);
 useEffect(()=>{if(!recording&&!busy)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[recording,busy]);
 useEffect(()=>{if(!recording)return;const timer=setInterval(()=>{const value=Math.floor((performance.now()-started.current)/1000);setElapsed(value);elapsedRef.current=value;if(value>=120)void stopRef.current();},1000);return()=>clearInterval(timer)},[recording]);
 useEffect(()=>()=>{if(evidence)URL.revokeObjectURL(evidence.url)},[evidence]);
 const manualUrl=manual?.url;
 useEffect(()=>()=>{if(manualUrl)URL.revokeObjectURL(manualUrl)},[manualUrl]);
 async function createSession(){setError('');setBusy('Preparing your inspection');busyStarted.current=Date.now();try{let target=roomId;if(!target){const r=await api.createRoom(roomName.trim()||'My room');target=r.room.id;}const response=await fetch('/api/live',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roomId:target,type:inspectionType,...(continueFrom?{continueFrom}:{})})});const data=await response.json() as LiveSessionCreated&{error?:string};if(!response.ok)throw new Error(data.error||'Could not create pairing');const c={token:data.desktopToken,pairingToken:data.pairingToken,iceServers:data.iceServers};sessionStorage.setItem(`dwelld-live-desktop-${data.sessionId}`,JSON.stringify(c));setCredentials(c);setId(data.sessionId);if(baseline)sessionStorage.setItem(`dwelld-baseline-${data.sessionId}`,baseline);history.replaceState(null,'',`/live/${data.sessionId}`);}catch(e){setError((e as Error).message)}finally{setBusy('')}}
 async function analyze(frame:LiveFrame){if(!credentials||analysisJob.current||Date.now()-lastAnalysis.current<3000)return;const candidates=frame.objects.slice(0,4);lastAnalysis.current=Date.now();setAnalysis('Checking the latest view for damage…');const job=(async()=>{const form=new FormData();form.append('image',await frame.capture(),'evidence.jpg');form.append('metadata',JSON.stringify({observationId:crypto.randomUUID(),timestampSeconds:frame.timestampSeconds,objects:candidates,includeSurfaces:true}));const result=await liveRequest<{analysisWarnings?:string[];analyzedObjectIds:string[];surfacesAnalyzed:boolean}>(id,credentials.token,'/analyze',{method:'POST',body:form});setAnalysis(result.analysisWarnings?.length?result.analysisWarnings.join(' '):'Latest view checked · scanning continues');})().catch(e=>{setAnalysis('Damage check incomplete. It can be retried on a later frame.');setError(e.message)}).finally(()=>{analysisJob.current=null});analysisJob.current=job;}
 async function openCamera(){setError('');setConnectionPhase('Camera permission required');setBusy('Opening your phone camera');busyStarted.current=Date.now();try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires HTTPS and a supported browser.');const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:facing},width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}},audio:false});stream.current=media;if(video.current){video.current.srcObject=media;await video.current.play();}setCamera(true);diagnose('Camera permission granted');await event('phone.connected');await offer();}catch(e){setConnectionPhase('Connection failed');stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;setCamera(false);setError(e instanceof DOMException&&e.name==='NotAllowedError'?'Camera permission is required. Allow camera access in your browser settings, then try again.':(e as Error).message)}finally{setBusy('')}}
 async function startScan(){if(!stream.current||!video.current||startingScan.current||recorder.current?.state==='recording')return;startingScan.current=true;setError('');setBusy('Starting your inspection');busyStarted.current=Date.now();try{const mime=['video/mp4','video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));const r=new MediaRecorder(stream.current,mime?{mimeType:mime}:undefined);recorder.current=r;chunks.current=[];totalBytes.current=0;stopping.current=false;lastAnalysis.current=0;
  r.ondataavailable=e=>{if(e.data.size){chunks.current.push(e.data);totalBytes.current+=e.data.size;if(totalBytes.current>90*1024*1024)void stopRef.current();}};r.onerror=()=>{setError('Recording stopped unexpectedly. Preserving the available footage.');};r.onstop=()=>{if(mounted.current&&!stopping.current)void stopRef.current();};await event('scan.started');started.current=performance.now();elapsedRef.current=0;setElapsed(0);r.start(1000);setRecording(true);
  stopDetection.current=startLiveDetection(video.current,{targetFps:3,startTime:started.current,onError:e=>setError(e.message),onFrame:frame=>{lastFrame.current=frame;setObjects(frame.objects);setLatency(frame.latencyMs);if(channel.current?.readyState==='open')channel.current.send(JSON.stringify({type:'detections',objects:frame.objects,latencyMs:frame.latencyMs,timestampSeconds:frame.timestampSeconds}));if(Date.now()-lastPublish.current>2000){lastPublish.current=Date.now();void event('objects.updated',{objects:frame.objects}).catch(e=>setError(e.message));}void analyze(frame);}});
 }catch(e){setError((e as Error).message)}finally{startingScan.current=false;setBusy('')}}
 async function stopScan(){if(stopping.current||!recorder.current)return;stopping.current=true;stopDetection.current?.();stopDetection.current=null;setRecording(false);setBusy('Preserving original footage');busyStarted.current=Date.now();try{const r=recorder.current;await new Promise<void>(resolve=>{if(r.state==='inactive')return resolve();r.onstop=()=>resolve();r.stop();});const file=new Blob(chunks.current,{type:r.mimeType||chunks.current[0]?.type||'video/webm'});stream.current?.getTracks().forEach(t=>t.stop());setCamera(false);if(markerJob.current)await markerJob.current;if(lastFrame.current)await event('objects.updated',{objects:lastFrame.current.objects});await uploadLiveVideo(id,credentials!.token,file,n=>setBusy(`Preserving original footage · ${n}%`));if(analysisJob.current){setBusy('Waiting for the current damage check');await analysisJob.current;}setBusy('Saving your room record');const result=await liveRequest<{inspectionId:string}>(id,credentials!.token,'/finish',{method:'POST',body:JSON.stringify({durationSeconds:Math.max(1,elapsedRef.current)})});setSavedId(result.inspectionId);setBusy('');}catch(e){setError((e as Error).message);setBusy('Save interrupted. Your recording remains on this phone.');stopping.current=false;}}
 stopRef.current=stopScan;
 async function reconnect(){setError('');setConnected(false);setConnectionPhase('Reconnecting');diagnose('Reconnect requested');try{if(phone)await offer();else await signal('restart',{});}catch{setConnectionPhase('Connection failed');setError('Could not request a new video connection. Try again.');}}
 async function switchCamera(){if(recording)return;stream.current?.getTracks().forEach(t=>t.stop());setCamera(false);setFacing(v=>v==='environment'?'user':'environment');setError('Camera switched. Open the camera again to continue.');}
 async function viewFinding(finding:LiveFinding){if(session?.nativeCapture&&!phone){setSelected(finding.id);setEvidence(null);return;}const ref=finding.evidenceFrameRef||finding.evidenceFrameUrl;if(!ref||!credentials)return;try{const r=await fetch(`/api/live/${id}/media?ref=${encodeURIComponent(ref)}`,{headers});if(!r.ok)throw new Error('Evidence could not load');setEvidence({url:URL.createObjectURL(await r.blob()),finding});}catch(e){setError((e as Error).message)}}
 async function mark(){
  if(busy||stopping.current)return;
  setError('');
  try{
   const source=video.current;
   if(!source||source.readyState<2||!source.videoWidth)throw new Error('The camera frame is not ready. Try again when the live video appears.');
   // Manual evidence must remain available while YOLO is loading or unavailable.
   const canvas=document.createElement('canvas');canvas.width=source.videoWidth;canvas.height=source.videoHeight;
   const context=canvas.getContext('2d');if(!context)throw new Error('Camera frame capture is unavailable');
   context.drawImage(source,0,0);const timestamp=(performance.now()-started.current)/1000;
   const blob=await captureEvidence(canvas);
   setDescription('');setManual({blob,url:URL.createObjectURL(blob),timestamp,observationId:crypto.randomUUID()});
  }catch(e){setError((e as Error).message)}
 }
 async function saveMarker(){
  if(markerJob.current||stopping.current)return;
  if(!manual?.point){setError('Tap the visible mark on the photo to place a marker, then save.');return;}
  
  if(!credentials){setError('The phone is not paired. Reconnect before saving.');return;}
  setError('');setBusy('Saving marked evidence');busyStarted.current=Date.now();
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),45000);
  const job=(async()=>{try{
   const form=new FormData();form.append('image',manual.blob,'manual.jpg');
   form.append('metadata',JSON.stringify({mode:'manual',observationId:manual.observationId,timestampSeconds:manual.timestamp,point:manual.point,description:description.trim(),objects:[],includeSurfaces:false}));
   const result=await liveRequest<{findings:LiveFinding[]}>(id,credentials.token,'/analyze',{method:'POST',body:form,signal:controller.signal});
   setFindings(previous=>[...previous.filter(f=>!result.findings.some(saved=>saved.id===f.id)),...result.findings]);
   setManual(null);setDescription('');setAnalysis('Marker saved with its source photo.');
  }catch(e){setError(controller.signal.aborted?'The marker save took too long. Your photo is still here. Tap Save marker to retry.':(e as Error).message)}finally{clearTimeout(timeout);markerJob.current=null;if(!stopping.current)setBusy('')}})();
  markerJob.current=job;await job;
 }
 const stage=savedId?'saved':busy&&stopping.current?'saving':recording||session?.status==='recording'?'scanning':session?.paired?'connected':id?'pairing':'prepare';
 useEffect(()=>{if(!session?.nativeCapture||savedId)return;const timer=setInterval(()=>setClockNow(Date.now()),5000);return()=>clearInterval(timer);},[session?.nativeCapture,savedId]);
 const uploadWaiting=!savedId&&session?.nativeProgress?.stage==='uploading'&&!!session.phoneLastSeenAt&&clockNow-new Date(session.phoneLastSeenAt).getTime()>30_000;
 const uploading=!phone&&stage==='prepare'&&captureMode==='upload';
 const health=session?.nativeCapture?'LiDAR capture connected':connected?'Connected':session?.paired&&connectionPhase==='Waiting for phone'?'Phone paired · open camera on your phone':connectionPhase;
 return <main className={`live-shell ${phone?'phone-workspace':''}`} data-stage={stage}>
  <header className="live-topbar"><BrandLogo linked compact /><div className="session-breadcrumb"><span>Room record</span><i/> <b>{stage==='prepare'?'Prepare':stage==='pairing'?'Pair your phone':stage==='scanning'?'Live inspection':stage==='saved'?'Saved for you':stage==='saving'?'Saving evidence':'Ready to scan'}</b></div></header>
  <div className="workspace-heading"><div><Link href={(lockRoom||baseline)&&(session?.roomId||roomId)?`/rooms/${session?.roomId||roomId}`:'/'} className="back-link"><ArrowLeft size={14} aria-hidden="true"/> {(lockRoom||baseline)&&(session?.roomId||roomId)?(rooms.find(r=>r.id===(session?.roomId||roomId))?.name||'Your room'):'Your spaces'}</Link><h1>{savedId?'A little more peace of mind.':phone?'Let your room tell its story.':'Room inspection'}</h1><p>{phone?'Move slowly. Keep the details in view.': uploading?'Choose a walkthrough, review it, then start your room inspection.':'Your phone captures the room. The details come together here.'}</p></div><div className="connection-pill"><span className={connected?'connected-dot':'waiting-dot'}/>{uploading?(uploadBusy?'Preparing inspection':'Video inspection'):savedId?'Record saved':health}</div></div>
  {error&&<div role="alert" className="notice error-notice">{error}<button onClick={()=>setError('')} aria-label="Dismiss message"><X size={16}/></button></div>}
  {session?.analysisIssue&&<div role="status" className="notice analysis-notice"><span>{session.analysisIssue.message} Live video and measured furniture continue; missing damage marks do not mean the room is undamaged.</span></div>}
  {pollError&&<div role="status" className="notice analysis-notice"><span>{pollError}</span><span>Your phone capture remains on the phone. This page will reconnect.</span></div>}
  {savedId&&<section className="saved-next" aria-label="Scan saved"><div><h2>Your room is saved.</h2><p>You can review the room now. Any remaining AI checks continue in the background.</p></div><Link className="button button-dark" href={(session?.roomId||roomId)?`/rooms/${session?.roomId||roomId}`:`/inspections/${savedId}`}>Next: review your room <ArrowUpRight size={16}/></Link></section>}
  <div className="live-columns"><section className="live-stage-panel"><div className="live-stage-heading"><span>{manual?'MARK A SOURCE FRAME':evidence?'PRESERVED EVIDENCE':savedId?'YOUR INSPECTION':uploading?'RECORDED WALKTHROUGH':'THE ROOM, IN VIEW'}</span><div>{recording&&<span className="recording-dot"/>}{!uploading&&<time>{Math.floor(elapsed/60)}:{String(elapsed%60).padStart(2,'0')}</time>}</div></div>
   {uploadWaiting&&<div className="notice analysis-notice" role="status"><div><strong>Waiting for the phone to finish sending.</strong><p>The scan has not been marked as failed. Keep Dwelld open on the iPhone; if it shows Retry save, use it to resume the remaining files. Next becomes available after the final save is confirmed.</p></div></div>}
   <div className="feed-anchor">{session?.nativeCapture&&!phone&&!evidence&&<div className="native-live">
     <LiveDamagePreview onVideoElement={attachRemoteVideo} receivedFps={receivedFps} finished={!!savedId} videoRef={video} videoConnected={connected} videoMarkers={videoMarkers} onVideoReady={()=>{setConnected(true);setConnectionPhase('Connected');}} key={id} sessionId={id} token={credentials?.token||""} findings={findings} preview={session.nativePreview} selectedId={selected} onSelect={setSelected}/>
     <div className="native-model"><LiveRoomView key={id} baseInspectionId={continueFrom||session.continueFrom} live={streamElements?{...session.nativeLive,elements:streamElements}:session.nativeLive} stream={roomStream} findings={findings} selected={selected} onSelect={id=>{const f=findings.find(x=>x.id===id);if(f)void viewFinding(f);}}/></div>
     <div className="native-status">{!savedId&&(session.nativeProgress?.stage==='uploading'||session.nativeProgress?.upload!==undefined)?<PixelLoader label={session.nativeProgress?.upload!==undefined&&session.nativeProgress.upload>0?`Sending your scan from the phone · ${Math.round(session.nativeProgress.upload*100)}%`:'Sending your scan from the phone. Its screen shows the exact progress'} startedAt={busyStarted.current}/>:<p>{savedId?'Your room is saved and the phone connection is closed. Select Next to review ongoing analysis.':session.nativeProgress?.stage==='scanning'?`Move slowly · ${session.nativeProgress.frames} frames · ${session.nativeProgress.depthFrames} with depth. Damage checks run every few seconds.`:session.nativeProgress?.stage==='processing'?'The phone is finishing the measured room…':session.continueFrom?'Tap Continue scan on your phone, then point it at a part you already scanned.':'Tap Start scan on your phone.'}</p>}</div>
    </div>}
    {!session?.nativeCapture&&<div style={{display:manual||evidence?'none':'block'}}><LiveFeed ref={video} objects={objects} findings={findings} selected={selected} onSelect={setSelected} ratio={ratio} onDimensions={setRatio} phone={phone} connected={phone?camera:connected}/></div>}
    {(manual||evidence)&&<div className="frozen-frame" onClick={e=>{if(!manual||busy)return;const r=e.currentTarget.getBoundingClientRect();setManual({...manual,point:{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))}})}}><img src={manual?.url||evidence?.url} alt="Preserved source frame"/>{(manual?.point||evidence?.finding.point)&&<span className="damage-pin" style={{left:`${(manual?.point||evidence?.finding.point)!.x*100}%`,top:`${(manual?.point||evidence?.finding.point)!.y*100}%`}}>!</span>}{evidence?.finding.boundingBox&&<span className="frozen-damage-box" style={{left:`${evidence.finding.boundingBox.x*100}%`,top:`${evidence.finding.boundingBox.y*100}%`,width:`${evidence.finding.boundingBox.width*100}%`,height:`${evidence.finding.boundingBox.height*100}%`}}/>}</div>}
    {!phone&&stage==='prepare'&&<div className="pairing-layer prepare-layer">{continueFrom?<><h2>Pick up where you left off.</h2><p>Your phone finds the part you already scanned, then everything new lands in the same room.</p></>:<><h2>Begin with your room.</h2><p>Connect your phone or bring a walkthrough you’ve already recorded.</p><div className="capture-mode" aria-label="Capture method"><button aria-pressed={captureMode==='phone'} disabled={uploadBusy} onClick={()=>setCaptureMode('phone')}>Phone camera</button><button aria-pressed={captureMode==='upload'} disabled={!!busy} onClick={()=>setCaptureMode('upload')}>Upload video</button></div></>}{lockRoom&&roomId?<div className="locked-room"><span>Room</span><b>{rooms.find(r=>r.id===roomId)?.name||'Your room'}</b><small>{continueFrom?'Continuing your earlier scan · new areas line up with it':<>{inspectionType==='move-out'?'Move-out scan':'Move-in scan'}{baseline?' · compared with your earlier scan once saved':''}</>}</small></div>:<><label className="field-label">Your space{rooms.length>0?<select disabled={uploadBusy} className="field" value={roomId} onChange={e=>setRoomId(e.target.value)}>{rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}<option value="">New room…</option></select>:null}</label>{!roomId&&<input disabled={uploadBusy} className="field" value={roomName} onChange={e=>setRoomName(e.target.value)} placeholder="Name your room" aria-label="Room name"/>}<label className="field-label">Inspection purpose<select disabled={uploadBusy} className="field" value={inspectionType} onChange={e=>setInspectionType(e.target.value as 'move-in'|'move-out')}><option value="move-in">Move in</option><option value="move-out">Move out</option></select></label></>}{captureMode==='phone'?<button className="button button-dark" disabled={!!busy} onClick={()=>void createSession()}>Connect my phone <ArrowUpRight size={17}/></button>:<InspectionUpload roomId={roomId} roomName={roomId?(rooms.find(r=>r.id===roomId)?.name||'Your room'):roomName} type={inspectionType} onBusy={setUploadBusy}/>}</div>}
    {!phone&&stage==='pairing'&&qr&&<div className="pairing-layer"><img className="pairing-qr" src={qr} alt="Pairing QR code for this inspection"/><h2>Your phone is the camera.</h2><p>Scan with your phone. The feed will appear in this space.</p><small>Pairing code expires {session?new Date(session.pairingExpiresAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'in 10 minutes'}. Keep this link private.</small><button className="text-button" onClick={()=>navigator.clipboard.writeText(pairUrl).then(()=>setAnalysis('Pairing link copied')).catch(()=>setError('Copy unavailable. Scan the QR code instead.'))}><Copy size={14}/> Copy pairing link</button></div>}
   </div>
   {session?.analysisProgress&&<p className="analysis-state" role="status">{session.analysisProgress.checked} photos checked · {session.analysisProgress.checking} checking · {session.analysisProgress.queued} waiting{session.analysisProgress.failed ? ` · ${session.analysisProgress.failed} need retry` : ''}</p>}
   <div className="live-controls">{manual?<><p className="marker-instructions" role="status">{manual.point?'Marker placed. Save, and Gemini describes it.':'Tap the mark on the photo.'}</p><input disabled={!!busy} className="field" placeholder="Optional note. Gemini describes the mark" aria-label="Optional note" value={description} maxLength={1000} onChange={e=>setDescription(e.target.value)}/><button className="button button-dark" disabled={!!busy||stopping.current} onClick={()=>void saveMarker()}>{busy==='Saving marked evidence'?'Saving marker…':'Save marker'}</button><button disabled={!!busy} className="text-button" onClick={()=>{setManual(null);setError('')}}>Cancel</button></>:evidence?<><span>{evidence.finding.description}</span><button className="button button-outline" onClick={()=>setEvidence(null)}>Return to live view</button></>:savedId?<><span><Check size={16}/> {session?.nativeCapture?"Measured room and evidence saved":"Original footage and findings saved"}</span>{baseline&&(session?.roomId||roomId)?<Link className="button button-dark" href={`/rooms/${session?.roomId||roomId}/compare?baseline=${baseline}&current=${savedId}`}>See what changed <ArrowUpRight size={16}/></Link>:null}<Link className={baseline?'button button-outline':'button button-dark'} href={(session?.roomId||roomId)?`/rooms/${session?.roomId||roomId}`:`/inspections/${savedId}`}>Open the room <ArrowUpRight size={16}/></Link></>:phone?<>{!camera&&!busy&&<button className="button button-dark" disabled={!credentials} onClick={()=>void openCamera()}><Camera size={17}/> Open phone camera</button>}{camera&&!recording&&!busy&&<><button className="button button-dark" onClick={()=>void startScan()}>Start inspection</button><button className="button button-outline" onClick={()=>void switchCamera()}><RefreshCw size={15}/> Switch camera</button></>}{recording&&<><button className="button button-outline" onClick={()=>void mark()}><Plus size={16}/> Mark damage</button><button className="button button-dark" onClick={()=>void stopScan()}><Square size={14}/> Finish & save</button></>}{busy.startsWith('Save interrupted')&&<button className="button button-dark" onClick={()=>void stopScan()}>Retry save</button>}</>:session?.paired?<><span><Smartphone size={16}/> The phone controls recording</span><button className="text-button" onClick={()=>void reconnect()}><RefreshCw size={14}/> Reconnect video</button>{session.status==='recording'&&<button className="button button-dark" onClick={()=>void event('scan.stop_requested')}><Square size={14}/> Finish & save</button>}</>:<span>{captureMode==='upload'?'Your original recording stays with the inspection.':'Use your phone camera to begin.'}</span>}</div>
   {busy&&<PixelLoader label={busy} startedAt={busyStarted.current}/>}{!uploading&&!session?.nativeCapture&&<div className="live-footnote"><span><Wifi size={14}/> {connected?'Peer-to-peer video': 'Secure session · expiring pairing'}</span><span>{latency!==null?`${Math.round(latency)} ms inference · ${(1000/Math.max(333,latency)).toFixed(1)} FPS max`:'Detection begins when recording starts'}</span></div>}
   {id&&<details className="connection-diagnostics"><summary>Connection details</summary><p>{credentials?.iceServers.some(server=>(Array.isArray(server.urls)?server.urls:[server.urls]).some(url=>/^turns?:/.test(url)))?'TURN relay available for restricted networks.':'Direct connection only. Some networks require a TURN relay; try the same Wi-Fi if video fails.'}</p><ol>{diagnostics.map((line,index)=><li key={index}>{line}</li>)}</ol>{!phone&&!connected&&<button className="text-button" onClick={()=>void video.current?.play().catch(()=>setError('Video is not ready yet. Reconnect video.'))}>Play video</button>}</details>}{analysis&&<p role="status" className="analysis-state">{analysis}</p>}{phone&&<p className="live-disclaimer">Keep this page open while recording. Up to 2 minutes / 100 MB. Damage checks are asynchronous; unassessed areas are not declared undamaged.</p>}
  </section><aside className="live-inventory"><div className="inventory-heading"><div><p className="eyebrow">YOUR ROOM, TAKING SHAPE</p><h2>The details</h2></div><span>{session?.nativeCapture?(session.nativeLive?.elements||[]).filter(isFurniture).length:inventory.length}</span></div><div className="inventory-tabs"><span>{session?.nativeCapture?'Furniture':'Objects'} <b>{session?.nativeCapture?(session.nativeLive?.elements||[]).filter(isFurniture).length:inventory.length}</b></span><span>Potential damage <b>{findings.filter(f=>f.reviewStatus!=='rejected').length}</b></span></div>
   {session?.nativeCapture?(()=>{const items=(session.nativeLive?.elements||[]).filter(isFurniture),names=furnitureNames(items);return items.length?<div className="inventory-list">{items.map(e=><div key={e.id} className="inventory-row"><span><b>{names.get(e.id)}</b><small>{e.dimensions.map(n=>n.toFixed(2)).join(' × ')} m</small></span><span className="object-state">Measured</span></div>)}</div>:<div className="inventory-empty"><h3>Furniture appears as you scan.</h3><p>The phone measures each piece. Anything worth a closer look is pinned in the 3D room.</p></div>;})():!inventory.length?<div className="inventory-empty"><h3>{uploading?'Your inspection starts here.':'Details appear as you scan.'}</h3><p>{uploading?'Choose your video and select Start inspection. Your saved record will show detected objects and potential damage for review.':'Objects appear here when the phone starts scanning. Damage suggestions arrive after selected frames are checked.'}</p></div>:<div className="inventory-list">{inventory.map(o=><button key={o.objectId} className={`inventory-row ${selected===o.objectId?'selected':''}`} onClick={()=>{setSelected(o.objectId);setEvidence(null)}}><span><b>{o.label}</b><small>{o.observations} observations · seen at {Math.floor(o.lastSeenSeconds)}s</small></span><span className="object-state">Detected</span></button>)}</div>}
   {findings.length>0&&<section className="live-damage-list"><h3>Worth a closer look</h3>{findings.map(f=><article key={f.id} className="damage-item"><button onClick={()=>void viewFinding(f)} onMouseEnter={()=>{if(session?.nativeCapture&&!phone)setSelected(f.id);}} onFocus={()=>{if(session?.nativeCapture&&!phone)setSelected(f.id);}}><span className="damage-dot"/><div><b>{f.label}</b><p>{f.description}</p><small>{f.source==='manual'?'Marked on phone':f.detectionSource==='crack-model'?'Crack model':'Gemini 4 Argon'} · {Math.floor(f.timestampSeconds||0)}s · {f.source==='manual'?'Confirmed':f.autoApproved?`Cross-checked by Gemini · ${Math.round((f.verification?.confidence||0)*100)}% · auto-approved`:session?.analysisIssue&&f.reviewStatus==='pending'?'Needs your review · AI check unavailable':f.verification?`Cross-checked · ${f.verification.verdict==='damage'?`${Math.round(f.verification.confidence*100)}% sure`:f.verification.verdict==='unsure'?'unsure':'doubtful'} · needs your review`:f.reviewStatus==='confirmed'?'Confirmed':f.reviewStatus==='rejected'?'Dismissed':'Needs your review'}</small></div></button>{f.reviewStatus==='pending'&&<div className="damage-review"><button onClick={()=>void event('finding.reviewed',{findingId:f.id,reviewStatus:'confirmed'}).catch(e=>setError(e.message))}><Check size={13}/> Confirm</button><button onClick={()=>void event('finding.reviewed',{findingId:f.id,reviewStatus:'rejected'}).catch(e=>setError(e.message))}><X size={13}/> Dismiss</button></div>}</article>)}</section>}
   <p className="inventory-note">Tracking helps avoid repeat counts in consecutive views. A new angle can still create a new object. Review your final inventory.</p>
  </aside></div>{!phone&&roomId&&!id&&!lockRoom&&<RoomHistory roomId={roomId}/>}<footer className="live-footer"><span>dwelld. <i>Your room remembers.</i></span><span>Your room remembers. Keep your session link private</span></footer>
 </main>
}
