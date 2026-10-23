import ReportExport from '@/components/report-export';
export default async function Page({params}:{params:Promise<{inspectionId:string}>}){return <ReportExport inspectionId={(await params).inspectionId}/>}
