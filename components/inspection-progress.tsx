"use client";
import type {Inspection} from '@/lib/types';
import {inspectionWorkflow,inspectionLabel,isInspectionProcessing} from '@/lib/processing-workflow';
import {ProcessProgress} from './live/scan-workflow';
export default function InspectionProgress({inspection}:{inspection:Inspection}){
 return <details className="processing-overview" open={isInspectionProcessing(inspection)}><summary>{isInspectionProcessing(inspection)?'Processing scan':inspection.status==='failed'?'Scan needs attention':inspection.status==='partial'?'Scan saved · some views need review':'Scan saved'} · {inspectionLabel(inspection)}</summary><ProcessProgress rows={inspectionWorkflow(inspection)} title="Scan progress"/></details>;
}
