import InspectionResults from "@/components/inspection-results";
export default async function ResultsPage({ params }: { params: Promise<{ inspectionId: string }> }) { const { inspectionId } = await params; return <InspectionResults inspectionId={inspectionId}/>; }
