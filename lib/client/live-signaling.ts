/** Serialize writes so an offer/answer is persisted before its ICE candidates.
 * Retrying the same payload is safe because the server deduplicates eventId. */
export class SignalQueue {
 private tail: Promise<unknown> = Promise.resolve();
 send<T>(write: () => Promise<T>): Promise<T> {
  const job=this.tail.catch(()=>{}).then(async()=>{try{return await write()}catch{return await write()}});
  this.tail=job;return job;
 }
}
export function validSignalPayload(type: string, value: unknown): boolean {
 if(type==='restart') return !!value && typeof value==='object';
 if(!value || typeof value!=='object')return false;
 const data=value as Record<string,unknown>;
 if(typeof data.negotiationId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(data.negotiationId))return false;
 if(type==='ice') {const candidate=data.candidate as RTCIceCandidateInit|undefined;return !!candidate&&typeof candidate.candidate==='string'&&candidate.candidate.length<=4096;}
 const description=data.description as RTCSessionDescriptionInit|undefined;
 return (type==='offer'||type==='answer')&&!!description&&description.type===type&&typeof description.sdp==='string'&&description.sdp.length>0&&description.sdp.length<50000;
}
/** Keep early ICE across polls; only known superseded generations are stale. */
export class NegotiationCandidates {
 private pending = new Map<string, RTCIceCandidateInit[]>();
 private retired = new Set<string>();
 private active = '';
 activate(generation:string) {
  if(this.active&&this.active!==generation){this.retired.add(this.active);this.pending.delete(this.active);}
  this.active=generation;
 }
 add(generation:string,candidate:RTCIceCandidateInit) {
  if(this.retired.has(generation))return;
  if(!this.pending.has(generation)&&this.pending.size>=8)this.pending.delete(this.pending.keys().next().value!);
  const values=this.pending.get(generation)||[];if(values.length<100)values.push(candidate);this.pending.set(generation,values);
 }
 drain(generation:string) {const values=this.pending.get(generation)||[];this.pending.delete(generation);return values;}
}
