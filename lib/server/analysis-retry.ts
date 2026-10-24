import { setTimeout as delay } from 'node:timers/promises';
import { analysisFailure } from './analysis-failure';

/** Retry temporary failures only; rate limits pause the queue rather than amplifying traffic. */
export async function retryAnalysis<T>(run:()=>Promise<T>,options:{deadlineMs:number;onRetry?:(attempt:number,message:string)=>Promise<void>;wait?:(ms:number)=>Promise<void>}):Promise<T>{
 for(let attempt=1;;attempt++)try{return await run();}catch(error){
  const failure=analysisFailure(error);
  const backoff=attempt*1000;
  if(attempt>=3||!failure.retryable||failure.code==='AI_RATE_LIMITED'||Date.now()+backoff+65_000>options.deadlineMs)throw error;
  await options.onRetry?.(attempt+1,failure.message);
  await (options.wait||delay)(backoff);
 }
}
