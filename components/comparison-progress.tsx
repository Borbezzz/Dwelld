"use client";
import {comparisonProgressView,type ComparisonProgress as Progress} from '@/lib/comparison-progress';
import {ProcessProgress} from './live/scan-workflow';
export default function ComparisonProgress({progress,status='processing',context,startedAt}:{progress?:Progress|null;status?:string;context?:string;startedAt?:string}){
 const view=comparisonProgressView(progress,status),date=startedAt?Date.parse(startedAt):NaN;
 return <ProcessProgress title="Comparison progress" context={context} rows={view.rows} progress={{value:view.value,max:view.max,text:view.detail}} activeLabel={view.label} startedAt={Number.isFinite(date)?date:undefined}/>;
}
