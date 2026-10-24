"use client";
import type {Inspection} from '@/lib/types';
import {inspectionWorkflow,inspectionLabel,isInspectionProcessing} from '@/lib/processing-workflow';
import ComparisonProgress from './comparison-progress';
import {ProcessProgress} from './live/scan-workflow';
export default function InspectionProgress({inspection}:{inspection:Inspection}){
 const showComparison=['processing','failed','partial'].includes(inspection.reportComparisonStatus||''),incomplete=inspection.reportComparisonStatus==='failed'||inspection.reportComparisonStatus==='partial';
 return <details className="processing-overview" open={isInspectionProcessing(inspection)||incomplete}><summary>{isInspectionProcessing(inspection)?'Processing scan':incomplete?'Scan saved · comparison incomplete':inspection.status==='failed'?'Scan needs attention':inspection.status==='partial'?'Scan saved · some views need review':'Scan saved'} · {inspectionLabel(inspection)}</summary>{showComparison?<ComparisonProgress progress={inspection.comparisonProgress} status={inspection.reportComparisonStatus} context={inspection.comparisonBaselineCreatedAt?`Check-in ${new Date(inspection.comparisonBaselineCreatedAt).toLocaleString()} → ${inspectionLabel(inspection)}`:undefined}/>:<ProcessProgress rows={inspectionWorkflow(inspection)} title="Scan progress"/>}</details>;
}
